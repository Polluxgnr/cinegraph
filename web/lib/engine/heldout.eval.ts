/**
 * The app's own engine on held-out MovieLens users (run by the weekly pipeline, see .github/workflows/data.yml):
 *   CINEGRAPH_DATA=<export>/films CINEGRAPH_EVAL_USERS=<data>/eval_users.json CINEGRAPH_EVAL_OUT=out.json  *   npx vitest run --config vitest.replay.config.ts lib/engine/heldout.eval.ts
 * "before" = the engine as it was before the last tuning round, "after" = now.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { heldOut, loadFilmsFromDisk, type HeldOutUser } from "./replay";
import { DEFAULT_W, FEATURES } from "./score";

/** Ranker defaults before the November 2026 round (new genre / kind features off). */
export const PREVIOUS_W = [-0.6, 2.2, 2.6, -2.0, 1.6, 1.4, 1.0, 1.0, 0.6, 0.4, 0.5, 0.9, 0.35, 0.15, 1.2, 0.4, 0, 0];

test("held-out favourites, app engine", () => {
  const usersPath = process.env.CINEGRAPH_EVAL_USERS;
  if (!usersPath) return;
  expect(PREVIOUS_W).toHaveLength(FEATURES.length);
  const d = loadFilmsFromDisk(process.env.CINEGRAPH_DATA ?? "public/data/films");
  const users = JSON.parse(readFileSync(usersPath, "utf8")) as HeldOutUser[];
  const out = { before: heldOut(d, users, PREVIOUS_W, false), after: heldOut(d, users, DEFAULT_W, true) };
  writeFileSync(process.env.CINEGRAPH_EVAL_OUT ?? "heldout-result.json", JSON.stringify(out, null, 1));
}, 1_800_000);
