/**
 * Engine variants on held-out MovieLens users (opt-in, local):
 *   CINEGRAPH_EVAL_USERS=eval_users.json CINEGRAPH_EVAL_OUT=out.json npx vitest run --config vitest.replay.config.ts tune
 * Each user: known ratings in, a fifth of their favourites hidden; HR@10 / NDCG@10 of `recommend`.
 * CINEGRAPH_EVAL_COLD=10 keeps only 10 known ratings per user (a new user).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { test } from "vitest";
import { heldOut, type HeldOutUser, loadFilmsFromDisk } from "./replay";
import { DEFAULT_W, FEATURES, KNOBS, tunePrior } from "./score";

test("tune", () => {
  const path = process.env.CINEGRAPH_EVAL_USERS;
  if (!path) return;
  const d = loadFilmsFromDisk("public/data/films");
  let users = JSON.parse(readFileSync(path, "utf8")) as HeldOutUser[];
  const cold = Number(process.env.CINEGRAPH_EVAL_COLD ?? 0);
  if (cold) users = users.map((u) => ({ ...u, known: u.known.slice(0, cold) }));
  users = users.slice(0, Number(process.env.CINEGRAPH_EVAL_N ?? 150));
  const F = Object.fromEntries(FEATURES.map((f, i) => [f, i])) as Record<string, number>;
  const w = (ch: Record<string, number>) => DEFAULT_W.map((x, i) => (FEATURES[i] in ch ? ch[FEATURES[i]] : x));
  const base = { ...KNOBS };
  const variants: Record<string, { knobs?: Partial<typeof KNOBS>; w?: number[] }> = JSON.parse(process.env.CINEGRAPH_VARIANTS ?? "null") ?? {
    now: {},
    cfq1: { knobs: { cfQuick: 1 } },
    cfq2: { knobs: { cfQuick: 2 } },
    cfq2_cf2: { knobs: { cfQuick: 2 }, w: w({ cf: 2 }) },
    cfq2_cf3: { knobs: { cfQuick: 2 }, w: w({ cf: 3 }) },
  };
  const out: Record<string, unknown> = {};
  for (const [name, v] of Object.entries(variants)) {
    Object.assign(KNOBS, base, v.knobs ?? {});
    // as in the app: starting weights tuned by the weekly evaluation (CINEGRAPH_LIVE_EVAL = manifest.json's "eval")
    tunePrior(process.env.CINEGRAPH_LIVE_EVAL ? JSON.parse(readFileSync(process.env.CINEGRAPH_LIVE_EVAL, "utf8")) : undefined);
    const ww = Array.isArray(v.w) ? v.w : v.w ? w(v.w as unknown as Record<string, number>) : undefined;
    const t0 = Date.now();
    out[name] = { ...heldOut(d, users, ww), ms: Date.now() - t0 };
    writeFileSync(process.env.CINEGRAPH_EVAL_OUT ?? "tune.json", JSON.stringify(out, null, 1));
  }
  Object.assign(KNOBS, base);
  void F;
}, 3_600_000);
