"use client";

import Link from "next/link";
import { motion } from "motion/react";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { addCustom, recordFeedback, removeCustom, toggleTripSpot, useStore } from "@/lib/store";
import { coordOf, fetchSpots, GROUP_COLOR, radiusOf, rankSpots, type Spot } from "@/lib/spots";
import type { Entity } from "@/lib/types";

const SpotMap = dynamic(() => import("@/components/SpotMap"), { ssr: false, loading: () => <div className="h-80 animate-pulse rounded-2xl bg-panel" /> });

/**
 * The best spots of a place on a map and in a list, ranked for you (films you loved first, then the kinds of
 * spots you star everywhere). ☆ teaches your taste; "+ Trip" adds it to this place's trip plan.
 */
export default function PlaceSpots({ e }: { e: Entity }) {
  const [spots, setSpots] = useState<Spot[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [group, setGroup] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const starred = useStore((s) => s.custom.filter((c) => c.domain === "places" && c.tags.includes("spot")));
  const trip = useStore((s) => s.trips.find((t) => t.place === e.key));
  const coord = coordOf(e);

  useEffect(() => {
    let live = true;
    fetchSpots(e).then((x) => live && setSpots(x)).catch((x) => live && setErr((x as Error).message));
    return () => {
      live = false;
    };
  }, [e]);

  const pref = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of starred) {
      const g = c.tags.find((t) => GROUP_COLOR[t]);
      if (g) m.set(g, (m.get(g) ?? 0) + 1);
    }
    return m;
  }, [starred]);
  const ranked = useMemo(() => (spots ? rankSpots(spots, pref) : []), [spots, pref]);
  const shown = useMemo(() => ranked.filter((s) => !group || s.group === group).slice(0, 40), [ranked, group]);
  const inTrip = new Set(trip?.spots.map((s) => s.q));
  const points = useMemo(() => shown.filter((s) => s.lat || s.lon).map((s) => ({ id: s.q, lat: s.lat, lon: s.lon, label: s.name, color: GROUP_COLOR[s.group] ?? "#a1a1aa", badge: inTrip.has(s.q) ? "✓" : undefined })),
    [shown, trip]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (focus) document.getElementById(`spot-${focus}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focus]);

  if (!coord) return null;
  if (err) return <p className="text-sm text-muted">Couldn&apos;t load the best spots ({err}).</p>;
  if (!spots) return <div className="card h-48 animate-pulse" />;
  const groups = [...new Set(ranked.map((x) => x.group))];
  const isStarred = (q: string) => starred.find((c) => c.url?.endsWith(`/${q}`));
  const place = { key: e.key, title: e.title, image: e.image };

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="font-display text-2xl">Best spots around {e.title}</h2>
          <p className="text-xs text-muted">within {radiusOf(e)} km · ☆ teaches your taste · + Trip builds your plan</p>
        </div>
        {trip?.spots.length ? <Link href={`/trips/?id=${trip.id}`} className="btn px-3 py-1.5 text-sm">Plan the trip · {trip.spots.length} spots →</Link> : null}
      </div>
      <div className="flex flex-wrap gap-1.5">
        <button className="chip" data-on={!group} onClick={() => setGroup(null)}>All</button>
        {groups.map((g) => (
          <button key={g} className="chip" data-on={group === g} onClick={() => setGroup(group === g ? null : g)}>
            <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: GROUP_COLOR[g] }} />{g}{pref.get(g) ? " ★" : ""}
          </button>
        ))}
      </div>
      <SpotMap points={points} className="h-72 md:h-96" onSelect={setFocus} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {shown.map((s, i) => {
          const star = isStarred(s.q);
          const added = inTrip.has(s.q);
          return (
            <motion.article id={`spot-${s.q}`} key={s.q} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 12) * 0.03 }}
                            className={`card flex flex-col overflow-hidden ${s.film ? "border-accent" : ""} ${focus === s.q ? "ring-2 ring-accent" : ""}`}>
              <a href={`https://www.wikidata.org/wiki/${s.q}`} target="_blank" rel="noreferrer" className="relative block aspect-[4/3] bg-panel-2">
                {/* eslint-disable-next-line @next/next/no-img-element -- Wikimedia Commons */}
                {s.img && <img src={s.img} alt={s.name} loading="lazy" className="h-full w-full object-cover" />}
                <span className="absolute left-2 top-2 h-2.5 w-2.5 rounded-full ring-2 ring-black/60" style={{ background: GROUP_COLOR[s.group] }} />
                {s.film && <span className="absolute bottom-2 left-2 rounded-full bg-black/75 px-2 py-0.5 text-[10px] text-accent">🎬 {s.film}</span>}
              </a>
              <div className="flex flex-1 flex-col gap-1 p-2.5">
                <p className="line-clamp-2 text-sm font-medium leading-snug">{s.name}</p>
                <p className="line-clamp-2 text-[11px] text-muted">{[s.group, s.dist ? `${s.dist.toFixed(1)} km` : "", s.desc].filter(Boolean).join(" · ")}</p>
                <div className="mt-auto flex gap-1.5 pt-1">
                  <button className="btn-ghost px-2 py-1 text-xs" title="I'd go: teaches your taste" onClick={() => {
                    if (star) return removeCustom(star.id);
                    const [id] = addCustom([{ domain: "places", title: s.name, subtitle: `${e.title} · ${s.group}`, url: `https://www.wikidata.org/wiki/${s.q}`, image: s.img, tags: ["spot", s.group, e.title.toLowerCase()], source: "spots" }]);
                    recordFeedback({ key: id, domain: "places", action: "want", source: "spots" });
                  }}>{star ? "★" : "☆"}</button>
                  <button className={`flex-1 rounded-lg px-2 py-1 text-xs font-medium transition ${added ? "bg-accent text-bg" : "btn-ghost"}`}
                          onClick={() => toggleTripSpot(place, { q: s.q, name: s.name, lat: s.lat, lon: s.lon, img: s.img, group: s.group })}>
                    {added ? "✓ In trip" : "+ Trip"}
                  </button>
                  {(s.lat || s.lon) ? <a className="btn-ghost px-2 py-1 text-xs" target="_blank" rel="noreferrer" href={`https://www.google.com/maps/search/?api=1&query=${s.lat},${s.lon}`}>Map</a> : null}
                </div>
              </div>
            </motion.article>
          );
        })}
      </div>
    </section>
  );
}
