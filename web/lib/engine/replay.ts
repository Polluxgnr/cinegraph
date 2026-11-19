/**
 * Offline replays of the in-browser engine (no DOM, no network): load an exported catalogue from disk, then
 *   - replayAnswers: walk a real answer history in order, predict each answer from the ones before it
 *     (profile, CF fold-in and the online ranker exactly as in the app), and score how well likes and rejections
 *     are separated (AUC), plus how well "do you know this title?" is predicted (known-vs-no-idea AUC);
 *   - heldOut: MovieLens-style users with known ratings and hidden favourites -> HR@10 / NDCG@10 of `recommend`.
 * Used by lib/engine/replay.eval.ts locally and by the weekly pipeline.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expandFilm, type FilmData, filmEntity, QMatrix } from "../data";
import { emptyState, type Feedback, ACTION_VALUE, type State } from "../store";
import type { Collection, Film } from "../types";
import { votesPct } from "./known";
import { recommend, scoreOne } from "./recommend";
import { sgdStep, weights } from "./score";

export function loadFilmsFromDisk(dir: string): FilmData {
  const read = <T,>(f: string) => JSON.parse(readFileSync(join(dir, f), "utf8")) as T;
  const mat = (prefix: string) => {
    try {
      const q = new Int8Array(readFileSync(join(dir, `${prefix}.i8`)).buffer.slice(0));
      const sBuf = readFileSync(join(dir, `${prefix}.scale.f32`));
      const scale = new Float32Array(sBuf.buffer.slice(sBuf.byteOffset, sBuf.byteOffset + sBuf.byteLength));
      return new QMatrix(q, scale, q.length / scale.length);
    } catch {
      return null;
    }
  };
  const films = read<Film[]>("catalog.json").map(expandFilm);
  const collections = read<Collection[]>("collections.json");
  const emb = mat("emb");
  const cf = mat("cf");
  const cfIds = (() => { try { return read<number[]>("cf_ids.json"); } catch { return []; } })();
  const entities = films.map(filmEntity);
  const norms = new Float32Array(emb ? emb.rows : 0);
  for (let i = 0; i < norms.length; i++) norms[i] = emb!.norm(i) || 1;
  return {
    name: "films", label: "Films & series", entities, index: new Map(entities.map((e, i) => [e.key, i])), emb, norms,
    films, people: read<string[]>("people.json"), collections, collectionOf: new Map(collections.map((c) => [c.key, c])),
    cf, cfIndex: new Map(cfIds.map((id, i) => [id, i])),
  };
}

const POS = new Set(["fav", "loved", "liked", "watching", "asap", "want"]);
const NEG = new Set(["disliked", "never", "dropped"]);
const NO_IDEA = new Set(["unknown"]);
const SEEN = new Set(["fav", "loved", "liked", "ok", "disliked", "dropped", "watching"]);

/** Area under the ROC curve: probability a random positive scores above a random negative. */
export function auc(pos: number[], neg: number[]): number {
  if (!pos.length || !neg.length) return NaN;
  let wins = 0;
  for (const p of pos) for (const n of neg) wins += p > n ? 1 : p === n ? 0.5 : 0;
  return wins / (pos.length * neg.length);
}

export interface ReplayResult { answers: number; tasteAUC: number; posMean: number; negMean: number; knownAUC: number; knownAUCBaseline: number }

/** Replay a history (oldest first); `init` overrides the ranker's starting weights (to compare variants). */
export function replayAnswers(d: FilmData, history: Feedback[], init?: number[]): ReplayResult {
  const s: State = emptyState();
  s.settings.hideBlocked = false;
  if (init) s.learned.ranker.films = { w: [...init], n: 0 };
  const pos: number[] = [], neg: number[] = [];
  const knownP: number[] = [], unknownP: number[] = [], knownB: number[] = [], unknownB: number[] = [];
  const seen: Feedback[] = [];
  for (const fb of history) {
    if (fb.domain !== "films") continue;
    const row = d.index.get(fb.key);
    if (row == null) continue;
    // 1) "do you know it?": votes percentile (deck now) vs log(votes)+log(trendiness) (deck before)
    if (SEEN.has(fb.action) || NO_IDEA.has(fb.action)) {
      const f = d.entities[row].film;
      const before = Math.log1p(f?.vc ?? 0) + Math.log1p(f?.pop ?? 0);
      (SEEN.has(fb.action) ? knownP : unknownP).push(votesPct(d, row));
      (SEEN.has(fb.action) ? knownB : unknownB).push(before);
    }
    // 2) taste predicted from the answers before this one
    const v = ACTION_VALUE[fb.action];
    if (v != null && fb.action !== "ok") {
      const rec = scoreOne(d, s, row);
      if (POS.has(fb.action)) pos.push(rec.p);
      if (NEG.has(fb.action)) neg.push(rec.p);
      const cur = s.learned.ranker.films;
      s.learned.ranker.films = { w: sgdStep(weights(cur), rec.scored.x, (v + 1) / 2, cur?.n ?? 0), n: (cur?.n ?? 0) + 1 };
    }
    s.feedback[fb.key] = fb;
    s.history.push(fb);
    seen.push(fb);
  }
  const mean = (x: number[]) => (x.length ? x.reduce((a, b) => a + b, 0) / x.length : NaN);
  return {
    answers: pos.length + neg.length, tasteAUC: auc(pos, neg), posMean: mean(pos), negMean: mean(neg),
    knownAUC: auc(knownP, unknownP), knownAUCBaseline: auc(knownB, unknownB),
  };
}

export interface HeldOutUser { known: [number, number][]; hidden: number[] } // [film id, rating /5], hidden film ids

/** HR@10 / NDCG@10 of the app's own `recommend` for users whose favourites were hidden. */
export function heldOut(d: FilmData, users: HeldOutUser[], init?: number[], auteurCap = true): { users: number; hr10: number; ndcg10: number } {
  let hr = 0, ndcg = 0, n = 0;
  for (const u of users) {
    const s = emptyState();
    s.settings.hideBlocked = false;
    if (init) s.learned.ranker.films = { w: [...init], n: 0 };
    for (const [id, r] of u.known) {
      const action = r >= 4.5 ? "loved" : r >= 3.5 ? "liked" : r >= 2.5 ? "ok" : "disliked";
      const key = `films:${id}`;
      if (d.index.has(key)) s.feedback[key] = { key, domain: "films", action, at: 0, rating: r };
    }
    const hidden = new Set(u.hidden.map((id) => `films:${id}`));
    if (!hidden.size) continue;
    const recs = recommend(d, s, { n: 10, explore: 0, auteurCap });
    const hits = recs.map((r) => hidden.has(r.entity.key));
    hr += hits.some(Boolean) ? 1 : 0;
    const dcg = hits.reduce((a, h, i) => a + (h ? 1 / Math.log2(i + 2) : 0), 0);
    const idcg = Array.from({ length: Math.min(hidden.size, 10) }, (_, i) => 1 / Math.log2(i + 2)).reduce((a, b) => a + b, 0);
    ndcg += dcg / idcg;
    n++;
  }
  return { users: n, hr10: n ? hr / n : NaN, ndcg10: n ? ndcg / n : NaN };
}
