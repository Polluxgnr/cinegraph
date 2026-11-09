/**
 * Answering = remembering + learning. The ranker sees the item's features as they were when you
 * answered, takes one SGD step towards your answer, and the tag bandit updates its arms.
 */
import { loadDomain } from "../data";
import { ACTION_VALUE, type Action, getState, recordFeedback, update } from "../store";
import { FEATURES } from "./score";
import { scoreOne } from "./recommend";
import { sgdStep, weights } from "./score";

export async function answer(
  key: string,
  domain: string,
  action: Action,
  extra: { chips?: string[]; rating?: number; source?: string } = {},
) {
  const d = await loadDomain(domain);
  const s = getState();
  const row = d.index.get(key);
  let predicted: number | undefined;
  if (row != null) {
    const rec = scoreOne(d, s, row);
    predicted = rec.p;
    let v = ACTION_VALUE[action];
    if (extra.rating != null) v = Math.max(-1, Math.min(1, (extra.rating - 3) / 2));
    if (v != null && action !== "ok") {
      const y = (v + 1) / 2;
      const cur = s.learned.ranker[domain];
      const w = sgdStep(weights(cur), rec.scored.x, y, cur?.n ?? 0);
      const tags = d.entities[row].tags.slice(0, 3).map((t) => t.toLowerCase());
      update((st) => {
        st.learned.ranker[domain] = { w, n: (cur?.n ?? 0) + 1 };
        const arms = (st.learned.arms[domain] ??= {});
        for (const t of tags) {
          const [a, b] = arms[t] ?? [1, 1];
          arms[t] = [a + y, b + (1 - y)];
        }
      });
    }
  }
  recordFeedback({ key, domain, action, predicted, ...extra });
}

/** Rebuild the ranker from scratch by replaying your history (e.g. after a model change). */
export async function relearn(domain: string) {
  const d = await loadDomain(domain);
  const s = getState();
  const hist = s.history.filter((h) => h.domain === domain);
  update((st) => {
    delete st.learned.ranker[domain];
    delete st.learned.arms[domain];
  });
  let w = weights(undefined);
  let n = 0;
  for (const h of hist) {
    const row = d.index.get(h.key);
    const v = h.rating != null ? (h.rating - 3) / 2 : ACTION_VALUE[h.action];
    if (row == null || v == null || h.action === "ok") continue;
    const rec = scoreOne(d, getState(), row);
    w = sgdStep(w, rec.scored.x, (v + 1) / 2, n++);
  }
  update((st) => {
    st.learned.ranker[domain] = { w, n };
  });
  return { examples: n, features: FEATURES.length };
}
