/**
 * Swipe deck: active learning that gets smarter each round.
 *
 * Bayesian linear regression of your taste y on a 32-d random projection z of each item's
 * embedding. Posterior covariance S = (λI + ZᵀZ/σ²)⁻¹ shrinks where you've answered.
 *
 *   value(item) = p_seen · ( u·sqrt(zᵀSz)           uncertainty: learn the most
 *                            + v·coverage            corners of the catalogue not visited yet
 *                            + x·match )             what the ranker thinks you'll like
 *
 * Early on, u and v dominate (explore); as answers accumulate, x grows, so proposals drift
 * towards things you'll actually enjoy while still probing the uncertain bits.
 * p_seen favours well-known titles, and adapts to your recent "not seen" rate.
 */
import { isFilmData, type DomainData } from "../data";
import { ACTION_VALUE, type State } from "../store";
import type { Entity } from "../types";
import { inverseSPD, projection } from "./linalg";
import { buildProfile } from "./profile";
import { blocked, context, type Rec, scoreOne } from "./recommend";

const K = 32;
const LAMBDA = 1;
const SIGMA2 = 0.5;

const projCache = new Map<DomainData, { Z: Float32Array; popPct: Float32Array }>();

function reduced(d: DomainData) {
  let c = projCache.get(d);
  if (c || !d.emb) return c;
  const P = projection(d.emb.dim, K);
  const Z = new Float32Array(d.entities.length * K);
  for (let i = 0; i < d.entities.length; i++) {
    const v = d.emb.row(i);
    let n = 0;
    for (let k = 0; k < K; k++) {
      let s = 0;
      for (let j = 0; j < v.length; j++) s += v[j] * P[j * K + k];
      Z[i * K + k] = s;
      n += s * s;
    }
    n = Math.sqrt(n) || 1;
    for (let k = 0; k < K; k++) Z[i * K + k] /= n;
  }
  // popularity percentile within kind (films vs series ranked separately)
  const popPct = new Float32Array(d.entities.length);
  const groups = new Map<string, number[]>();
  d.entities.forEach((e, i) => {
    const g = e.film?.k ?? "all";
    groups.set(g, [...(groups.get(g) ?? []), i]);
  });
  groups.forEach((rows) => {
    rows.sort((a, b) => d.entities[a].pop - d.entities[b].pop);
    rows.forEach((r, rank) => (popPct[r] = rows.length > 1 ? rank / (rows.length - 1) : 1));
  });
  c = { Z, popPct };
  projCache.set(d, c);
  return c;
}

export interface Card {
  rec: Rec;
  info: { uncertainty: number; coverage: number; pSeen: number; labels: number };
}

export function nextCard(d: DomainData, s: State, skip: Set<string> = new Set(), rnd = Math.random): Card | null {
  const red = reduced(d);
  if (!red) return null;
  const { Z, popPct } = red;
  const profile = buildProfile(d, s);
  const ctx = context(d, s, profile);

  // posterior from informative answers
  const A = new Float64Array(K * K);
  for (let k = 0; k < K; k++) A[k * K + k] = LAMBDA;
  const labelled: number[] = [];
  const recent: string[] = [];
  for (const fb of s.history.slice(-30)) if (fb.domain === d.name) recent.push(fb.action);
  for (const a of profile.anchors) {
    labelled.push(a.row);
    for (let i = 0; i < K; i++) for (let j = 0; j < K; j++) A[i * K + j] += (Z[a.row * K + i] * Z[a.row * K + j]) / SIGMA2;
  }
  const S = inverseSPD(A, K);

  const unknownRate = recent.length ? recent.filter((a) => a === "unknown" || a === "maybe" || a === "want").length / recent.length : 0.3;
  const shift = 0.35 + 0.45 * unknownRate;
  const steep = 5 + 8 * unknownRate;
  const n = profile.anchors.length;
  const u = 1.0;
  const v = n < 10 ? 0.8 : 0.4;
  const x = Math.min(1.2, n / 40); // exploitation grows with what we know

  // alternate films / series to keep the profile balanced
  let kindWanted: string | null = null;
  if (isFilmData(d)) {
    const answeredKinds = [...profile.answered].map((k) => d.entities[d.index.get(k) ?? 0]?.film?.k);
    const nm = answeredKinds.filter((k) => k === "movie").length;
    const nt = answeredKinds.filter((k) => k === "tv").length;
    kindWanted = nt < nm ? "tv" : "movie";
  }

  // candidate pool: the 1500 most popular unanswered (fast, and these are the ones you can judge)
  const rows: number[] = [];
  for (let i = 0; i < d.entities.length; i++) {
    const e = d.entities[i];
    if (profile.answered.has(e.key) || skip.has(e.key) || blocked(e, s)) continue;
    if (kindWanted && e.film && e.film.k !== kindWanted) continue;
    rows.push(i);
  }
  rows.sort((a, b) => popPct[b] - popPct[a]);
  const pool = rows.slice(0, 1500);
  if (!pool.length) return null;

  const scoredRows = pool.map((r) => {
    let unc = 0;
    for (let i = 0; i < K; i++) {
      let si = 0;
      for (let j = 0; j < K; j++) si += S[i * K + j] * Z[r * K + j];
      unc += Z[r * K + i] * si;
    }
    let cover = 1;
    for (const l of labelled.slice(-200)) {
      let sim = 0;
      for (let k = 0; k < K; k++) sim += Z[r * K + k] * Z[l * K + k];
      cover = Math.min(cover, 1 - sim);
    }
    const ps = 1 / (1 + Math.exp(-steep * (popPct[r] - shift)));
    return { r, unc: Math.sqrt(Math.max(unc, 0)), cover: Math.max(cover, 0), ps };
  });
  // quick pre-score without the ranker, then rank the top 60 with the full model
  scoredRows.sort((a, b) => b.ps * (u * b.unc + v * b.cover) - a.ps * (u * a.unc + v * a.cover));
  const top = scoredRows.slice(0, 60).map((c) => {
    const rec = scoreOne(d, s, c.r, ctx);
    return { ...c, rec, value: c.ps * (u * c.unc + v * c.cover + x * rec.p) };
  });
  top.sort((a, b) => b.value - a.value);
  // sample among the best 5 so the deck doesn't feel mechanical
  const best = top.slice(0, 5);
  const wts = best.map((b) => Math.exp((b.value - best[0].value) * 6));
  let t = rnd() * wts.reduce((a, b) => a + b, 0);
  let pick = best[0];
  for (let i = 0; i < best.length; i++) {
    t -= wts[i];
    if (t <= 0) {
      pick = best[i];
      break;
    }
  }
  return {
    rec: pick.rec,
    info: { uncertainty: +pick.unc.toFixed(2), coverage: +pick.cover.toFixed(2), pSeen: +pick.ps.toFixed(2), labels: n },
  };
}

/** How much the deck still has to learn, for the progress bar (0..1). */
export function calibration(d: DomainData, s: State): number {
  const n = Object.values(s.feedback).filter((f) => f.domain === d.name && ACTION_VALUE[f.action] != null).length;
  return Math.min(1, Math.sqrt(n / 60));
}

export function entityOf(d: DomainData, key: string): Entity | undefined {
  const r = d.index.get(key);
  return r == null ? undefined : d.entities[r];
}
