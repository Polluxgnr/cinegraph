"use client";

import { useT } from "@/lib/i18n";

import Link from "next/link";
import dynamic from "next/dynamic";
import { motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { detailHref } from "@/components/RecCard";
import { useDomain, useQueryParam } from "@/lib/hooks";
import { downloadIcs } from "@/lib/ics";
import { fetchSpots, GROUP_COLOR, planDays, rankSpots, type Spot } from "@/lib/spots";
import { deleteTrip, toggleTripSpot, type Trip, type TripSpot, updateTrip, useStore } from "@/lib/store";

const SpotMap = dynamic(() => import("@/components/SpotMap"), { ssr: false, loading: () => <div className="h-96 animate-pulse rounded-2xl bg-panel" /> });

const DAY_COLORS = ["#f5a524", "#4ade80", "#60a5fa", "#f472b6", "#c084fc", "#22d3ee", "#fb7185", "#a3e635", "#fbbf24", "#94a3b8"];
const dayColor = (d: number | null) => (d == null ? "#71717a" : DAY_COLORS[d % DAY_COLORS.length]);

function km(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const R = 6371, r = Math.PI / 180;
  const x = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lon - a.lon) * r) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
const routeKm = (s: TripSpot[]) => s.slice(1).reduce((acc, p, i) => acc + km(s[i], p), 0);
const gmaps = (s: TripSpot[]) => `https://www.google.com/maps/dir/${s.map((p) => `${p.lat},${p.lon}`).join("/")}`;

/** Trips: one per destination, planned day by day like a travel journal. */
export default function Trips() {
  const T = useT();
  const [id] = useQueryParam("id");
  const trips = useStore((s) => s.trips);
  const trip = trips.find((t) => t.id === id);
  if (trip) return <Planner trip={trip} />;
  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-4xl md:text-5xl">{T("Trips")}</h1>
        <p className="text-sm text-muted">{T("Open a destination, add its best spots with “+ Trip”, then plan the days here: map, routes, notes.")}</p>
      </header>
      {trips.length ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {trips.map((t, i) => (
            <motion.div key={t.id} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
              <Link href={`/trips/?id=${t.id}`} className="card group block overflow-hidden">
                <div className="relative aspect-[16/9] bg-panel-2">
                  {/* eslint-disable-next-line @next/next/no-img-element -- Wikimedia Commons */}
                  {t.image && <img src={t.image} alt="" className="h-full w-full object-cover transition duration-700 group-hover:scale-105" />}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent" />
                  <div className="absolute bottom-3 left-3">
                    <p className="font-display text-3xl text-white">{t.title}</p>
                    <p className="text-xs text-white/70">{t.days} {T("days ·")}{" "}{t.spots.length} {T("spots")}{t.start ? ` · from ${new Date(t.start).toLocaleDateString("fr-FR")}` : ""}</p>
                  </div>
                </div>
              </Link>
            </motion.div>
          ))}
        </div>
      ) : (
        <Link href="/discover/?d=places" className="card block p-6 text-center hover:border-accent">
          <p className="font-display text-2xl">{T("Start with a destination")}</p>
          <p className="text-sm text-muted">{T("Pick a place, open it, and add spots to your trip.")}</p>
        </Link>
      )}
    </div>
  );
}

function Planner({ trip }: { trip: Trip }) {
  const T = useT();
  const { data: places } = useDomain("places");
  const place = places ? places.entities[places.index.get(trip.place) ?? -1] : undefined;
  const [best, setBest] = useState<Spot[]>([]);
  const [showAll, setShowAll] = useState(true);
  useEffect(() => {
    if (place) fetchSpots(place).then(setBest).catch(() => {});
  }, [place]);

  const byDay = useMemo(() => {
    const days: TripSpot[][] = Array.from({ length: trip.days }, () => []);
    const loose: TripSpot[] = [];
    for (const s of trip.spots) (s.day != null && s.day < trip.days ? days[s.day] : loose).push(s);
    return { days, loose };
  }, [trip]);
  const inTrip = new Set(trip.spots.map((s) => s.q));
  const points = useMemo(() => [
    ...(showAll ? best.filter((b) => !inTrip.has(b.q) && (b.lat || b.lon)).map((b) => ({ id: b.q, lat: b.lat, lon: b.lon, label: b.name, color: GROUP_COLOR[b.group] ?? "#a1a1aa", faded: true })) : []),
    ...byDay.days.flatMap((d, di) => d.map((s, i) => ({ id: s.q, lat: s.lat, lon: s.lon, label: `Day ${di + 1} · ${i + 1}. ${s.name}`, color: dayColor(di), badge: String(i + 1) }))),
    ...byDay.loose.map((s) => ({ id: s.q, lat: s.lat, lon: s.lon, label: `Not planned · ${s.name}`, color: dayColor(null), badge: "·" })),
  ], [best, byDay, showAll]); // eslint-disable-line react-hooks/exhaustive-deps
  const routes = useMemo(() => byDay.days.map((d, di) => ({ color: dayColor(di), points: d.map((s) => [s.lat, s.lon] as [number, number]) })), [byDay]);
  const suggestions = useMemo(() => rankSpots(best, new Map()).filter((b) => !inTrip.has(b.q)).slice(0, 8), [best, trip]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = byDay.days.reduce((a, d) => a + routeKm(d), 0);

  function autoPlan() {
    const plan = planDays(trip.spots, trip.days);
    updateTrip(trip.id, (t) => {
      const order: TripSpot[] = [];
      plan.forEach((day, di) => day.forEach((s) => order.push({ ...s, day: di })));
      t.spots = [...order, ...t.spots.filter((s) => !order.some((o) => o.q === s.q)).map((s) => ({ ...s, day: null }))];
    });
  }
  const dateOf = (d: number) => (trip.start ? new Date(Date.parse(trip.start) + d * 864e5).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" }) : "");
  const place4 = { key: trip.place, title: trip.title, image: trip.image };

  return (
    <div className="space-y-6">
      <header className="relative overflow-hidden rounded-3xl border border-line">
        {/* eslint-disable-next-line @next/next/no-img-element -- Wikimedia Commons */}
        {trip.image && <img src={trip.image} alt="" className="absolute inset-0 h-full w-full object-cover opacity-40" />}
        <div className="relative space-y-3 bg-gradient-to-t from-bg via-bg/60 to-transparent p-5 pt-16 md:p-8 md:pt-24">
          <Link href="/trips/" className="text-xs text-muted hover:text-ink">{T("← All trips")}</Link>
          <h1 className="font-display text-5xl md:text-6xl">{trip.title}</h1>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="flex items-center gap-1 rounded-xl border border-line bg-panel/80 px-2 py-1">
              <button className="px-2" onClick={() => updateTrip(trip.id, (t) => void (t.days = Math.max(1, t.days - 1)))}>−</button>
              <span className="tabular-nums">{trip.days} {T("days")}</span>
              <button className="px-2" onClick={() => updateTrip(trip.id, (t) => void (t.days = Math.min(21, t.days + 1)))}>+</button>
            </span>
            <label className="flex items-center gap-2 rounded-xl border border-line bg-panel/80 px-3 py-1">
              <span className="text-muted">{T("Start")}</span>
              <input type="date" value={trip.start ?? ""} onChange={(e) => updateTrip(trip.id, (t) => void (t.start = e.target.value || undefined))} className="bg-transparent outline-none" />
            </label>
            <span className="text-muted">{trip.spots.length} {T("spots · ≈")}{" "}{total.toFixed(1)} {T("km on foot")}</span>
            <button className="btn px-3 py-1.5 text-sm" onClick={autoPlan} disabled={!trip.spots.length}>{T("✨ Plan my days")}</button>
            <Link href={detailHref(trip.place)} className="btn-ghost px-3 py-1.5 text-sm">{T("+ Add spots")}</Link>
            <button className="btn-ghost px-3 py-1.5 text-sm" onClick={() => downloadIcs(trip)} disabled={!trip.spots.some((s) => s.day != null)} title={T("One event per day, with stops and route")}>{T("📅 Add to calendar")}</button>
          </div>
        </div>
      </header>

      <div className="space-y-2">
        <label className="flex items-center gap-2 text-xs text-muted"><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> {T("show every best spot on the map (faded)")}</label>
        <SpotMap points={points} routes={routes} className="h-80 md:h-[28rem]" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {byDay.days.map((d, di) => (
          <motion.section key={di} layout className="card space-y-2 p-4" style={{ borderColor: `${dayColor(di)}55` }}>
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="font-display text-2xl" style={{ color: dayColor(di) }}>{T("Day")}{" "}{di + 1} <span className="text-sm text-muted">{dateOf(di)}</span></h2>
              <span className="text-xs text-muted">{d.length ? `${d.length} stops · ${routeKm(d).toFixed(1)} km` : T("free day")}</span>
            </div>
            <ol className="space-y-1.5">
              {d.map((s, i) => <Stop key={s.q} s={s} n={i + 1} trip={trip} color={dayColor(di)} />)}
            </ol>
            {d.length > 1 && <a href={gmaps(d)} target="_blank" rel="noreferrer" className="inline-block text-xs text-accent">{T("Directions for the day in Google Maps ↗")}</a>}
            <textarea defaultValue={trip.notes[di] ?? ""} placeholder={T("Notes, restaurant, booking, how it went…")} rows={2}
                      onBlur={(e) => updateTrip(trip.id, (t) => void (t.notes = { ...t.notes, [di]: e.target.value }))}
                      className="w-full resize-y rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none focus:border-accent" />
          </motion.section>
        ))}
      </div>

      {byDay.loose.length > 0 && (
        <section className="card space-y-2 p-4">
          <h2 className="font-display text-xl">{T("Not planned yet")}</h2>
          <ol className="space-y-1.5">{byDay.loose.map((s) => <Stop key={s.q} s={s} trip={trip} color={dayColor(null)} />)}</ol>
          <p className="text-xs text-muted">{T("“Plan my days” groups spots that are close to each other and orders each day as a walk.")}</p>
        </section>
      )}

      {suggestions.length > 0 && (
        <section>
          <h2 className="mb-3 font-display text-2xl">{T("Worth adding")}</h2>
          <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 pb-2">
            {suggestions.map((b) => (
              <div key={b.q} className="card w-44 shrink-0 overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element -- Wikimedia Commons */}
                <div className="aspect-[4/3] bg-panel-2">{b.img && <img src={b.img} alt="" className="h-full w-full object-cover" loading="lazy" />}</div>
                <div className="space-y-1 p-2">
                  <p className="line-clamp-2 text-sm leading-snug">{b.name}</p>
                  <p className="text-[11px] text-muted">{b.group}</p>
                  <button className="btn-ghost w-full px-2 py-1 text-xs" onClick={() => toggleTripSpot(place4, { q: b.q, name: b.name, lat: b.lat, lon: b.lon, img: b.img, group: b.group })}>{T("+ Trip")}</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <button className="text-xs text-nope" onClick={() => confirm(`Delete the ${trip.title} trip?`) && deleteTrip(trip.id)}>{T("Delete this trip")}</button>
    </div>
  );
}

function Stop({ s, n, trip, color }: { s: TripSpot; n?: number; trip: Trip; color: string }) {
  const T = useT();
  return (
    <li className={`flex items-center gap-2 rounded-xl p-1.5 hover:bg-panel-2 ${s.done ? "opacity-60" : ""}`}>
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold text-bg" style={{ background: color }}>{n ?? "·"}</span>
      {/* eslint-disable-next-line @next/next/no-img-element -- Wikimedia Commons */}
      {s.img ? <img src={s.img} alt="" className="h-10 w-12 shrink-0 rounded-md object-cover" loading="lazy" /> : <span className="h-10 w-12 shrink-0 rounded-md bg-panel-2" />}
      <div className="min-w-0 flex-1">
        <p className={`truncate text-sm ${s.done ? "line-through" : ""}`}>{s.name}</p>
        <p className="truncate text-[11px] text-muted">{s.group}</p>
      </div>
      <select value={s.day ?? ""} onChange={(e) => updateTrip(trip.id, (t) => {
        const x = t.spots.find((y) => y.q === s.q);
        if (x) x.day = e.target.value === "" ? null : Number(e.target.value);
      })} className="rounded-md border border-line bg-panel px-1 py-0.5 text-xs" aria-label={T("Day")}>
        <option value="">–</option>
        {Array.from({ length: trip.days }, (_, i) => <option key={i} value={i}>{T("Day")}{" "}{i + 1}</option>)}
      </select>
      <button title={T("Been there")} className="px-1 text-sm" onClick={() => updateTrip(trip.id, (t) => {
        const x = t.spots.find((y) => y.q === s.q);
        if (x) x.done = !x.done;
      })}>{s.done ? "✅" : "◻"}</button>
      <button title={T("Remove")} className="px-1 text-xs text-muted hover:text-nope" onClick={() => updateTrip(trip.id, (t) => void (t.spots = t.spots.filter((y) => y.q !== s.q)))}>✕</button>
    </li>
  );
}
