"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { useMemo, useState } from "react";
import EntityImage from "@/components/EntityImage";
import { detailHref } from "@/components/RecCard";
import { COMPARE_ROWS, MAX_COMPARE, setCompare, toggleCompare, useCompare } from "@/lib/compare";
import { useDomain } from "@/lib/hooks";
import { useT } from "@/lib/i18n";
import { fmtPrice, normTitle } from "@/lib/text";
import type { Entity } from "@/lib/types";

const num = (e: Entity, k: string) => {
  const v = e.item?.meta?.[k];
  return typeof v === "number" && v > 0 ? v : undefined;
};

/** Cars side by side: every number with a bar, the best of each row lit, and what each one is for. */
export default function ComparePage() {
  const T = useT();
  const { data: d } = useDomain("cars");
  const keys = useCompare();
  const [q, setQ] = useState("");
  const cars = useMemo(() => (d ? keys.map((k) => d.entities[d.index.get(k) ?? -1]).filter(Boolean) : []), [d, keys]);
  const results = useMemo(() => {
    if (!d || q.trim().length < 2) return [];
    const w = normTitle(q).split(" ").filter(Boolean);
    return d.entities.filter((e) => !keys.includes(e.key) && w.every((x) => normTitle(`${e.title} ${e.subtitle}`).includes(x)))
      .sort((a, b) => (num(b, "hp") ? 1 : 0) - (num(a, "hp") ? 1 : 0) || b.pop - a.pop).slice(0, 8);
  }, [d, q, keys]);
  const rows = COMPARE_ROWS.filter((r) => cars.some((c) => num(c, r.key) != null));
  const text = (k: string) => cars.map((c) => String(c.item?.meta?.[k] ?? "—"));

  return (
    <div className="rise space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted">{T("Dream garage")}</p>
          <h1 className="font-display text-4xl md:text-5xl">{T("Compare")}</h1>
          <p className="text-sm text-muted">{T("Up to {n} cars side by side. Add them from a car's page or search here.", { n: MAX_COMPARE })}</p>
        </div>
        {cars.length > 0 && <button className="btn-ghost px-3 py-1.5 text-sm" onClick={() => setCompare([])}>{T("Clear")}</button>}
      </header>

      {cars.length < MAX_COMPARE && (
        <div className="relative max-w-md">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={T("Add a car: 911 GT3, Supra, Zonda…")} aria-label={T("Add a car")}
                 className="w-full rounded-xl border border-line bg-panel px-4 py-2.5 outline-none focus:border-accent" data-testid="compare-search" />
          {results.length > 0 && (
            <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-line bg-panel shadow-xl">
              {results.map((e) => (
                <li key={e.key}>
                  <button className="flex w-full items-center justify-between gap-2 px-4 py-2 text-left text-sm hover:bg-panel-2" onClick={() => { toggleCompare(e.key); setQ(""); }}>
                    <span>{e.title} <span className="text-muted">{e.subtitle}</span></span>
                    {num(e, "hp") && <span className="text-xs text-muted">{num(e, "hp")} hp</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {cars.length === 0 ? (
        <p className="card p-6 text-muted">{T("Nothing to compare yet. Open a car and press “Compare”, or search above.")}</p>
      ) : (
        <div className="-mx-4 overflow-x-auto px-4">
          <table className="w-full min-w-[560px] border-separate border-spacing-x-3 border-spacing-y-0 text-sm" data-testid="compare-table">
            <thead>
              <tr>
                <th className="w-32" />
                {cars.map((c) => (
                  <th key={c.key} className="align-top font-normal">
                    <motion.div layout initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-2 text-left">
                      <Link href={detailHref(c.key)} className="block overflow-hidden rounded-xl border border-line">
                        <EntityImage e={c} aspect="16/10" bare />
                      </Link>
                      <div className="flex items-start justify-between gap-2">
                        <Link href={detailHref(c.key)} className="font-display text-lg leading-tight hover:text-accent">{c.title}</Link>
                        <button onClick={() => toggleCompare(c.key)} className="text-muted hover:text-ink" aria-label={T("Remove")}>✕</button>
                      </div>
                      <p className="text-xs text-muted">{c.subtitle}</p>
                    </motion.div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const vals = cars.map((c) => num(c, r.key));
                const known = vals.filter((v): v is number => v != null);
                const best = r.better === "high" ? Math.max(...known) : Math.min(...known);
                const max = Math.max(...known);
                const lit = (v: number) => known.length > 1 && new Set(known).size > 1 && v === best;
                return (
                  <tr key={r.key}>
                    <td className="border-t border-line py-3 text-[11px] uppercase tracking-[0.14em] text-muted">{T(r.label)}</td>
                    {vals.map((v, i) => (
                      <td key={i} className="border-t border-line py-3">
                        {v == null ? <span className="text-muted">—</span> : (
                          <div className="space-y-1">
                            <p className={`font-display text-xl tabular-nums ${lit(v) ? "text-accent" : ""}`}>
                              {r.key === "price" ? fmtPrice(v, cars[i].item?.meta?.price_approx === true) : `${v.toLocaleString()} ${r.unit}`}
                              {lit(v) && <span className="ml-1 text-xs">★</span>}
                            </p>
                            <div className="h-1.5 overflow-hidden rounded-full bg-panel-2">
                              <motion.div className="h-full rounded-full bg-accent/70" initial={{ width: 0 }} animate={{ width: `${(v / max) * 100}%` }} transition={{ duration: 0.6, ease: "easeOut" }} />
                            </div>
                          </div>
                        )}
                      </td>
                    ))}
                  </tr>
                );
              })}
              {rows.some((r) => r.key === "hp") && rows.some((r) => r.key === "price") && (
                <tr>
                  <td className="border-t border-line py-3 text-[11px] uppercase tracking-[0.14em] text-muted">{T("€ per hp")}</td>
                  {cars.map((c) => {
                    const hp = num(c, "hp"), p = num(c, "price");
                    return <td key={c.key} className="border-t border-line py-3 font-display text-xl tabular-nums">{hp && p ? `${Math.round(p / hp).toLocaleString()} €` : <span className="text-muted">—</span>}</td>;
                  })}
                </tr>
              )}
              {(["engine", "drive", "gearbox", "body"] as const).filter((k) => cars.some((c) => c.item?.meta?.[k])).map((k) => (
                <tr key={k}>
                  <td className="border-t border-line py-3 text-[11px] uppercase tracking-[0.14em] text-muted">{T(k === "engine" ? "Engine" : k === "drive" ? "Drive" : k === "gearbox" ? "Gearbox" : "Body")}</td>
                  {text(k).map((v, i) => <td key={i} className="border-t border-line py-3">{v}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
          {cars.some((c) => num(c, "hp") == null) && <p className="mt-3 text-xs text-muted">{T("Cars without a spec sheet show “—”: figures exist for the curated models only.")}</p>}
        </div>
      )}
    </div>
  );
}
