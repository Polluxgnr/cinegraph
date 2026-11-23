/**
 * People (actors, directors, writers, composers): photo and ids from the weekly build (films/people/N.json,
 * sharded), biography and full career live from Wikidata + Wikipedia (open data, no key, nothing scraped).
 */
import { type FilmData, json } from "./data";
import { currentLang } from "./i18n";
import type { Film } from "./types";
import { sparql } from "./wikidata";

export interface PersonMeta { tm?: number; img?: string; wd?: string; name?: string }

const SHARDS = 64;
const shards = new Map<number, Promise<Record<string, [number | null, string | null, string | null, string?]>>>();

export async function personMeta(idx: number): Promise<PersonMeta> {
  const n = idx % SHARDS;
  if (!shards.has(n)) shards.set(n, json<Record<string, [number | null, string | null, string | null, string?]>>(`/data/films/people/${n}.json`).catch(() => ({})));
  const m = (await shards.get(n)!)[String(idx)];
  return m ? { tm: m[0] ?? undefined, img: m[1] ?? undefined, wd: m[2] ?? undefined, name: m[3] } : {};
}

export const photoUrl = (img?: string, size: "w185" | "h632" = "w185") =>
  !img ? undefined : img.startsWith("http") ? img : `https://image.tmdb.org/t/p/${size}${img}`;

export type Role = "Director" | "Creator" | "Writer" | "Actor" | "Music";

/** Every title of the catalogue this person worked on, with their role(s). */
export function careerInCatalog(d: FilmData, idx: number): { row: number; roles: Role[] }[] {
  const out: { row: number; roles: Role[] }[] = [];
  d.films.forEach((f, row) => {
    const roles: Role[] = [];
    if (f.dir?.includes(idx)) roles.push("Director");
    if (f.cre?.includes(idx)) roles.push("Creator");
    if (f.wri?.includes(idx)) roles.push("Writer");
    if (f.cast?.includes(idx)) roles.push("Actor");
    if (f.mus?.includes(idx)) roles.push("Music");
    if (roles.length) out.push({ row, roles });
  });
  return out;
}

/** A person's name: the catalogue's list holds people on cards; deeper cast names come with their shard. */
export const personName = (d: FilmData, idx: number, meta?: PersonMeta) => d.people[idx] ?? meta?.name ?? "";

/** Name -> person index, built once per catalogue (157k names). */
const byName = new WeakMap<FilmData, Map<string, number>>();
export function personIndex(d: FilmData, name: string): number | undefined {
  if (!byName.has(d)) byName.set(d, new Map(d.people.map((n, i) => [n.toLowerCase(), i])));
  return byName.get(d)!.get(name.toLowerCase());
}

/** Titles per person (director, creator or cast), counted once per catalogue. */
const countsOf = new WeakMap<FilmData, Uint16Array>();
function creditCounts(d: FilmData): Uint16Array {
  let c = countsOf.get(d);
  if (!c) {
    c = new Uint16Array(d.people.length);
    for (const f of d.films) for (const i of new Set([...(f.dir ?? []), ...(f.cre ?? []), ...(f.cast ?? [])])) c[i]++;
    countsOf.set(d, c);
  }
  return c;
}

/** People whose name contains every word of the query, most prolific in the catalogue first. */
export function searchPeople(d: FilmData, q: string, limit = 12): number[] {
  const words = q.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  if (!words.length) return [];
  const hits: number[] = [];
  for (let i = 0; i < d.people.length && hits.length < 400; i++) {
    const n = d.people[i].toLowerCase();
    if (words.every((w) => n.includes(w))) hits.push(i);
  }
  const counts = creditCounts(d);
  return hits.map((i) => [i, counts[i]] as const).filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([i]) => i);
}

export interface Bio {
  qid: string;
  description?: string;
  born?: string;
  died?: string;
  birthplace?: string;
  image?: string;
  wikipedia?: string;
  summary?: string;
}

/** Wikidata person (by Wikidata id, else TMDB person id P4985) + the Wikipedia summary in the interface language. */
export async function personBio(m: PersonMeta, name?: string): Promise<Bio | null> {
  const lang = currentLang();
  // by id, else by exact name among people who have a TMDB person id (so: film people, not namesakes)
  const label = name ? JSON.stringify(name) : null;
  const who = m.wd ? `BIND(wd:${m.wd} AS ?p)` : m.tm ? `?p wdt:P4985 "${m.tm}" .` : label
    ? `SERVICE wikibase:mwapi { bd:serviceParam wikibase:endpoint "www.wikidata.org"; wikibase:api "EntitySearch"; mwapi:search ${label}; mwapi:language "en".
         ?p wikibase:apiOutputItem mwapi:item. ?ord wikibase:apiOrdinal true. }
       ?p wdt:P4985 ?anyTmdb .`
    : null;
  if (!who) return null;
  const rows = await sparql(`SELECT ?p ?pDescription ?born ?died ?placeLabel ?img ?article WHERE {
    ${who}
    OPTIONAL { ?p wdt:P569 ?born } OPTIONAL { ?p wdt:P570 ?died } OPTIONAL { ?p wdt:P19 ?place } OPTIONAL { ?p wdt:P18 ?img }
    OPTIONAL { ?article schema:about ?p ; schema:isPartOf <https://${lang}.wikipedia.org/> }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "${lang},en". }
  } ${label && !m.wd && !m.tm ? "ORDER BY ?ord" : ""} LIMIT 1`, 25_000);
  const r = rows[0];
  if (!r?.p) return null;
  const bio: Bio = {
    qid: r.p.value.split("/").pop()!,
    description: r.pDescription?.value,
    born: r.born?.value?.slice(0, 10),
    died: r.died?.value?.slice(0, 10),
    birthplace: r.placeLabel?.value,
    image: r.img?.value ? `${r.img.value.replace("http://", "https://")}?width=400` : undefined,
    wikipedia: r.article?.value,
  };
  if (bio.wikipedia) {
    const t = bio.wikipedia.split("/wiki/")[1];
    const s = await fetch(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${t}`, { signal: AbortSignal.timeout(15_000) })
      .then((x) => (x.ok ? x.json() : null)).catch(() => null);
    bio.summary = s?.extract;
  }
  return bio;
}

export interface Work { qid: string; title: string; year?: number; role: "Actor" | "Director" | "Writer" | "Music"; tmdb?: number; tv: boolean }

/** The whole career as Wikidata records it: films and series as cast member, director, screenwriter, composer. */
export async function wikidataCareer(qid: string): Promise<Work[]> {
  const lang = currentLang();
  const rows = await sparql(`SELECT ?w ?wLabel ?role (MIN(?d) AS ?date) (SAMPLE(?tm) AS ?tmdb) (SAMPLE(?tv) AS ?tvid) WHERE {
    VALUES (?prop ?role) { (wdt:P161 "Actor") (wdt:P57 "Director") (wdt:P58 "Writer") (wdt:P86 "Music") }
    ?w ?prop wd:${qid} .
    OPTIONAL { ?w wdt:P577 ?d } OPTIONAL { ?w wdt:P4947 ?tm } OPTIONAL { ?w wdt:P4983 ?tv }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "${lang},en". }
  } GROUP BY ?w ?wLabel ?role LIMIT 600`, 40_000);
  return rows.filter((r) => r.w && r.wLabel && !/^Q\d+$/.test(r.wLabel.value)).map((r) => ({
    qid: r.w!.value.split("/").pop()!,
    title: r.wLabel!.value,
    year: r.date?.value ? Number(r.date.value.slice(0, 4)) : undefined,
    role: r.role!.value as Work["role"],
    tmdb: r.tmdb?.value ? Number(r.tmdb.value) : r.tvid?.value ? Number(r.tvid.value) : undefined,
    tv: !!r.tvid?.value,
  }));
}

/** Catalogue row of a TMDB id (movie or series). */
const byTmdb = new WeakMap<FilmData, Map<string, number>>();
export function rowOfTmdb(d: FilmData, id: number, tv: boolean): number | undefined {
  if (!byTmdb.has(d)) byTmdb.set(d, new Map(d.films.map((f: Film, i) => [`${f.k}:${f.x?.tm}`, i])));
  return byTmdb.get(d)!.get(`${tv ? "tv" : "movie"}:${id}`);
}

/** Person page link: index for speed, name so the link survives a catalogue rebuild (indexes change). */
/** `from`: the title the link sits on, listed on the person's page even when the catalogue only keeps its main cast. */
export const personHref = (idx: number, name: string, from?: string) => `/person/?p=${idx}&n=${encodeURIComponent(name)}${from ? `&f=${encodeURIComponent(from)}` : ""}`;
