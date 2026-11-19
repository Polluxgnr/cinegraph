/**
 * Features, knowledge-graph paths, the online ranker and explanations.
 *
 * Every candidate gets a feature vector (FEATURES). The ranker is a logistic regression whose
 * weights start at DEFAULT_W and are updated online (SGD with L2 pull towards the defaults)
 * each time you answer, using the features the item had at that moment. Its probability is
 * the "match %" and the predicted stars on every card.
 */
import { isFilmData, type DomainData, type FilmData } from "../data";
import type { Film } from "../types";
import { sigmoid } from "./linalg";
import type { Anchor, Profile } from "./profile";

export const FEATURES = [
  "bias",
  "emb_profile", // cosine with your taste vector
  "emb_max_pos", // closest thing you liked
  "emb_max_neg", // closest thing you disliked
  "tag_aff", // genres / tags you rate well
  "graph", // shared people, sagas, awards, sources with what you liked
  "cf", // "people who liked what you liked" (ALS)
  "people", // affinity with cast & crew
  "lang", // original language (VO)
  "decade",
  "runtime_fit", // closeness to the runtimes you like (and "too long" chips)
  "quality", // community rating
  "popularity",
  "recency",
  "saga_next", // next unwatched entry of a saga you started
  "listed", // on your list
  "genre_aff", // your affinity for the title's genres only (tags mix in keywords)
  "kind_aff", // films vs series: which you like more
] as const;
export type FeatureName = (typeof FEATURES)[number];
const F = Object.fromEntries(FEATURES.map((f, i) => [f, i])) as Record<FeatureName, number>;

export const DEFAULT_W: number[] = [
  // emb_max_neg and tag_aff raised after replaying real answers (rejections were under-weighted)
  -0.6, 2.2, 2.6, -3.5, 2.4, 1.4, 1.0, 1.0, 0.6, 0.4, 0.5, 0.9, 0.35, 0.15, 1.2, 0.4, 1.4, 0.8,
];

// ------------------------------------------------------------------ knowledge graph (films)
export interface GraphPath {
  anchor: Anchor;
  rel: string;
  via: string;
  weight: number;
}

const REL_W: Record<string, number> = {
  saga: 1.4, director: 1.0, creator: 1.0, writer: 0.85, cast: 0.45, composer: 0.35, award: 0.25,
  source: 0.9, influence: 0.7, location: 0.25, subject: 0.4,
};

interface FilmGraph {
  df: Map<string, number>; // entity -> number of titles carrying it
}
let graphCache: { data: FilmData; g: FilmGraph } | null = null;

export function entitiesOf(f: Film): [string, string][] {
  const out: [string, string][] = [];
  if (f.coll) out.push(["saga", `coll:${f.coll}`]);
  f.dir?.forEach((p) => out.push(["director", `p:${p}`]));
  f.cre?.forEach((p) => out.push(["creator", `p:${p}`]));
  f.wri?.forEach((p) => out.push(["writer", `p:${p}`]));
  f.cast?.slice(0, 6).forEach((p) => out.push(["cast", `p:${p}`]));
  f.mus?.forEach((p) => out.push(["composer", `p:${p}`]));
  f.aw?.forEach((a) => out.push(["award", `aw:${a}`]));
  f.src?.forEach((a) => out.push(["source", `src:${a}`]));
  f.inf?.forEach((a) => out.push(["influence", `inf:${a}`]));
  f.loc?.forEach((a) => out.push(["location", `loc:${a}`]));
  f.sub?.forEach((a) => out.push(["subject", `sub:${a}`]));
  return out;
}

function filmGraph(d: FilmData): FilmGraph {
  if (graphCache?.data === d) return graphCache.g;
  const df = new Map<string, number>();
  for (const f of d.films) for (const [, e] of entitiesOf(f)) df.set(e, (df.get(e) ?? 0) + 1);
  graphCache = { data: d, g: { df } };
  return graphCache.g;
}

export function entityLabel(d: FilmData, e: string): string {
  const [t, v] = [e.slice(0, e.indexOf(":")), e.slice(e.indexOf(":") + 1)];
  if (t === "p") return d.people[Number(v)] ?? "?";
  if (t === "coll") return d.collectionOf.get(v)?.name ?? v;
  return v;
}

/** Index: entity -> anchors carrying it (anchors are few, so this is cheap per request). */
export function anchorIndex(d: FilmData, p: Profile): Map<string, { a: Anchor; rel: string }[]> {
  const idx = new Map<string, { a: Anchor; rel: string }[]>();
  for (const a of p.anchors) {
    if (Math.abs(a.w) < 0.25) continue;
    for (const [rel, e] of entitiesOf(d.films[a.row])) {
      const l = idx.get(e) ?? [];
      l.push({ a, rel });
      idx.set(e, l);
    }
  }
  return idx;
}

export function graphScore(
  d: FilmData,
  f: Film,
  idx: Map<string, { a: Anchor; rel: string }[]>,
): { score: number; best: GraphPath | null } {
  const g = filmGraph(d);
  let score = 0;
  let best: GraphPath | null = null;
  const perAnchor = new Map<string, number>();
  for (const [rel, e] of entitiesOf(f)) {
    const hits = idx.get(e);
    if (!hits) continue;
    const idf = 1 / Math.log(2 + (g.df.get(e) ?? 1));
    for (const h of hits) {
      if (h.a.row === d.index.get(`films:${f.id}`)) continue;
      const w = (REL_W[rel] ?? 0.3) * (h.rel === rel ? 1 : 0.4) * idf * h.a.w;
      const cur = perAnchor.get(h.a.key) ?? 0;
      if (Math.abs(cur) > 1.2) continue; // one anchor can't dominate
      perAnchor.set(h.a.key, cur + w);
      score += w;
      if (w > 0 && (!best || w > best.weight)) best = { anchor: h.a, rel, via: entityLabel(d, e), weight: w };
    }
  }
  return { score, best };
}

export function explainPath(p: GraphPath): string {
  const a = `${p.anchor.title}, ${p.anchor.label}`;
  switch (p.rel) {
    case "saga": return `Same saga as ${a} (${p.via})`;
    case "director": return `Directed by ${p.via}, like ${a}`;
    case "creator": return `From ${p.via}, who created ${a}`;
    case "writer": return `Written by ${p.via}, like ${a}`;
    case "cast": return `With ${p.via}, also in ${a}`;
    case "composer": return `Music by ${p.via}, as in ${a}`;
    case "award": return `Won ${p.via}, like ${a}`;
    case "source": return `Also adapted from ${p.via}, like ${a}`;
    case "influence": return `Influenced by ${p.via}, like ${a}`;
    case "location": return `Also set in ${p.via}, like ${a}`;
    default: return `Shares ${p.via} with ${a}`;
  }
}

// ------------------------------------------------------------------ features
export interface Ctx {
  d: DomainData;
  p: Profile;
  idx?: Map<string, { a: Anchor; rel: string }[]>;
  listed: Set<string>;
  sagaNext: Set<string>;
  now: number;
}

export function makeCtx(d: DomainData, p: Profile, listed: Set<string>, sagaNext: Set<string>): Ctx {
  return { d, p, listed, sagaNext, now: Date.now(), idx: isFilmData(d) ? anchorIndex(d, p) : undefined };
}

export interface Scored {
  row: number;
  x: Float32Array;
  path: GraphPath | null;
  nearest: Anchor | null;
}

export function features(c: Ctx, row: number): Scored {
  const { d, p } = c;
  const x = new Float32Array(FEATURES.length);
  x[F.bias] = 1;
  const e = d.entities[row];
  let nearest: Anchor | null = null;
  if (d.emb) {
    const n = d.norms[row];
    const b = baseline(d);
    if (p.vector) x[F.emb_profile] = centre(d.emb.dot(row, p.vector) / n, b);
    let bp = -1;
    for (const a of p.pos.slice(0, 150)) {
      if (a.row === row) continue;
      const s = cos(d, row, a.row);
      if (s > bp) {
        bp = s;
        nearest = a;
      }
    }
    x[F.emb_max_pos] = Math.max(centre(bp, b), 0);
    let bn = -1;
    for (const a of p.neg.slice(0, 80)) if (a.row !== row) bn = Math.max(bn, cos(d, row, a.row));
    x[F.emb_max_neg] = Math.max(centre(bn, b), 0);
  }
  let ta = 0;
  let tn = 0;
  for (const t of e.tags.slice(0, 12)) {
    const v = p.tagAff.get(t.toLowerCase());
    if (v != null) {
      ta += v;
      tn++;
    }
  }
  x[F.tag_aff] = tn ? ta / tn : 0;
  x[F.popularity] = e.pop / 12;
  if (e.date) {
    const ageYears = (c.now - Date.parse(e.date)) / 3.15e10;
    x[F.recency] = d.name === "youtube" ? Math.exp(-ageYears * 12) : Math.exp(-Math.max(ageYears, 0) / 15);
  }
  x[F.listed] = c.listed.has(e.key) ? 1 : 0;
  let path: GraphPath | null = null;

  if (isFilmData(d) && e.film) {
    const f = e.film;
    const g = graphScore(d, f, c.idx!);
    x[F.graph] = Math.tanh(g.score);
    path = g.best;
    if (p.cfUser && d.cf) {
      const r = d.cfIndex.get(f.id);
      if (r != null) x[F.cf] = Math.tanh(d.cf.dot(r, p.cfUser) / 2);
    }
    let pa = 0;
    let pn = 0;
    for (const pid of [...(f.dir ?? []), ...(f.cre ?? []), ...(f.wri ?? []), ...(f.cast ?? []).slice(0, 6)]) {
      const v = p.people?.get(pid);
      if (v != null) {
        pa += v;
        pn++;
      }
    }
    x[F.people] = pn ? pa / Math.sqrt(pn) : 0;
    x[F.lang] = f.lang ? (p.lang?.get(f.lang) ?? 0) : 0;
    x[F.decade] = f.y ? (p.decade?.get(Math.floor(f.y / 10) * 10) ?? 0) : 0;
    if (f.rt && f.k === "movie" && p.runtimePref) {
      const over = Math.max(0, f.rt - p.runtimePref.mean) / p.runtimePref.tolerance;
      const tooLong = (p.chipPenalty?.get("Too long") ?? 0) > 0 && f.rt >= 140 ? 0.6 : 0;
      x[F.runtime_fit] = -Math.min(over * over, 3) * 0.3 - tooLong;
    }
    if (f.va && (f.vc ?? 0) >= 20) x[F.quality] = (f.va - 6.5) / 1.5;
    if (p.genre && f.g?.length) {
      let ga = 0;
      let gn = 0;
      for (const g of f.g) {
        const v = p.genre.get(g);
        if (v != null) {
          ga += v;
          gn++;
        }
      }
      x[F.genre_aff] = gn ? ga / gn : 0;
    }
    x[F.kind_aff] = p.kind?.get(f.k) ?? 0;
    x[F.saga_next] = c.sagaNext.has(e.key) ? 1 : 0;
  } else if (e.item?.related?.length) {
    // music: "related artists" edges act as the graph
    let s = 0;
    let best: Anchor | null = null;
    for (const rel of e.item.related) {
      const a = p.anchors.find((an) => an.key === rel);
      if (a) {
        s += a.w;
        if (a.w > 0 && (!best || a.w > best.w)) best = a;
      }
    }
    x[F.graph] = Math.tanh(s);
    if (best) path = { anchor: best, rel: "related", via: best.title, weight: best.w };
  }
  return { row, x, path, nearest };
}

function jitter(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}

/** Stage-1 score: cheap enough for the whole catalogue (one dot product + lookups). */
export function quickScore(c: Ctx, row: number): number {
  const { d, p } = c;
  const e = d.entities[row];
  // small stable jitter so cold-start lists aren't alphabetical when a domain has no popularity data
  let s = e.pop / 30 + 0.08 * jitter(e.key);
  if (d.emb && p.vector) s += 2 * centre(d.emb.dot(row, p.vector) / d.norms[row], baseline(d));
  let ta = 0;
  for (const t of e.tags.slice(0, 6)) ta += p.tagAff.get(t.toLowerCase()) ?? 0;
  s += ta / 3;
  if (e.film && c.idx && isFilmData(d)) s += graphScore(d, e.film, c.idx).score;
  if (c.listed.has(e.key) || c.sagaNext.has(e.key)) s += 1;
  return s;
}

/** Typical cosine between two unrelated items of a domain. Sentence embeddings are rarely near 0 for
 * unrelated texts, so features are re-centred: (cos - base) / (1 - base) maps "unrelated" to ~0. */
const baselines = new WeakMap<DomainData, number>();
export function baseline(d: DomainData): number {
  let b = baselines.get(d);
  if (b != null) return b;
  const n = d.entities.length;
  let acc = 0;
  let k = 0;
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let t = 0; t < 400 && n > 1 && d.emb; t++) {
    const i = Math.floor(rnd() * n);
    const j = Math.floor(rnd() * n);
    if (i === j) continue;
    acc += cos(d, i, j);
    k++;
  }
  b = k ? Math.min(0.9, acc / k) : 0;
  baselines.set(d, b);
  return b;
}
const centre = (x: number, b: number) => (x - b) / (1 - b);

function cos(d: DomainData, i: number, j: number): number {
  const m = d.emb!;
  let acc = 0;
  for (let k = 0, oi = i * m.dim, oj = j * m.dim; k < m.dim; k++) acc += m.q[oi + k] * m.q[oj + k];
  return (acc * m.scale[i] * m.scale[j]) / (d.norms[i] * d.norms[j]);
}

// ------------------------------------------------------------------ ranker
/**
 * Starting weights before you've answered, informed by the weekly offline evaluation: if collaborative
 * filtering finds hidden favourites better than content similarity, its feature starts stronger (capped),
 * and popularity gets the share the evaluation's best blend gave it. Your answers then move them as usual.
 */
let PRIOR_W: number[] = [...DEFAULT_W];
export function tunePrior(ev?: { als?: { ndcg10: number }; content?: { ndcg10: number }; hybrid_weights?: Record<string, number> }) {
  const w = [...DEFAULT_W];
  if (ev?.als && ev.content && ev.content.ndcg10 > 0) {
    const ratio = Math.min(2.5, Math.max(0.5, ev.als.ndcg10 / ev.content.ndcg10));
    w[F.cf] = DEFAULT_W[F.cf] * ratio;
  }
  if (ev?.hybrid_weights?.popularity != null) w[F.popularity] = DEFAULT_W[F.popularity] * (1 + ev.hybrid_weights.popularity);
  PRIOR_W = w;
}

export function weights(learned: { w: number[]; n: number } | undefined): number[] {
  if (learned?.w?.length === FEATURES.length) return learned.w;
  // weights learned before features were added: keep them, start the new ones from the prior
  if (learned?.w?.length && learned.w.length < FEATURES.length) return [...learned.w, ...PRIOR_W.slice(learned.w.length)];
  return PRIOR_W;
}

export function predict(w: number[], x: Float32Array): number {
  let z = 0;
  for (let i = 0; i < x.length; i++) z += w[i] * x[i];
  return sigmoid(z);
}

/** How much to trust your personal model after n informative answers (the rest comes from the prior). */
export const confidence = (n: number) => n / (n + 8);

/**
 * What the crowd thinks, as a logit: the starting point of every prediction before you have answered
 * much. Films: TMDB rating shrunk towards the mean by vote count (a 8.4 with 40 votes is not a 8.4).
 * Other spaces: popularity percentile within the space. Things you saved yourself start positive.
 */
const popRanks = new WeakMap<DomainData, Map<number, number>>();
export function prior(d: DomainData, row: number): number {
  const e = d.entities[row];
  if (e.item?.meta?.custom) return 1.2;
  const f = e.film;
  if ((f?.va && f.vc) || (f?.mlr && f.mlc)) {
    // TMDB audience and MovieLens individual ratings (/5, mapped to TMDB's scale), pooled by vote count
    // and shrunk towards the mean: a 8.4 from 40 votes is not a 8.4
    const k = 300;
    const tv = f.va && f.vc ? f.vc : 0;
    const mv = f.mlr && f.mlc ? f.mlc : 0;
    const shrunk = ((f.va ?? 0) * tv + (mv ? f.mlr! * 2 - 0.55 : 0) * mv + 6.5 * k) / (tv + mv + k);
    // calibrated so TMDB 8.4 -> ~4.3★, 7.0 -> ~3.4★, 6.0 -> ~2.6★ (TMDB averages run high)
    return Math.max(-2.2, Math.min(2.2, (shrunk - 6.15) * 0.75));
  }
  let ranks = popRanks.get(d);
  if (!ranks) {
    const rows = d.entities.map((x, i) => [i, x.pop] as const).filter(([, p]) => p > 0).sort((a, b) => a[1] - b[1]);
    ranks = new Map(rows.map(([i], k) => [i, rows.length > 1 ? k / (rows.length - 1) : 0.5]));
    popRanks.set(d, ranks);
  }
  const pct = ranks.get(row);
  return pct == null ? 0 : (pct - 0.5) * 1.2;
}

/** Final probability: your model's logit and the crowd prior, weighted by how much we know you. */
export function blend(zModel: number, zPrior: number, n: number): number {
  const c = confidence(n);
  return sigmoid(c * zModel + (1 - c) * zPrior);
}

/** One SGD step of L2-regularised logistic regression towards label y in [0, 1]. */
export function sgdStep(w: number[], x: Float32Array, y: number, n: number): number[] {
  const lr = 0.6 / Math.sqrt(1 + n / 10);
  const lambda = 0.02;
  const p = predict(w, x);
  return w.map((wi, i) => wi + lr * ((y - p) * x[i] - lambda * (wi - PRIOR_W[i])));
}

export const stars = (p: number) => Math.round((0.5 + 4.5 * p) * 2) / 2;

export function explain(s: Scored, c: Ctx, p: number): string {
  if (s.path && s.path.weight > 0.06) {
    return s.path.rel === "related" ? `Close to ${s.path.via}, which you like` : explainPath(s.path);
  }
  const x = s.x;
  if (x[F.saga_next] > 0) return "Next in a saga you started";
  if (x[F.cf] > 0.3 && s.nearest) return `People who loved ${s.nearest.title} rate this highly`;
  if (s.nearest && x[F.emb_max_pos] > 0.55) {
    const e = c.d.entities[s.row];
    const a = c.d.entities[s.nearest.row];
    const shared = e.tags.filter((t) => a.tags.includes(t) && !GENERIC.has(t.toLowerCase())).slice(0, 2);
    return shared.length ? `Like ${a.title}: ${shared.join(", ")}` : `Close in tone to ${a.title}`;
  }
  if (x[F.tag_aff] > 0.2) {
    const e = c.d.entities[s.row];
    const t = e.tags.find((tg) => (c.p.tagAff.get(tg.toLowerCase()) ?? 0) > 0.2);
    if (t) return `You tend to like ${t.toLowerCase()}`;
  }
  const e = c.d.entities[s.row];
  if (c.p.n < 8) {
    const f = e.film;
    if (f?.va && (f.vc ?? 0) >= 200) {
      const votes = f.vc! >= 1000 ? `${Math.round(f.vc! / 1000)}k` : String(f.vc);
      return f.va >= 7.5 ? `Acclaimed: ${f.va.toFixed(1)}/10 from ${votes} ratings` : `Rated ${f.va.toFixed(1)}/10 by ${votes} people`;
    }
    if (e.item?.meta?.custom) return "You saved this";
    return p > 0.6 ? "Popular in this space" : "Helps us learn your taste";
  }
  return p > 0.65 ? "A strong fit for your profile" : "A good fit for your profile";
}

const GENERIC = new Set(["drama", "film", "television series", "comedy", "thriller", "action", "fr", "en"]);
