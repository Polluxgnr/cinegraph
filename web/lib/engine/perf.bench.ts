// Profiles the engine on the real exported catalogue (needs public/data): `npm run perf`.
import { readFileSync } from "node:fs";
import { it } from "vitest";
import { type FilmData, filmEntity, QMatrix } from "../data";
import { emptyState } from "../store";
import type { Film } from "../types";
import { nextCard } from "./active";
import { buildProfile } from "./profile";
import { context, recommend, scoreOne } from "./recommend";

const dir = "public/data/films/";
function qm(p: string) {
  const q = new Int8Array(readFileSync(dir + p + ".i8").buffer.slice(0));
  const s = new Float32Array(readFileSync(dir + p + ".scale.f32").buffer.slice(0));
  return new QMatrix(q, s, q.length / s.length);
}

it("profile the engine", () => {
  const films: Film[] = JSON.parse(readFileSync(dir + "catalog.json", "utf-8"));
  const emb = qm("emb");
  const cf = qm("cf");
  const cfIds: number[] = JSON.parse(readFileSync(dir + "cf_ids.json", "utf-8"));
  const entities = films.map(filmEntity);
  const d: FilmData = {
    name: "films", label: "f", entities, index: new Map(entities.map((e, i) => [e.key, i])), emb,
    norms: new Float32Array(emb.rows).map((_, i) => emb.norm(i)), films, people: JSON.parse(readFileSync(dir + "people.json", "utf-8")),
    collections: JSON.parse(readFileSync(dir + "collections.json", "utf-8")), collectionOf: new Map(), cf, cfIndex: new Map(cfIds.map((id, i) => [id, i])),
  };
  d.collections.forEach((c) => d.collectionOf.set(c.key, c));
  const s = emptyState();
  for (const i of [10, 50, 90, 130, 170]) s.feedback[entities[i].key] = { key: entities[i].key, domain: "films", action: "liked", at: i };
  const t = (label: string, fn: () => unknown) => {
    const a = performance.now();
    fn();
    process.stderr.write(`PERF ${label} ${Math.round(performance.now() - a)} ms
`);
  };
  t("profile", () => buildProfile(d, s));
  t("profile 2", () => buildProfile(d, s));
  t("context", () => context(d, s));
  t("scoreOne", () => scoreOne(d, s, 300));
  t("nextCard 1", () => nextCard(d, s));
  t("nextCard 2", () => nextCard(d, s));
  t("recommend", () => recommend(d, s, { n: 20 }));
});
