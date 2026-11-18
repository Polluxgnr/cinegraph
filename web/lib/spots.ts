"use client";
/**
 * Best spots around a place, live from Wikidata's public SPARQL endpoint (CORS): notable things within a radius,
 * with photo, kind and coordinates, plus filming locations of the films you loved. Cached per place for the visit.
 */
import { loadFilms } from "./data";
import { getState } from "./store";
import type { Entity } from "./types";

export interface Spot { q: string; name: string; desc?: string; img?: string; type?: string; group: string; sl: number; dist: number; lat: number; lon: number; film?: string }

export const GROUPS: [string, RegExp, string][] = [
  ["Museums & art", /\b(museum|art museum|gallery|art gallery|exhibition|musée)\b/i, "#c084fc"],
  ["Sacred places", /\b(church|cathedral|basilica|temple|mosque|abbey|monastery|shrine|synagogue|chapel|sanctuaire|temple bouddhiste)\b/i, "#fbbf24"],
  ["Nature & views", /\b(park|garden|beach|mountain|peak|lake|waterfall|forest|island|cave|river|bay|cliff|valley|nature reserve|volcano|glacier|viewpoint|montagne|parc|jardin|plage)\b/i, "#4ade80"],
  ["Landmarks & history", /\b(castle|palace|fort|fortress|monument|tower|bridge|square|archaeological site|ruins|memorial|statue|gate|lighthouse|historic site|world heritage site|building|palais|château|pont|place)\b/i, "#60a5fa"],
  ["Food, markets & nights", /\b(restaurant|café|cafe|bar|market|brewery|winery|food|shopping street|street|neighbourhood|neighborhood|quarter|quartier|district|marché)\b/i, "#fb7185"],
  ["Culture & shows", /\b(theatre|theater|opera house|concert hall|stadium|arena|cinema|library|zoo|aquarium|amusement park|théâtre|opéra)\b/i, "#22d3ee"],
];
export const GROUP_COLOR = Object.fromEntries([...GROUPS.map(([n, , c]) => [n, c]), ["Other places", "#a1a1aa"], ["Filming locations", "#f97316"]]) as Record<string, string>;
/** Infrastructure and events aren't spots to visit. */
const NOT_A_SPOT = /\b(university|college|school|metro|subway|railway|railway station|train station|station|line|airport|hospital|company|business|road|highway|tram|bus|rapid transit|transit|event|attack|arson|murder|massacre|disaster|incident|fire|earthquake|battle|war|siege|election|treaty)\b/i;
const ABSTRACT = /\b(country|empire|state|city|comune|capital|region|province|civilization|period|metropolitan|municipality|diocese|archdiocese|commune|county|prefecture|ward|district of|historical country|polity|sovereign)\b/i;

const groupOf = (type?: string, desc?: string) =>
  GROUPS.find(([, re]) => re.test(type ?? ""))?.[0] ?? GROUPS.find(([, re]) => re.test(desc ?? ""))?.[0] ?? "Other places";

function sparql(q: string): Promise<Record<string, { value: string }>[]> {
  return fetch(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(q)}`, {
    headers: { Accept: "application/sparql-results+json" }, signal: AbortSignal.timeout(45_000),
  })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Wikidata ${r.status}`))))
    .then((j) => j.results.bindings);
}

const point = (v?: string) => {
  const m = v?.match(/Point\(([-\d.]+) ([-\d.]+)\)/);
  return m ? { lon: +m[1], lat: +m[2] } : null;
};

export function coordOf(e: Entity): { lon: number; lat: number } | null {
  return point(String(e.item?.meta?.coord ?? ""));
}
export const radiusOf = (e: Entity) => (e.tags.includes("city") ? 12 : 25);

const cache = new Map<string, Promise<Spot[]>>();

export function fetchSpots(e: Entity): Promise<Spot[]> {
  const c = coordOf(e);
  if (!c) return Promise.resolve([]);
  if (!cache.has(e.key)) {
    const p = load(e, c).catch((x) => {
      cache.delete(e.key);
      throw x;
    });
    cache.set(e.key, p);
  }
  return cache.get(e.key)!;
}

async function load(e: Entity, { lon, lat }: { lon: number; lat: number }): Promise<Spot[]> {
  const around = `SERVICE wikibase:around { ?a wdt:P625 ?loc . bd:serviceParam wikibase:center "Point(${lon} ${lat})"^^geo:wktLiteral ; wikibase:radius "${radiusOf(e)}" ; wikibase:distance ?dist . }`;
  // 1) notable things nearby (fast), 2) photo + kind for just those, 3) filming locations of your films
  const rows = await sparql(`SELECT ?a ?aLabel ?aDescription ?sl ?dist ?loc WHERE {
    ${around}
    ?a wikibase:sitelinks ?sl . FILTER(?sl >= 6)
    SERVICE wikibase:label { bd:serviceParam wikibase:language "fr,en". }
  } ORDER BY DESC(?sl) LIMIT 90`);
  const self = e.key.split(":")[1];
  let list = rows
    .map((r) => ({ q: r.a.value.split("/").pop()!, name: r.aLabel?.value ?? "", desc: r.aDescription?.value, sl: Number(r.sl?.value ?? 0), dist: Number(r.dist?.value ?? 0), ...(point(r.loc?.value) ?? { lon, lat }) }))
    .filter((s, i, all) => s.name && s.q !== self && !/^Q\d+$/.test(s.name) && all.findIndex((x) => x.q === s.q) === i);
  const det = await sparql(`SELECT ?a (SAMPLE(?i) AS ?img) (GROUP_CONCAT(DISTINCT ?tl; separator="|") AS ?types) WHERE {
    VALUES ?a { ${list.map((x) => `wd:${x.q}`).join(" ")} }
    OPTIONAL { ?a wdt:P18 ?i }
    OPTIONAL { ?a wdt:P31 ?t . ?t rdfs:label ?tl . FILTER(LANG(?tl) = "en") }
  } GROUP BY ?a`).catch(() => []);
  const info = new Map(det.map((r) => [r.a.value.split("/").pop()!, r]));
  const spots: Spot[] = list
    .map((x) => {
      const r = info.get(x.q);
      const type = r?.types?.value.split("|").slice(0, 3).join(", ");
      return { ...x, type, group: groupOf(type, x.desc), img: r?.img?.value ? `${r.img.value.replace("http://", "https://")}?width=480` : undefined };
    })
    .filter((x) => !ABSTRACT.test(x.type ?? "") && !NOT_A_SPOT.test(x.type ?? ""));
  list = [];
  const s = getState();
  const loved = Object.values(s.feedback).filter((f) => f.domain === "films" && ["fav", "loved", "liked"].includes(f.action)).map((f) => f.key);
  if (loved.length) {
    const films = await loadFilms();
    const qids = loved.map((k) => films.films[films.index.get(k) ?? -1]?.links?.wikidata?.split("/").pop()).filter((q): q is string => !!q).slice(0, 200);
    if (qids.length) {
      const hits = await sparql(`SELECT ?a ?aLabel ?filmLabel ?loc ?dist WHERE {
        VALUES ?film { ${qids.map((q) => `wd:${q}`).join(" ")} }
        ?film wdt:P915 ?a . ${around}
        SERVICE wikibase:label { bd:serviceParam wikibase:language "fr,en". }
      } LIMIT 30`).catch(() => []);
      for (const h of hits) {
        const q = h.a.value.split("/").pop()!;
        const spot = spots.find((x) => x.q === q);
        if (spot) spot.film = h.filmLabel?.value;
        else spots.unshift({ q, name: h.aLabel?.value ?? q, film: h.filmLabel?.value, sl: 0, dist: Number(h.dist?.value ?? 0), ...(point(h.loc?.value) ?? { lon, lat }), type: "filming location", group: "Filming locations" });
      }
    }
  }
  return spots;
}

/** Ranked for you: your films' locations first, then the kinds of spots you star, then notability and distance. */
export function rankSpots(spots: Spot[], pref: Map<string, number>): Spot[] {
  const score = (s: Spot) => (s.film ? 100 : 0) + Math.log1p(s.sl) * 3 + (pref.get(s.group) ?? 0) * 2 - s.dist / 10;
  return [...spots].sort((a, b) => score(b) - score(a));
}

/**
 * Split a trip's spots into days: k-means on coordinates (spots close together share a day), then each day is
 * ordered as a walk (nearest neighbour from the spot nearest the day's centre).
 */
export function planDays<T extends { lat: number; lon: number }>(spots: T[], days: number): T[][] {
  const pts = spots.filter((s) => s.lat || s.lon);
  const k = Math.max(1, Math.min(days, pts.length));
  if (!pts.length) return Array.from({ length: days }, () => []);
  const kx = Math.cos((pts.reduce((a, p) => a + p.lat, 0) / pts.length) * (Math.PI / 180));
  const d2 = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => ((a.lon - b.lon) * kx) ** 2 + (a.lat - b.lat) ** 2;
  // farthest-point initialisation (deterministic), then Lloyd iterations
  const centres = [pts[0]];
  while (centres.length < k) centres.push(pts.reduce((best, p) => (Math.min(...centres.map((c) => d2(p, c))) > Math.min(...centres.map((c) => d2(best, c))) ? p : best), pts[0]));
  let cs = centres.map((c) => ({ lat: c.lat, lon: c.lon }));
  let assign: number[] = [];
  for (let it = 0; it < 25; it++) {
    assign = pts.map((p) => cs.reduce((bi, c, i) => (d2(p, c) < d2(p, cs[bi]) ? i : bi), 0));
    cs = cs.map((c, i) => {
      const mine = pts.filter((_, j) => assign[j] === i);
      return mine.length ? { lat: mine.reduce((a, p) => a + p.lat, 0) / mine.length, lon: mine.reduce((a, p) => a + p.lon, 0) / mine.length } : c;
    });
  }
  const groups: T[][] = cs.map((c, i) => {
    const mine = pts.filter((_, j) => assign[j] === i);
    if (!mine.length) return [];
    const route = [mine.reduce((best, p) => (d2(p, c) < d2(best, c) ? p : best))];
    const left = mine.filter((p) => p !== route[0]);
    while (left.length) {
      const last = route[route.length - 1];
      const i = left.reduce((bi, p, j) => (d2(p, last) < d2(left[bi], last) ? j : bi), 0);
      route.push(left.splice(i, 1)[0]);
    }
    return route;
  });
  while (groups.length < days) groups.push([]);
  return groups.sort((a, b) => b.length - a.length);
}
