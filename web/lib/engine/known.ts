/**
 * "Will you know this title?" for the swipe deck. Replaying real answers (lib/engine/replay.ts) showed that
 * the number of people who rated a title predicts it best (AUC 0.75 on 321 seen / no-idea answers); TMDB's
 * trendiness score is no better than chance (0.49) and a per-user logistic model on kind / language / year
 * added noise. So the deck uses the votes percentile.
 */
import type { DomainData } from "../data";

const cache = new WeakMap<DomainData, Float32Array>();

/** Percentile (0..1) of the title's vote count within the catalogue; other spaces fall back to popularity. */
export function votesPct(d: DomainData, row: number): number {
  let c = cache.get(d);
  if (!c) {
    const n = d.entities.length;
    const val = (i: number) => d.entities[i].film?.vc ?? d.entities[i].pop;
    const idx = Array.from({ length: n }, (_, i) => i).sort((a, b) => val(a) - val(b));
    c = new Float32Array(n);
    idx.forEach((r, k) => (c![r] = n > 1 ? k / (n - 1) : 0.5));
    cache.set(d, c);
  }
  return c[row];
}
