"use client";

import { useMemo, useState } from "react";
import RecCard from "@/components/RecCard";
import { DOMAIN, DOMAINS } from "@/lib/domains";
import type { Rec } from "@/lib/engine/recommend";
import { useDomain, useManifest, useQueryParam } from "@/lib/hooks";
import { LANG_NAMES } from "@/lib/text";
import type { Entity } from "@/lib/types";
import { useRecs } from "@/lib/useRecs";

type Sort = "match" | "date" | "popular" | "rating" | "length";

export default function Discover() {
  const [dParam, setD] = useQueryParam("d");
  const domain = dParam && DOMAIN[dParam] ? dParam : "films";
  const m = useManifest().data;
  const { data: d } = useDomain(domain);
  const [kind, setKind] = useState<"any" | "movie" | "tv">("any");
  const [tag, setTag] = useState<string | null>(null);
  const [lang, setLang] = useState<string | null>(null);
  const [decade, setDecade] = useState<number | null>(null);
  const [maxRt, setMaxRt] = useState<number | null>(null);
  const [sort, setSort] = useState<Sort>("match");
  const [showAnswered, setShowAnswered] = useState(false);

  const facets = useMemo(() => {
    if (!d) return { tags: [] as string[], langs: [] as string[] };
    const tc = new Map<string, number>();
    const lc = new Map<string, number>();
    for (const e of d.entities) {
      for (const t of e.film ? e.film.g ?? [] : e.tags.slice(0, 3)) tc.set(t, (tc.get(t) ?? 0) + 1);
      if (e.film?.lang) lc.set(e.film.lang, (lc.get(e.film.lang) ?? 0) + 1);
    }
    const top = (mp: Map<string, number>, n: number) => [...mp.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);
    return { tags: top(tc, 24), langs: top(lc, 12) };
  }, [d]);

  const filter = (e: Entity) => {
    const f = e.film;
    if (f) {
      if (kind !== "any" && f.k !== kind) return false;
      if (lang && f.lang !== lang) return false;
      if (decade && (!f.y || Math.floor(f.y / 10) * 10 !== decade)) return false;
      if (maxRt && f.rt && f.rt > maxRt) return false;
      if (tag && !(f.g ?? []).includes(tag)) return false;
    } else if (tag && !e.tags.includes(tag)) return false;
    return true;
  };
  const key = [domain, kind, tag, lang, decade, maxRt, showAnswered].join("|");
  const recs = useRecs(d, { n: 60, filter, explore: sort === "match" ? 0.1 : 0, includeAnswered: showAnswered, includeListed: true, diversity: 0.9 }, key);
  const sorted = useMemo(() => sortRecs(recs ?? [], sort), [recs, sort]);
  const isFilm = domain === "films";

  return (
    <div className="space-y-5">
      <div className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4">
        {DOMAINS.filter((x) => !m || x.name === "films" || m.domains[x.name]?.count).map((x) => (
          <button key={x.name} className="chip shrink-0" data-on={x.name === domain} onClick={() => { setD(x.name); setTag(null); }}>{x.emoji} {x.short}</button>
        ))}
      </div>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-display text-4xl md:text-5xl">{DOMAIN[domain]?.label}</h1>
        <label className="flex items-center gap-2 text-sm text-muted">
          Sort
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="rounded-lg border border-line bg-panel px-2 py-1 text-ink">
            <option value="match">Best match</option>
            <option value="date">Newest first</option>
            <option value="popular">Most popular</option>
            {isFilm && <option value="rating">Community rating</option>}
            {isFilm && <option value="length">Shortest first</option>}
          </select>
        </label>
      </header>
      <div className="space-y-2">
        {isFilm && (
          <div className="flex flex-wrap gap-1.5">
            {(["any", "movie", "tv"] as const).map((k) => <button key={k} className="chip" data-on={kind === k} onClick={() => setKind(k)}>{k === "any" ? "Films & series" : k === "movie" ? "Films" : "Series"}</button>)}
            <span className="mx-1 w-px bg-line" />
            {[null, 100, 120, 150].map((r) => <button key={String(r)} className="chip" data-on={maxRt === r} onClick={() => setMaxRt(r)}>{r ? `≤ ${Math.floor(r / 60)}h${r % 60 ? String(r % 60).padStart(2, "0") : ""}` : "Any length"}</button>)}
            <span className="mx-1 w-px bg-line" />
            <select value={decade ?? ""} onChange={(e) => setDecade(e.target.value ? +e.target.value : null)} className="chip bg-transparent">
              <option value="">Any decade</option>
              {[2020, 2010, 2000, 1990, 1980, 1970, 1960, 1950].map((x) => <option key={x} value={x}>{x}s</option>)}
            </select>
            <select value={lang ?? ""} onChange={(e) => setLang(e.target.value || null)} className="chip bg-transparent">
              <option value="">Any VO</option>
              {facets.langs.map((l) => <option key={l} value={l}>{LANG_NAMES[l] ?? l}</option>)}
            </select>
          </div>
        )}
        <div className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4">
          <button className="chip shrink-0" data-on={!tag} onClick={() => setTag(null)}>All</button>
          {facets.tags.map((t) => <button key={t} className="chip shrink-0" data-on={tag === t} onClick={() => setTag(tag === t ? null : t)}>{t}</button>)}
        </div>
        <label className="flex items-center gap-2 text-xs text-muted">
          <input type="checkbox" checked={showAnswered} onChange={(e) => setShowAnswered(e.target.checked)} /> include things I already answered
        </label>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
        {recs ? sorted.map((r) => <RecCard key={r.entity.key} r={r} />) : Array.from({ length: 12 }).map((_, i) => <div key={i} className="card aspect-[2/3] animate-pulse" />)}
      </div>
      {recs && !recs.length && <p className="text-muted">Nothing matches these filters.</p>}
    </div>
  );
}

function sortRecs(recs: Rec[], sort: Sort): Rec[] {
  const by = (fn: (r: Rec) => number) => [...recs].sort((a, b) => fn(b) - fn(a));
  switch (sort) {
    case "date": return by((r) => (r.entity.date ? Date.parse(r.entity.date) : 0));
    case "popular": return by((r) => r.entity.pop);
    case "rating": return by((r) => r.entity.film?.va ?? 0);
    case "length": return by((r) => -(r.entity.film?.rt ?? 999));
    default: return recs;
  }
}
