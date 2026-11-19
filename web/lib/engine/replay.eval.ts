/**
 * Local replay of a real synced memory (opt-in, never in CI):
 *   CINEGRAPH_MEMORY=/path/to/memory.json npx vitest run --config vitest.replay.config.ts
 * Prints before/after metrics for the engine variants being compared.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import type { Feedback, State } from "../store";
import { loadFilmsFromDisk, replayAnswers } from "./replay";
import { DEFAULT_W, FEATURES } from "./score";

test("replay my answers", () => {
  const path = process.env.CINEGRAPH_MEMORY;
  if (!path) return;
  const mem = JSON.parse(readFileSync(path, "utf8")) as State;
  const d = loadFilmsFromDisk("public/data/films");
  const hist: Feedback[] = [...mem.history].sort((a, b) => a.at - b.at);
  const F = Object.fromEntries(FEATURES.map((f, i) => [f, i])) as Record<string, number>;
  const tweak = (ch: Record<string, number>) => DEFAULT_W.map((w, i) => (FEATURES[i] in ch ? ch[FEATURES[i]] : w));
  const variants: Record<string, number[] | undefined> = {
    defaults: DEFAULT_W,
    cf_x2_5: tweak({ cf: DEFAULT_W[F.cf] * 2.5 }),
    less_content: tweak({ emb_profile: 1.1, emb_max_pos: 1.3 }),
    more_neg: tweak({ emb_max_neg: -3.5, tag_aff: 2.4 }),
    cf_less_content_more_neg: tweak({ cf: 2.5, emb_profile: 1.1, emb_max_pos: 1.3, emb_max_neg: -3.5, tag_aff: 2.4 }),
    quality_up: tweak({ quality: 1.5, popularity: 0.6 }),
  };
  const out: Record<string, unknown> = {};
  for (const [name, init] of Object.entries(variants)) out[name] = replayAnswers(d, hist, init);
  writeFileSync(process.env.CINEGRAPH_REPLAY_OUT ?? "replay-result.json", JSON.stringify(out, null, 1));
  expect(true).toBe(true);
}, 600_000);
