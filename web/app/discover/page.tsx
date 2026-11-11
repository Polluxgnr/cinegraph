"use client";

import { useMemo, useState } from "react";
import RecCard from "@/components/RecCard";
import type { FilmData } from "@/lib/data";
import { DOMAIN } from "@/lib/domains";
import { normTitle } from "@/lib/text";
import type { Rec } from "@/lib/engine/recommend";
import { useDomain, useSpace } from "@/lib/hooks";
import { LANG_NAMES } from "@/lib/text";
import type { Entity } from "@/lib/types";
import { useRecs } from "@/lib/useRecs";

type Sort = "match" | "date" | "popular" | "rating" | "length";

export default function Discover() {
  const domain = useSpace();
  const { data: d } = useDomain(domain);
  const [kind, setKind] = useState<"any" | "movie" | "tv">("any");
  const [tag, setTag] = useState<string | null>(null);
  const [lang, setLang] = useState<string | null>(null);
  const [decade, setDecade] = useState<number | null>(null);
  const [maxRt, setMaxRt] = useState<number | null>(null);
  const [sort, setSort] = useState<Sort>("match");
  const [showAnswered, setShowAnswered] = useState(false);
  const [q, setQ] = useState("");
  const words = useMemo(() => normTitle(q).split(" ").filter((w) => w.length > 1), [q]);

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

  // search fields, strongest first: a hit in the title beats one in the director, the cast, then the tags
  const fields = (e: Entity): string[] => {
    const f = e.film;
    const names = (ids?: number[]) => (f && d && "people" in d ? (ids ?? []).map((i) => (d as FilmData).people[i]).join(" ") : "");
    return [`${e.title} ${f?.ot ?? ""}`, `${names(f?.dir)} ${names(f?.cre)}`, `${names(f?.cast?.slice(0, 8))} ${e.subtitle}`, e.tags.join(" ")].map(normTitle);
  };
  const filter = (e: Entity) => {
    if (words.length) {
      const h = fields(e).join(" ");
      if (!words.every((w) => h.includes(w))) return false;
    }
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
  const key = [domain, kind, tag, lang, decade, maxRt, showAnswered, words.join(" ")].join("|");
  const recs = useRecs(d, { n: 60, filter, explore: sort === "match" && !words.length ? 0.1 : 0, includeAnswered: showAnswered || words.length > 0, includeListed: true, diversity: words.length ? 1 : 0.9 }, key);
  const sorted = useMemo(() => {
    if (!words.length || sort !== "match") return sortRecs(recs ?? [], sort);
    // relevance first (where the words hit, whole words over prefixes), then how much you'd like it
    const rel = (e: Entity) => {
      const fs = fields(e);
      return words.reduce((acc, w) => {
        const i = fs.findIndex((x) => x.includes(w));
        const whole = i >= 0 && new RegExp(`(^| )${w}( |$)`).test(fs[i]);
        return acc + (i < 0 ? 0 : (4 - i) * (whole ? 2 : 1));
      }, 0);
    };
    return [...(recs ?? [])].map((r) => ({ r, k: rel(r.entity) + r.p })).sort((a, b) => b.k - a.k).map((x) => x.r);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recs, sort, words]);
  const isFilm = domain === "films";

  return (
    <div key={domain} className="rise space-y-5">
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
      <input value={q} onChange={(e) => setQ(e.target.value)} type="search" autoFocus
             placeholder={domain === "films" ? "Search a title, a director, an actor, a theme…" : `Search ${DOMAIN[domain]?.label.toLowerCase()}…`}
             className="w-full rounded-xl border border-line bg-panel px-4 py-3 outline-none placeholder:text-muted/70 focus:border-accent" />
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
