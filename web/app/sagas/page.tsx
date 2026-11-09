"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import EntityImage from "@/components/EntityImage";
import { detailHref, Progress } from "@/components/RecCard";
import { useFilms } from "@/lib/hooks";
import { useStore } from "@/lib/store";

const SEEN = ["loved", "liked", "ok", "disliked"];

/** Franchises grouped (Harry Potter, Star Wars, Marvel...) with a progress bar each. */
export default function Sagas() {
  const films = useFilms().data;
  const feedback = useStore((s) => s.feedback);
  const [q, setQ] = useState("");
  const [onlyStarted, setOnlyStarted] = useState(false);
  const sagas = useMemo(() => {
    if (!films) return [];
    return films.collections
      .map((c) => {
        const seen = c.items.filter((id) => SEEN.includes(feedback[`films:${id}`]?.action ?? "")).length;
        const pop = c.items.reduce((s, id) => s + (films.entities[films.index.get(`films:${id}`)!]?.pop ?? 0), 0);
        return { c, seen, pop };
      })
      .filter((x) => (!onlyStarted || x.seen > 0) && x.c.name.toLowerCase().includes(q.toLowerCase()))
      .sort((a, b) => (b.seen > 0 ? 1 : 0) - (a.seen > 0 ? 1 : 0) || b.pop - a.pop);
  }, [films, feedback, q, onlyStarted]);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-4xl md:text-5xl">Sagas</h1>
          <p className="text-sm text-muted">Franchises in viewing order, with your progress.</p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-muted"><input type="checkbox" checked={onlyStarted} onChange={(e) => setOnlyStarted(e.target.checked)} /> started</label>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a saga…" className="rounded-xl border border-line bg-panel px-3 py-2 text-sm outline-none focus:border-accent" />
        </div>
      </header>
      <div className="grid gap-3 md:grid-cols-2">
        {sagas.slice(0, 80).map(({ c, seen }) => (
          <section key={c.key} className="card p-4">
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <h2 className="truncate font-display text-2xl">{c.name}</h2>
              <span className="shrink-0 text-xs text-muted">{seen} / {c.items.length}</span>
            </div>
            <Progress value={seen / c.items.length} />
            <div className="no-scrollbar mt-3 flex gap-2 overflow-x-auto">
              {c.items.map((id) => {
                const k = `films:${id}`;
                const e = films!.entities[films!.index.get(k)!];
                const done = SEEN.includes(feedback[k]?.action ?? "");
                return (
                  <Link key={id} href={detailHref(k)} className={`w-20 shrink-0 ${done ? "" : "opacity-60"}`} title={e.title}>
                    <div className={`overflow-hidden rounded-lg border ${done ? "border-like" : "border-line"}`}><EntityImage e={e} aspect="2/3" /></div>
                    <p className="mt-1 line-clamp-1 text-[11px]">{e.film?.y}</p>
                  </Link>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
