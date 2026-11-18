"use client";

import { useEffect, useMemo, useState } from "react";
import { loadFilms } from "@/lib/data";
import { addCustom, getState, recordFeedback, removeCustom, useStore } from "@/lib/store";
import type { Entity } from "@/lib/types";

/**
 * The best spots of a place, live from Wikidata (CORS-enabled SPARQL): notable things within a radius,
 * grouped by kind, with photos. Ranked for you: filming locations of films you loved come first, then the
 * kinds of spots you star (museums, nature, food...) everywhere you look.
 */
interface Spot { q: string; name: string; desc?: string; img?: string; type?: string; sl: number; dist: number; lat: number; lon: number; film?: string }

const GROUPS: [string, RegExp][] = [
  ["Museums & art", /\b(museum|art museum|gallery|art gallery|exhibition|musée)\b/i],
  ["Sacred places", /\b(church|cathedral|basilica|temple|mosque|abbey|monastery|shrine|synagogue|chapel|sanctuaire|temple bouddhiste)\b/i],
  ["Nature & views", /\b(park|garden|beach|mountain|peak|lake|waterfall|forest|island|cave|river|bay|cliff|valley|nature reserve|volcano|glacier|viewpoint|montagne|parc|jardin|plage)\b/i],
  ["Landmarks & history", /\b(castle|palace|fort|fortress|monument|tower|bridge|square|archaeological site|ruins|memorial|statue|gate|lighthouse|historic site|world heritage site|building|palais|château|pont|place)\b/i],
  ["Food, markets & nights", /\b(restaurant|café|cafe|bar|market|brewery|winery|food|shopping street|street|neighbourhood|neighborhood|quarter|quartier|district|marché)\b/i],
  ["Culture & shows", /\b(theatre|theater|opera house|concert hall|stadium|arena|cinema|library|zoo|aquarium|amusement park|théâtre|opéra)\b/i],
];
/** Infrastructure isn't a spot to visit. */
const NOT_A_SPOT = /\b(university|college|school|metro|subway|railway|railway station|train station|station|line|airport|hospital|company|business|road|highway|tram|bus|rapid transit|transit|event|attack|arson|murder|massacre|disaster|incident|fire|earthquake|battle|war|siege|election|treaty)\b/i;
const ABSTRACT = /\b(country|empire|state|city|comune|capital|region|province|civilization|period|metropolitan|municipality|diocese|archdiocese|commune|county|prefecture|ward|district of|historical country|polity|sovereign)\b/i;
const groupOf = (s: Spot) =>
  GROUPS.find(([, re]) => re.test(s.type ?? ""))?.[0] ?? GROUPS.find(([, re]) => re.test(s.desc ?? ""))?.[0] ?? "Other places";

function sparql(q: string): Promise<Record<string, { value: string }>[]> {
  return fetch(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(q)}`, {
    headers: { Accept: "application/sparql-results+json" }, signal: AbortSignal.timeout(45_000),
  })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Wikidata ${r.status}`))))
    .then((j) => j.results.bindings);
}

function coordOf(e: Entity): [number, number] | null {
  const m = String(e.item?.meta?.coord ?? "").match(/Point\(([-\d.]+) ([-\d.]+)\)/);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

export default function PlaceSpots({ e }: { e: Entity }) {
  const [spots, setSpots] = useState<Spot[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [group, setGroup] = useState<string | null>(null);
  const starred = useStore((s) => s.custom.filter((c) => c.domain === "places" && c.tags.includes("spot")));
  const coord = coordOf(e);
  const radius = e.tags.includes("city") ? 12 : 25;

  useEffect(() => {
    if (!coord) return;
    let live = true;
    const [lon, lat] = coord;
    const around = `SERVICE wikibase:around { ?a wdt:P625 ?loc . bd:serviceParam wikibase:center "Point(${lon} ${lat})"^^geo:wktLiteral ; wikibase:radius "${radius}" ; wikibase:distance ?dist . }`;
    // 1) notable things nearby (fast), 2) photo + kind for just those
    const spotsQ = `SELECT ?a ?aLabel ?aDescription ?sl ?dist ?loc WHERE {
      ${around}
      ?a wikibase:sitelinks ?sl . FILTER(?sl >= 6)
      SERVICE wikibase:label { bd:serviceParam wikibase:language "fr,en". }
    } ORDER BY DESC(?sl) LIMIT 90`;
    const detailQ = (ids: string[]) => `SELECT ?a (SAMPLE(?i) AS ?img) (GROUP_CONCAT(DISTINCT ?tl; separator="|") AS ?types) WHERE {
      VALUES ?a { ${ids.map((q) => `wd:${q}`).join(" ")} }
      OPTIONAL { ?a wdt:P18 ?i }
      OPTIONAL { ?a wdt:P31 ?t . ?t rdfs:label ?tl . FILTER(LANG(?tl) = "en") }
    } GROUP BY ?a`;
    // filming locations of the films you loved, inside the same radius
    const filmsQ = (ids: string[]) => `SELECT ?a ?aLabel ?filmLabel WHERE {
      VALUES ?film { ${ids.map((q) => `wd:${q}`).join(" ")} }
      ?film wdt:P915 ?a . ${around}
      SERVICE wikibase:label { bd:serviceParam wikibase:language "fr,en". }
    } LIMIT 30`;
    (async () => {
      try {
        const rows = await sparql(spotsQ);
        const self = e.key.split(":")[1];
        let list: Spot[] = rows.map((r) => {
          const p = r.loc?.value.match(/Point\(([-\d.]+) ([-\d.]+)\)/);
          return {
            q: r.a.value.split("/").pop()!, name: r.aLabel?.value ?? "", desc: r.aDescription?.value,
            sl: Number(r.sl?.value ?? 0), dist: Number(r.dist?.value ?? 0), lon: p ? +p[1] : lon, lat: p ? +p[2] : lat,
          };
        }).filter((s, i, all) => s.name && s.q !== self && !/^Q\d+$/.test(s.name) && all.findIndex((x) => x.q === s.q) === i);
        const det = await sparql(detailQ(list.map((x) => x.q))).catch(() => []);
        const info = new Map(det.map((r) => [r.a.value.split("/").pop()!, r]));
        list = list.map((x) => {
          const r = info.get(x.q);
          return { ...x, img: r?.img?.value ? `${r.img.value.replace("http://", "https://")}?width=480` : undefined, type: r?.types?.value.split("|").slice(0, 3).join(", ") };
        }).filter((x) => !ABSTRACT.test(x.type ?? "") && !NOT_A_SPOT.test(x.type ?? "")); // the city itself, empires, stations... aren't spots
        // your films
        const s = getState();
        const loved = Object.values(s.feedback).filter((f) => f.domain === "films" && ["fav", "loved", "liked"].includes(f.action)).map((f) => f.key);
        if (loved.length) {
          const films = await loadFilms();
          const qids = loved.map((k) => films.films[films.index.get(k) ?? -1]?.links?.wikidata?.split("/").pop()).filter((q): q is string => !!q).slice(0, 200);
          if (qids.length) {
            const hits = await sparql(filmsQ(qids)).catch(() => []);
            for (const h of hits) {
              const q = h.a.value.split("/").pop()!;
              const spot = list.find((x) => x.q === q);
              if (spot) spot.film = h.filmLabel?.value;
              else list.unshift({ q, name: h.aLabel?.value ?? q, film: h.filmLabel?.value, sl: 0, dist: 0, lat: 0, lon: 0, type: "filming location" });
            }
          }
        }
        if (live) setSpots(list);
      } catch (x) {
        if (live) setErr((x as Error).message);
      }
    })();
    return () => {
      live = false;
    };
  }, [e.key]); // eslint-disable-line react-hooks/exhaustive-deps

  // kinds of spots you star anywhere count everywhere
  const pref = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of starred) {
      const g = c.tags.find((t) => GROUPS.some(([n]) => n === t));
      if (g) m.set(g, (m.get(g) ?? 0) + 1);
    }
    return m;
  }, [starred]);

  const ranked = useMemo(() => {
    if (!spots) return [];
    return [...spots]
      .map((s) => ({ s, g: groupOf(s), score: (s.film ? 100 : 0) + Math.log1p(s.sl) * 3 + (pref.get(groupOf(s)) ?? 0) * 2 - s.dist / 10 }))
      .sort((a, b) => b.score - a.score);
  }, [spots, pref]);

  if (!coord) return null;
  if (err) return <p className="text-sm text-muted">Couldn&apos;t load the best spots ({err}).</p>;
  if (!spots) return <div className="card h-48 animate-pulse" />;
  const groups = [...new Set(ranked.map((x) => x.g))];
  const shown = ranked.filter((x) => !group || x.g === group).slice(0, 30);
  const isStarred = (q: string) => starred.find((c) => c.url?.endsWith(`/${q}`));

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-2xl">Best spots around {e.title}</h2>
        <p className="text-xs text-muted">within {radius} km · ★ the ones you&apos;d go to: they shape what comes first everywhere</p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <button className="chip" data-on={!group} onClick={() => setGroup(null)}>All</button>
        {groups.map((g) => <button key={g} className="chip" data-on={group === g} onClick={() => setGroup(group === g ? null : g)}>{g}{pref.get(g) ? " ★" : ""}</button>)}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {shown.map(({ s, g }) => {
          const star = isStarred(s.q);
          return (
            <article key={s.q} className={`card flex flex-col overflow-hidden ${s.film ? "border-accent" : ""}`}>
              <a href={`https://www.wikidata.org/wiki/${s.q}`} target="_blank" rel="noreferrer" className="relative block aspect-[4/3] bg-panel-2">
                {/* eslint-disable-next-line @next/next/no-img-element -- Wikimedia Commons */}
                {s.img && <img src={s.img} alt={s.name} loading="lazy" className="h-full w-full object-cover" />}
                {s.film && <span className="absolute left-2 top-2 rounded-full bg-black/75 px-2 py-0.5 text-[10px] text-accent">🎬 {s.film}</span>}
              </a>
              <div className="flex flex-1 flex-col gap-1 p-2.5">
                <p className="line-clamp-2 text-sm font-medium leading-snug">{s.name}</p>
                <p className="line-clamp-2 text-[11px] text-muted">{[g, s.dist ? `${s.dist.toFixed(1)} km` : "", s.desc].filter(Boolean).join(" · ")}</p>
                <div className="mt-auto flex gap-1.5 pt-1">
                  <button className="btn-ghost flex-1 px-2 py-1 text-xs" onClick={() => {
                    if (star) return removeCustom(star.id);
                    const [id] = addCustom([{ domain: "places", title: s.name, subtitle: `${e.title} · ${g}`, url: `https://www.wikidata.org/wiki/${s.q}`, image: s.img, tags: ["spot", g, e.title.toLowerCase()], source: "spots" }]);
                    recordFeedback({ key: id, domain: "places", action: "want", source: "spots" });
                  }}>{star ? "★ Saved" : "☆ Go"}</button>
                  {s.lat !== 0 && <a className="btn-ghost px-2 py-1 text-xs" target="_blank" rel="noreferrer" href={`https://www.google.com/maps/search/?api=1&query=${s.lat},${s.lon}`}>Map</a>}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
