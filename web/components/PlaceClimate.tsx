"use client";

import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { type Climate, climate, type Now, sky, weatherNow } from "@/lib/climate";
import { useT } from "@/lib/i18n";
import { coordOf } from "@/lib/spots";
import type { Entity } from "@/lib/types";

const MONTHS = { en: ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"], fr: ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"] };
const MONTH_NAMES = (lang: string) => Array.from({ length: 12 }, (_, m) => new Date(2024, m, 1).toLocaleDateString(lang === "fr" ? "fr-FR" : "en-GB", { month: "long" }));

/**
 * When to go and what it's like now: local time, today's weather and the week ahead, then a typical year
 * (day and night temperatures, rain, sunshine) with the most pleasant months lit.
 */
export default function PlaceClimate({ e }: { e: Entity }) {
  const T = useT();
  const lang = T.lang;
  const c = coordOf(e);
  const [cl, setCl] = useState<Climate | null | undefined>(undefined);
  const [now, setNow] = useState<Now | null>(null);
  const [clock, setClock] = useState<string>("");
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    if (!c) return;
    let live = true;
    climate(c.lat, c.lon).then((x) => live && setCl(x)).catch(() => live && setCl(null));
    weatherNow(c.lat, c.lon).then((x) => live && setNow(x)).catch(() => {});
    return () => { live = false; };
  }, [c?.lat, c?.lon]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!cl?.tz) return;
    const tick = () => setClock(new Date().toLocaleTimeString(lang === "fr" ? "fr-FR" : "en-GB", { timeZone: cl.tz, hour: "2-digit", minute: "2-digit", weekday: "short" }));
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [cl?.tz, lang]);

  if (!c || cl === null) return null;
  if (cl === undefined) return <div className="card h-56 animate-pulse" aria-busy aria-label={T("Loading the climate…")} />;

  const names = MONTH_NAMES(lang);
  const hiMax = Math.max(...cl.months.map((m) => m.hi), 30);
  const loMin = Math.min(...cl.months.map((m) => m.lo), 0);
  const rainMax = Math.max(...cl.months.map((m) => m.rain), 60);
  const y = (t: number) => ((t - loMin) / (hiMax - loMin)) * 100;
  const sel = hover ?? new Date().getMonth();
  const m = cl.months[sel];
  const bestText = cl.best.length ? cl.best.map((i) => names[i]).join(", ") : T("no clear best season");

  return (
    <section className="card space-y-5 p-5" data-testid="climate">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl">{T("When to go")}</h2>
          <p className="text-sm text-muted">{T("Most pleasant")}: <b className="text-ink">{bestText}</b></p>
        </div>
        {now && (
          <div className="flex items-center gap-3 rounded-2xl bg-panel-2 px-4 py-2">
            <span className="text-3xl" aria-hidden>{sky(now.code)[0]}</span>
            <div>
              <p className="font-display text-2xl tabular-nums leading-none">{Math.round(now.temp)}°</p>
              <p className="text-xs text-muted">{T(sky(now.code)[1])} · {clock} {T("local time")}</p>
            </div>
          </div>
        )}
      </div>

      {now && (
        <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1">
          {now.days.map((d) => (
            <div key={d.date} className="min-w-[72px] flex-1 rounded-xl border border-line px-2 py-2 text-center">
              <p className="text-[11px] uppercase text-muted">{new Date(`${d.date}T12:00`).toLocaleDateString(lang === "fr" ? "fr-FR" : "en-GB", { weekday: "short" })}</p>
              <p className="text-xl" aria-label={T(sky(d.code)[1])}>{sky(d.code)[0]}</p>
              <p className="text-xs tabular-nums"><b>{Math.round(d.hi)}°</b> <span className="text-muted">{Math.round(d.lo)}°</span></p>
              {d.rain >= 30 && <p className="text-[10px] text-sky-400">💧{d.rain}%</p>}
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-[1fr_220px]">
        <div className="grid h-48 grid-cols-12 items-end gap-1" onMouseLeave={() => setHover(null)} role="img"
             aria-label={T("Typical year: temperatures and rain by month")}>
          {cl.months.map((mo) => {
            const best = cl.best.includes(mo.m);
            return (
              <button key={mo.m} className="group relative flex h-full flex-col items-center justify-end" onMouseEnter={() => setHover(mo.m)} onFocus={() => setHover(mo.m)} onClick={() => setHover(mo.m)}
                      aria-label={`${names[mo.m]}: ${Math.round(mo.hi)}° / ${Math.round(mo.lo)}°, ${mo.rain} mm`}>
                {/* rain at the bottom */}
                <motion.div className="absolute bottom-5 w-full rounded-t bg-sky-500/20" initial={{ height: 0 }} animate={{ height: `${(mo.rain / rainMax) * 35}%` }} transition={{ delay: mo.m * 0.03 }} />
                {/* temperature range */}
                <div className="absolute inset-x-0 bottom-5 top-0">
                  <motion.div className={`absolute left-1/2 w-2.5 -translate-x-1/2 rounded-full ${best ? "bg-accent" : "bg-ink/30 group-hover:bg-ink/60"}`}
                              initial={{ opacity: 0, scaleY: 0.3 }} animate={{ opacity: 1, scaleY: 1 }} transition={{ delay: mo.m * 0.03 }}
                              style={{ bottom: `${y(mo.lo)}%`, height: `${Math.max(3, y(mo.hi) - y(mo.lo))}%` }} />
                </div>
                <span className={`relative text-[11px] ${sel === mo.m ? "font-semibold text-ink" : best ? "text-accent" : "text-muted"}`}>{MONTHS[lang === "fr" ? "fr" : "en"][mo.m]}</span>
              </button>
            );
          })}
        </div>
        <div className="space-y-1.5 rounded-xl bg-panel-2 p-3 text-sm">
          <p className="font-display text-lg capitalize">{names[sel]}{cl.best.includes(sel) && <span className="ml-1 text-xs text-accent">★ {T("best time")}</span>}</p>
          <p>🌡️ {Math.round(m.hi)}° / {Math.round(m.lo)}°</p>
          <p>💧 {m.rain} mm · {T("{n} rainy days", { n: m.wetDays })}</p>
          <p>☀️ {T("{n} h of sun a day", { n: m.sun })}</p>
          <div className="pt-1">
            <div className="h-1.5 overflow-hidden rounded-full bg-bg"><div className="h-full rounded-full bg-accent" style={{ width: `${m.score * 100}%` }} /></div>
            <p className="mt-1 text-[11px] text-muted">{T("Comfort {n}/10", { n: Math.round(m.score * 10) })}</p>
          </div>
        </div>
      </div>
      <p className="text-[11px] text-muted">{T("Daily records of the last two years, averaged (Open-Meteo, CC BY 4.0). Bars: day and night temperatures; blue: rain.")}</p>
    </section>
  );
}
