/**
 * Your own score under engine variants (opt-in, never in CI):
 *   CINEGRAPH_MEMORY=/path/to/memory.json npx vitest run --config vitest.replay.config.ts myscore
 * Hides every 5th liked film (5 rotations), rebuilds, counts hidden favourites in the top 50.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { migrate, type State } from "../store";
import { personalScore } from "./myScore";
import type { RecOptions } from "./recommend";
import { loadFilmsFromDisk } from "./replay";
import { DEFAULT_W, FEATURES, KNOBS, tunePrior } from "./score";

test("my score variants", () => {
  const path = process.env.CINEGRAPH_MEMORY;
  if (!path) return;
  const mem = migrate(JSON.parse(readFileSync(path, "utf8"))) as State;
  const d = loadFilmsFromDisk("public/data/films");
  // measured Nov 2026: a "probably seen elsewhere" discount on famous titles lowered recall (3/68 and 1/68 vs 5/68),
  // the favourite-genre slot left it unchanged; the slot stays (it changes which titles lead, not what's found).
  // CINEGRAPH_VARIANTS='{"name": {"cf": 3, "cfQuick": 1}}' compares ranker weights / knobs on your answers.
  const knobs = JSON.parse(process.env.CINEGRAPH_VARIANTS ?? "null") as Record<string, Record<string, number>> | null;
  const variants: Record<string, RecOptions & { set?: Record<string, number> }> = knobs
    ? Object.fromEntries(Object.entries(knobs).map(([k, v]) => [k, { set: v }]))
    : { before: { genreSlot: false }, slot: { genreSlot: true } };
  const W0 = [...DEFAULT_W], K0 = { ...KNOBS };
  const out: Record<string, unknown> = {};
  for (const [name, o] of Object.entries(variants)) {
    let found = 0, hidden = 0, hr = 0;
    DEFAULT_W.splice(0, DEFAULT_W.length, ...W0);
    Object.assign(KNOBS, K0);
    for (const [k, v] of Object.entries(o.set ?? {})) {
      if (k in KNOBS) (KNOBS as Record<string, number>)[k] = v;
      else DEFAULT_W[FEATURES.indexOf(k as (typeof FEATURES)[number])] = v;
    }
    tunePrior(process.env.CINEGRAPH_LIVE_EVAL ? JSON.parse(readFileSync(process.env.CINEGRAPH_LIVE_EVAL, "utf8")) : undefined);
    for (let fold = 0; fold < 5; fold++) {
      const res = personalScore(d, mem, o, fold);
      if (!res) continue;
      found += res.found.length; hidden += res.hidden; hr += res.hr10;
    }
    out[name] = { found, hidden, recall50: found / Math.max(1, hidden), hr10: hr / 5 };
  }
  writeFileSync(process.env.CINEGRAPH_REPLAY_OUT ?? "myscore-result.json", JSON.stringify(out, null, 1));
  expect(true).toBe(true);
}, 1_800_000);
