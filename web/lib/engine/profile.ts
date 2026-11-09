/**
 * Taste profile of one domain, rebuilt from your answers each time it's needed (cheap: answers
 * are few compared with the catalogue). Every answer therefore changes the next ranking.
 */
import { isFilmData, type DomainData, type FilmData } from "../data";
import { ACTION_VALUE, type State } from "../store";
import type { Film } from "../types";
import { solveSPD } from "./linalg";

export interface Anchor {
  row: number;
  key: string;
  w: number; // taste weight in [-1, 1]
  title: string;
  label: string; // "which you loved"
}

export interface Profile {
  domain: string;
  anchors: Anchor[];
  pos: Anchor[];
  neg: Anchor[];
  answered: Set<string>;
  vector: Float32Array | null; // weighted mean embedding
  tagAff: Map<string, number>; // shrunk mean weight per tag
  n: number; // number of informative answers
  // films only
  people?: Map<number, number>;
  lang?: Map<string, number>;
  decade?: Map<number, number>;
  runtimePref?: { mean: number; tolerance: number }; // minutes
  chipPenalty?: Map<string, number>; // "Too long" -> strength
  cfUser?: Float32Array | null;
}

const LABEL: Record<string, string> = {
  loved: "which you loved",
  liked: "which you liked",
  ok: "which you found ok",
  disliked: "which wasn't your thing",
  watching: "which you're watching",
  want: "on your list",
  maybe: "which you might watch",
  never: "which you said never to",
};

function shrunkMean(acc: Map<string | number, number[]>, prior = 2): Map<string | number, number> {
  const out = new Map<string | number, number>();
  acc.forEach((ws, k) => out.set(k, ws.reduce((a, b) => a + b, 0) / (ws.length + prior)));
  return out;
}

export function buildProfile(d: DomainData, s: State): Profile {
  const anchors: Anchor[] = [];
  const answered = new Set<string>();
  for (const fb of Object.values(s.feedback)) {
    if (fb.domain !== d.name) continue;
    answered.add(fb.key);
    let w = ACTION_VALUE[fb.action];
    if (fb.rating != null) w = Math.max(-1, Math.min(1, (fb.rating - 3) / 2));
    const row = d.index.get(fb.key);
    if (w == null || row == null) continue;
    anchors.push({ row, key: fb.key, w, title: d.entities[row].title, label: fb.rating ? `which you rated ${fb.rating}` : LABEL[fb.action] });
  }
  const pos = anchors.filter((a) => a.w > 0.25).sort((a, b) => b.w - a.w);
  const neg = anchors.filter((a) => a.w < -0.25);

  let vector: Float32Array | null = null;
  if (d.emb && anchors.length) {
    const acc = new Float32Array(d.emb.dim);
    let tot = 0;
    for (const a of anchors) {
      const c = a.w > 0 ? a.w : 0.5 * a.w; // dislikes push away, but less strongly
      const v = d.emb.row(a.row);
      for (let j = 0; j < v.length; j++) acc[j] += c * v[j];
      tot += Math.abs(c);
    }
    let n = 0;
    for (let j = 0; j < acc.length; j++) n += acc[j] * acc[j];
    if (tot > 0 && n > 1e-12) {
      n = Math.sqrt(n);
      for (let j = 0; j < acc.length; j++) acc[j] /= n;
      vector = acc;
    }
  }

  const tags = new Map<string, number[]>();
  for (const a of anchors) for (const t of d.entities[a.row].tags.slice(0, 12)) {
    const k = t.toLowerCase();
    tags.set(k, [...(tags.get(k) ?? []), a.w]);
  }

  const p: Profile = {
    domain: d.name,
    anchors,
    pos,
    neg,
    answered,
    vector,
    tagAff: shrunkMean(tags) as Map<string, number>,
    n: anchors.length,
  };
  if (isFilmData(d)) Object.assign(p, filmPreferences(d, s, anchors));
  return p;
}

function filmPreferences(d: FilmData, s: State, anchors: Anchor[]) {
  const people = new Map<number, number[]>();
  const lang = new Map<string, number[]>();
  const decade = new Map<number, number[]>();
  const liked: number[] = [];
  for (const a of anchors) {
    const f = d.films[a.row];
    for (const pid of [...(f.dir ?? []), ...(f.wri ?? []), ...(f.cre ?? []), ...(f.cast ?? []).slice(0, 6), ...(f.mus ?? [])]) {
      people.set(pid, [...(people.get(pid) ?? []), a.w]);
    }
    if (f.lang) lang.set(f.lang, [...(lang.get(f.lang) ?? []), a.w]);
    if (f.y) {
      const dec = Math.floor(f.y / 10) * 10;
      decade.set(dec, [...(decade.get(dec) ?? []), a.w]);
    }
    if (a.w > 0.3 && f.rt && f.k === "movie") liked.push(f.rt);
  }
  const chipPenalty = new Map<string, number>();
  for (const fb of Object.values(s.feedback)) {
    if (fb.domain === "films") for (const c of fb.chips ?? []) chipPenalty.set(c, (chipPenalty.get(c) ?? 0) + 1);
  }
  const mean = liked.length ? liked.reduce((x, y) => x + y, 0) / liked.length : 115;
  const sd = liked.length > 2 ? Math.sqrt(liked.reduce((x, y) => x + (y - mean) ** 2, 0) / liked.length) : 30;
  return {
    people: shrunkMean(people, 1) as Map<number, number>,
    lang: shrunkMean(lang, 3) as Map<string, number>,
    decade: shrunkMean(decade, 3) as Map<number, number>,
    runtimePref: { mean, tolerance: Math.max(20, sd) },
    chipPenalty,
    cfUser: foldInCF(d, anchors),
  };
}

/** ALS user vector from your answers: x = (YᵀY + Yᵤᵀ(Cᵤ−I)Yᵤ + λI)⁻¹ Yᵤᵀ Cᵤ p  (Hu, Koren & Volinsky). */
let YtY: Float64Array | null = null;
function foldInCF(d: FilmData, anchors: Anchor[]): Float32Array | null {
  const cf = d.cf;
  if (!cf) return null;
  const k = cf.dim;
  if (!YtY) {
    YtY = new Float64Array(k * k);
    for (let i = 0; i < cf.rows; i++) {
      const y = cf.row(i, false);
      for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) YtY[a * k + b] += y[a] * y[b];
    }
  }
  const A = Float64Array.from(YtY);
  const rhs = new Float64Array(k);
  let used = 0;
  for (const an of anchors) {
    if (an.w <= 0) continue;
    const row = d.cfIndex.get(d.films[an.row].id);
    if (row == null) continue;
    const c = 1 + 8 * an.w;
    const y = cf.row(row, false);
    for (let a = 0; a < k; a++) {
      rhs[a] += c * y[a];
      for (let b = 0; b < k; b++) A[a * k + b] += (c - 1) * y[a] * y[b];
    }
    used++;
  }
  if (!used) return null;
  for (let a = 0; a < k; a++) A[a * k + a] += 0.05;
  return Float32Array.from(solveSPD(A, rhs, k));
}

export function filmDecade(f: Film): number | null {
  return f.y ? Math.floor(f.y / 10) * 10 : null;
}
