"use client";

import { useT } from "@/lib/i18n";

import Link from "next/link";
import { motion } from "motion/react";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { addCustom, recordFeedback, removeCustom, toggleTripSpot, useStore } from "@/lib/store";
import { coordOf, fetchSpots, GROUP_COLOR, radiusOf, rankSpots, type Spot } from "@/lib/spots";
import type { Entity } from "@/lib/types";

const GROUP_ICON: Record<string, string> = {
  "Museums & art": "🏛️", "Sacred places": "🕌", "Nature & views": "🌿", "Landmarks & history": "🏰",
  "Food, markets & nights": "🍽️", "Culture & shows": "🎭", "Filming locations": "🎬", "Other places": "📍",
};

const SpotMap = dynamic(() => import("@/components/SpotMap"), { ssr: false, loading: () => <div className="h-80 animate-pulse rounded-2xl bg-panel" /> });

/**
 * The best spots of a place on a map and in a list, ranked for you (films you loved first, then the kinds of
 * spots you star everywhere). ☆ teaches your taste; "+ Trip" adds it to this place's trip plan.
 */
export default function PlaceSpots({ e }: { e: Entity }) {
  const T = useT();
  const [spots, setSpots] = useState<Spot[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
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
  }, [e, attempt]);

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
  if (err) return (
    <div className="card flex flex-wrap items-center justify-between gap-2 p-4 text-sm text-muted">
      <span>{T("Couldn't load the best spots (")}{err}).</span>
      <button className="btn-ghost px-3 py-1.5 text-xs" onClick={() => { setErr(null); setAttempt((n) => n + 1); }}>{T("Try again")}</button>
    </div>
  );
  if (!spots) return (
    <section className="space-y-3" aria-busy>
      <h2 className="font-display text-2xl">{T("Best spots around")}{" "}{e.title}</h2>
      <p className="text-xs text-muted">{T("Asking Wikidata for the places worth a visit… this can take up to a minute.")}</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => <div key={i} className="card aspect-[4/5] animate-pulse" style={{ animationDelay: `${i * 80}ms` }} />)}
      </div>
    </section>
  );
  const groups = [...new Set(ranked.map((x) => x.group))];
  const isStarred = (q: string) => starred.find((c) => c.url?.endsWith(`/${q}`));
  const place = { key: e.key, title: e.title, image: e.image };

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="font-display text-2xl">{T("Best spots around")}{" "}{e.title}</h2>
          <p className="text-xs text-muted">{T("within")}{" "}{radiusOf(e)} {T("km · ☆ teaches your taste · + Trip builds your plan")}</p>
        </div>
        {trip?.spots.length ? <Link href={`/trips/?id=${trip.id}`} className="btn px-3 py-1.5 text-sm">{T("Plan the trip ·")}{" "}{trip.spots.length} {T("spots →")}</Link> : null}
      </div>
      <div className="flex flex-wrap gap-1.5">
        <button className="chip" data-on={!group} onClick={() => setGroup(null)}>{T("All")}</button>
        {groups.map((g) => (
          <button key={g} className="chip" data-on={group === g} onClick={() => setGroup(group === g ? null : g)}>
            <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: GROUP_COLOR[g] }} />{T(g)}{pref.get(g) ? " ★" : ""}
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
                            className={`card group flex flex-col overflow-hidden ${s.film ? "border-accent" : ""} ${focus === s.q ? "ring-2 ring-accent" : ""}`}>
              <a href={`https://www.wikidata.org/wiki/${s.q}`} target="_blank" rel="noreferrer" className="relative block aspect-[4/3] shrink-0 overflow-hidden bg-panel-2">
                {/* under the photo: a tinted card with the kind of place, shown when Commons has no photo (or it fails) */}
                <span aria-hidden className="absolute inset-0 grid place-items-center"
                      style={{ background: `radial-gradient(circle at 30% 20%, ${GROUP_COLOR[s.group] ?? "#a1a1aa"}55, transparent 60%), linear-gradient(160deg, var(--panel-2), var(--panel))` }}>
                  <span className="text-4xl opacity-70">{GROUP_ICON[s.group] ?? "📍"}</span>
                </span>
                {/* eslint-disable-next-line @next/next/no-img-element -- Wikimedia Commons */}
                {s.img && <img src={s.img} alt={s.name} loading="lazy" className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-105"
                               onError={(ev) => { (ev.currentTarget as HTMLImageElement).style.display = "none"; }} />}
                <span className="absolute left-2 top-2 h-2.5 w-2.5 rounded-full ring-2 ring-black/60" style={{ background: GROUP_COLOR[s.group] }} />
                {s.film && <span className="absolute bottom-2 left-2 rounded-full bg-black/75 px-2 py-0.5 text-[10px] text-accent">🎬 {s.film}</span>}
              </a>
              <div className="flex flex-1 flex-col gap-1 p-2.5">
                <p className="line-clamp-2 text-sm font-medium leading-snug">{s.name}</p>
                <p className="line-clamp-2 text-[11px] text-muted">{[T(s.group), s.dist ? `${s.dist.toFixed(1)} km` : "", s.desc].filter(Boolean).join(" · ")}</p>
                <div className="mt-auto flex gap-1.5 pt-1">
                  <button className="btn-ghost shrink-0 px-2 py-1 text-xs" title={T("I'd go: teaches your taste")} aria-label={T("I'd go: teaches your taste")} onClick={() => {
                    if (star) return removeCustom(star.id);
                    const [id] = addCustom([{ domain: "places", title: s.name, subtitle: `${e.title} · ${s.group}`, url: `https://www.wikidata.org/wiki/${s.q}`, image: s.img, tags: ["spot", s.group, e.title.toLowerCase()], source: "spots" }]);
                    recordFeedback({ key: id, domain: "places", action: "want", source: "spots" });
                  }}>{star ? "★" : "☆"}</button>
                  <button className={`min-w-0 flex-1 truncate whitespace-nowrap rounded-lg px-2 py-1 text-xs font-medium transition ${added ? "bg-accent text-bg" : "btn-ghost"}`}
                          onClick={() => toggleTripSpot(place, { q: s.q, name: s.name, lat: s.lat, lon: s.lon, img: s.img, group: s.group })}>
                    {added ? T("✓ In trip") : T("+ Trip")}
                  </button>
                  {(s.lat || s.lon) ? <a className="btn-ghost shrink-0 px-2 py-1 text-xs" target="_blank" rel="noreferrer" title={T("Map")} aria-label={T("Map")} href={`https://www.google.com/maps/search/?api=1&query=${s.lat},${s.lon}`}>📍</a> : null}
                </div>
              </div>
            </motion.article>
          );
        })}
      </div>
    </section>
  );
}
