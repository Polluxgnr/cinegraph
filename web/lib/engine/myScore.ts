/**
 * How well the app knows *you*: hide one in five of the films you liked (every fifth, in the order you answered),
 * rebuild your model from scratch on everything else, in order, exactly as the app learns, then see where the
 * hidden favourites land among the recommendations. Runs in the browser, on demand.
 */
import type { FilmData } from "../data";
import { ACTION_VALUE, emptyState, type Feedback, type State } from "../store";
import { recommend, type RecOptions, scoreOne } from "./recommend";
import { sgdStep, weights } from "./score";

const POS = new Set(["loved", "fav", "liked"]);

export interface MyScore { liked: number; hidden: number; hr10: number; recall50: number; found: { key: string; rank: number }[] }

export function personalScore(d: FilmData, s: State, opts: RecOptions = {}, fold = 4): MyScore | null {
  const answers: Feedback[] = Object.values(s.feedback).filter((f) => f.domain === "films" && d.index.has(f.key)).sort((a, b) => a.at - b.at);
  const liked = answers.filter((f) => POS.has(f.action));
  if (liked.length < 15) return null;
  const hidden = new Set(liked.filter((_, i) => i % 5 === fold).map((f) => f.key));

  // a fresh copy of you, without the hidden answers, trained in the order you answered
  const t: State = emptyState();
  t.settings = { ...s.settings };
  for (const fb of answers) {
    if (hidden.has(fb.key)) continue;
    const row = d.index.get(fb.key)!;
    const v = ACTION_VALUE[fb.action];
    if (v != null && fb.action !== "ok") {
      const rec = scoreOne(d, t, row);
      const cur = t.learned.ranker.films;
      t.learned.ranker.films = { w: sgdStep(weights(cur), rec.scored.x, (v + 1) / 2, cur?.n ?? 0), n: (cur?.n ?? 0) + 1 };
    }
    t.feedback[fb.key] = fb;
    t.history.push(fb);
  }
  const recs = recommend(d, t, { n: 50, explore: 0, ...opts });
  const found = recs.map((r, i) => ({ key: r.entity.key, rank: i + 1 })).filter((x) => hidden.has(x.key));
  return {
    liked: liked.length,
    hidden: hidden.size,
    hr10: found.some((x) => x.rank <= 10) ? 1 : 0,
    recall50: found.length / hidden.size,
    found,
  };
}
