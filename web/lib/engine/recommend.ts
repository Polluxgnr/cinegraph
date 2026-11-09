/**
 * Ranking for any domain:
 *   candidates (everything you haven't answered, hard filters applied)
 *   -> features + learned logistic ranker  -> "match" probability and predicted stars
 *   -> MMR diversity on embeddings -> Thompson-sampling exploration slots -> explanations
 */
import { isFilmData, type DomainData, type FilmData } from "../data";
import type { State } from "../store";
import type { Entity } from "../types";
import { sampleBeta } from "./linalg";
import { buildProfile, type Profile } from "./profile";
import { type Ctx, explain, features, makeCtx, predict, quickScore, stars, weights, type Scored } from "./score";

export interface Rec {
  entity: Entity;
  p: number; // match probability
  stars: number; // predicted rating
  why: string;
  explore: boolean;
  scored: Scored;
}

export interface RecOptions {
  n?: number;
  filter?: (e: Entity) => boolean;
  includeAnswered?: boolean;
  includeListed?: boolean;
  explore?: number; // share of exploration slots
  diversity?: number; // MMR lambda (1 = none)
  boost?: Map<string, number>; // extra score (NL queries)
}

/** Next unwatched entry of every saga you've started. */
export function sagaNext(d: FilmData, s: State): Set<string> {
  const out = new Set<string>();
  for (const c of d.collections) {
    const keys = c.items.map((id) => `films:${id}`);
    const seen = keys.map((k) => {
      const a = s.feedback[k]?.action;
      return a === "loved" || a === "liked" || a === "ok" || a === "disliked";
    });
    if (!seen.some(Boolean) || seen.every(Boolean)) continue;
    const next = keys.find((k, i) => !seen[i] && s.feedback[k]?.action !== "never");
    if (next) out.add(next);
  }
  return out;
}

export function context(d: DomainData, s: State, profile?: Profile): Ctx {
  const p = profile ?? buildProfile(d, s);
  const listed = new Set(Object.values(s.lists).filter((l) => l.status !== "done").map((l) => l.key));
  return makeCtx(d, p, listed, isFilmData(d) ? sagaNext(d, s) : new Set());
}

export function blocked(e: Entity, s: State): boolean {
  const b = e.film?.blk;
  return !!b && s.settings.hideBlocked && s.settings.blocked.includes(b);
}

export function scoreOne(d: DomainData, s: State, row: number, ctx?: Ctx): Rec {
  const c = ctx ?? context(d, s);
  const sc = features(c, row);
  const p = predict(weights(s.learned.ranker[d.name]), sc.x);
  return { entity: d.entities[row], p, stars: stars(p), why: explain(sc, c, p), explore: false, scored: sc };
}

export function recommend(d: DomainData, s: State, o: RecOptions = {}): Rec[] {
  const n = o.n ?? 20;
  const c = context(d, s);
  const w = weights(s.learned.ranker[d.name]);
  // stage 1: cheap score over the whole catalogue
  const pre: { row: number; q: number }[] = [];
  for (let row = 0; row < d.entities.length; row++) {
    const e = d.entities[row];
    if (!o.includeAnswered && c.p.answered.has(e.key) && !(o.includeListed && c.listed.has(e.key))) continue;
    if (!o.includeListed && c.listed.has(e.key) && c.p.answered.has(e.key)) continue;
    if (blocked(e, s) || (o.filter && !o.filter(e))) continue;
    pre.push({ row, q: quickScore(c, row) + (o.boost?.get(e.key) ?? 0) });
  }
  pre.sort((a, b) => b.q - a.q);
  // stage 2: full features + learned ranker on the best 600 (plus a random slice for exploration)
  const shortlist = pre.slice(0, Math.max(600, 12 * n));
  for (let i = 0; i < 60 && pre.length > shortlist.length; i++) shortlist.push(pre[shortlist.length + Math.floor(Math.random() * (pre.length - shortlist.length))]);
  const scored: { row: number; p: number; sc: Scored }[] = [];
  for (const { row } of shortlist) {
    const e = d.entities[row];
    const sc = features(c, row);
    let z = 0;
    for (let i = 0; i < sc.x.length; i++) z += w[i] * sc.x[i];
    z += o.boost?.get(e.key) ?? 0;
    scored.push({ row, p: 1 / (1 + Math.exp(-z)), sc });
  }
  scored.sort((a, b) => b.p - a.p);

  const nExplore = Math.round(n * (o.explore ?? 0.12));
  const pool = scored.slice(0, Math.max(5 * n, 80));
  const picked = mmr(d, pool, n - nExplore, o.diversity ?? 0.8);
  const pickedRows = new Set(picked.map((x) => x.row));
  const explorePicks = exploreSlots(d, s, scored.slice(n), nExplore, pickedRows);

  const out: Rec[] = picked.map((x) => ({
    entity: d.entities[x.row], p: x.p, stars: stars(x.p), why: explain(x.sc, c, x.p), explore: false, scored: x.sc,
  }));
  explorePicks.forEach((x, k) => {
    out.splice(Math.min(out.length, 3 + k * 5), 0, {
      entity: d.entities[x.row], p: x.p, stars: stars(x.p), why: `Exploring: ${explain(x.sc, c, x.p).toLowerCase()}`,
      explore: true, scored: x.sc,
    });
  });
  return out;
}

function mmr<T extends { row: number; p: number }>(d: DomainData, pool: T[], k: number, lambda: number): T[] {
  if (!d.emb || lambda >= 1) return pool.slice(0, k);
  const chosen: T[] = [];
  const vecs: Float32Array[] = [];
  const rest = [...pool];
  while (chosen.length < k && rest.length) {
    let bi = 0;
    let bv = -Infinity;
    for (let i = 0; i < Math.min(rest.length, 4 * k); i++) {
      const v = d.emb.row(rest[i].row);
      let sim = 0;
      for (const cv of vecs) {
        let s = 0;
        for (let j = 0; j < v.length; j++) s += v[j] * cv[j];
        sim = Math.max(sim, s);
      }
      const val = lambda * rest[i].p - (1 - lambda) * sim;
      if (val > bv) {
        bv = val;
        bi = i;
      }
    }
    const [x] = rest.splice(bi, 1);
    chosen.push(x);
    vecs.push(d.emb.row(x.row));
  }
  return chosen;
}

/** Thompson sampling over tags: draw a success rate per tag, explore the best-drawn tags. */
function exploreSlots<T extends { row: number; p: number }>(
  d: DomainData, s: State, tail: T[], k: number, taken: Set<number>,
): T[] {
  if (k <= 0) return [];
  const arms = s.learned.arms[d.name] ?? {};
  const byTag = new Map<string, T>();
  for (const x of tail.slice(0, 600)) {
    if (taken.has(x.row)) continue;
    const t = d.entities[x.row].tags[0]?.toLowerCase();
    if (t && !byTag.has(t)) byTag.set(t, x);
  }
  const draws = [...byTag.keys()].map((t) => {
    const [a, b] = arms[t] ?? [1, 1];
    return { t, v: sampleBeta(a, b) };
  });
  draws.sort((a, b) => b.v - a.v);
  return draws.slice(0, k).map((dr) => byTag.get(dr.t)!);
}
