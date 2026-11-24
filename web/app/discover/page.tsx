"use client";

import Link from "next/link";
import { useT } from "@/lib/i18n";

import { useMemo, useState } from "react";
import RecCard from "@/components/RecCard";
import WebLookup from "@/components/WebLookup";
import PeopleRow from "@/components/PeopleRow";
import PieceFromLink from "@/components/PieceFromLink";
import { GROUPS, groupTest, isAnimation, isAnime, subgenres } from "@/lib/groups";
import { cuisineOf, dietOf, type Diet, driveOf, engineOf, ENGINES, hpOf, ingredientText, MAINS, mainsOf, POWER, seatsOf, VIDEO_THEMES, videoScore, videoThemes } from "@/lib/facets";
import type { FilmData } from "@/lib/data";
import { DOMAIN } from "@/lib/domains";
import { crowdRating, minutesOf, normTitle } from "@/lib/text";
import type { Rec } from "@/lib/engine/recommend";
import { useDomain, useSpace } from "@/lib/hooks";
import { LANG_NAMES } from "@/lib/text";
import type { Entity } from "@/lib/types";
import { useRecs } from "@/lib/useRecs";
import { ALLERGEN_ICON, type Allergen, allergensOf, type Effort, effortOf, fridgeMatch, fridgeTerms, timeOf } from "@/lib/recipe";

type Sort = "match" | "date" | "popular" | "rating" | "length" | "liked" | "price-up" | "price-down";

export default function Discover() {
  const T = useT();
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
  const [more, setMore] = useState(false); // films: the "More filters" panel
  const [theme, setTheme] = useState<string | null>(null); // videos
  const [cuisine, setCuisine] = useState<string | null>(null); // recipes
  const [main, setMain] = useState<string | null>(null);
  const [diet, setDiet] = useState<Diet | null>(null);
  const [free, setFree] = useState<Allergen[]>([]); // recipes: free from
  const [effort, setEffort] = useState<Effort | null>(null);
  const [fridge, setFridge] = useState(false); // the search box lists what you have
  const terms = useMemo(() => (fridge ? fridgeTerms(q) : []), [fridge, q]);
  const [group, setGroup] = useState<string | null>(null); // films: studio / auteur / new releases
  const [anim, setAnim] = useState<"no-anime" | "none" | "only" | null>(null);
  const [sub, setSub] = useState<string | null>(null); // subgenre (keyword) within the chosen genre
  const [country, setCountry] = useState<string | null>(null); // destinations
  const [engine, setEngine] = useState<string | null>(null); // dream garage
  const [power, setPower] = useState<string | null>(null);
  const [seats, setSeats] = useState<number | null>(null);
  const [drive, setDrive] = useState<string | null>(null);
  const words = useMemo(() => (fridge && domain === "recipes" ? [] : normTitle(q).split(" ").filter((w) => w.length > 1)), [q, fridge, domain]);

  const facets = useMemo(() => {
    if (!d) return { tags: [] as string[], langs: [] as string[], cuisines: [] as string[], countries: [] as string[] };
    const tc = new Map<string, number>();
    const lc = new Map<string, number>();
    for (const e of d.entities) {
      // places: the kind of place (city, island...) only; their country has its own picker
      for (const t of e.film ? e.film.g ?? [] : e.domain === "places" ? e.tags.filter((x) => x === "capital" || x === e.tags[0]) : e.tags.slice(0, 3)) tc.set(t, (tc.get(t) ?? 0) + 1);
      if (e.film?.lang) lc.set(e.film.lang, (lc.get(e.film.lang) ?? 0) + 1);
    }
    const top = (mp: Map<string, number>, n: number) => [...mp.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);
    const cc = new Map<string, number>();
    if (d.name === "recipes") for (const e of d.entities) { const c = cuisineOf(e); if (c) cc.set(c, (cc.get(c) ?? 0) + 1); }
    const co = new Map<string, number>();
    if (d.name === "places") for (const e of d.entities) { const c = e.item?.meta?.country; if (typeof c === "string" && c) co.set(c, (co.get(c) ?? 0) + 1); }
    return { tags: top(tc, 24), langs: top(lc, 12), cuisines: [...cc.keys()].sort(), countries: [...co.keys()].sort((a, b) => a.localeCompare(b)) };
  }, [d]);

  // search fields, strongest first: a hit in the title beats one in the director, the cast, then the tags
  const fields = (e: Entity): string[] => {
    const f = e.film;
    const names = (ids?: number[]) => (f && d && "people" in d ? (ids ?? []).map((i) => (d as FilmData).people[i]).join(" ") : "");
    return [`${e.title} ${f?.t ?? ""} ${f?.tf ?? ""} ${f?.ot ?? ""} ${typeof e.item?.meta?.fr === "string" ? e.item.meta.fr : ""}`, `${names(f?.dir)} ${names(f?.cre)}`, `${names(f?.cast?.slice(0, 8))} ${e.subtitle}`, `${e.tags.join(" ")} ${e.domain === "recipes" ? ingredientText(e) : ""}`].map(normTitle);
  };
  const inGroup = group && d && "films" in d ? groupTest(d as FilmData, group) : null;
  const subs = useMemo(() => (tag && d && "films" in d ? subgenres(d as FilmData, tag) : []), [tag, d]);
  const filter = (e: Entity) => {
    if (words.length) {
      const fs = fields(e);
      const h = fs.join(" ");
      if (!words.every((w) => h.includes(w))) return false;
    }
    const f = e.film;
    if (f) {
      if (kind !== "any" && f.k !== kind) return false;
      if (lang && f.lang !== lang) return false;
      if (decade && (!f.y || Math.floor(f.y / 10) * 10 !== decade)) return false;
      if (maxRt && f.rt && f.rt > maxRt) return false;
      if (tag && !(f.g ?? []).includes(tag)) return false;
      if (sub && !(f.kw ?? []).includes(sub)) return false;
      if (anim === "none" && isAnimation(f)) return false;
      if (anim === "no-anime" && isAnime(f)) return false;
      if (anim === "only" && !isAnimation(f)) return false;
      if (inGroup && !inGroup(f)) return false;
    } else if (tag && !e.tags.includes(tag)) return false;
    if (theme && !videoThemes(e).includes(theme)) return false;
    if (engine && !engineOf(e).includes(engine)) return false;
    if (power) {
      const [, lo, hi] = POWER.find(([n]) => n === power)!;
      const hp = hpOf(e);
      if (hp == null || hp < lo || hp >= hi) return false;
    }
    if (seats && (seatsOf(e) ?? 0) < seats) return false;
    if (drive && !(driveOf(e) ?? "").includes(drive)) return false;
    if (country && e.item?.meta?.country !== country && e.title !== country) return false;
    if (cuisine && cuisineOf(e) !== cuisine) return false;
    if (main && !mainsOf(e).includes(main)) return false;
    if (diet && !(dietOf(e) === diet || (diet === "vegetarian" && dietOf(e) === "vegan"))) return false;
    if (e.domain === "recipes") {
      if (free.length && allergensOf(e).some((a) => free.includes(a))) return false;
      if (effort && effortOf(e) !== effort) return false;
      if (terms.length && !fridgeMatch(e, terms).have.length) return false;
    }
    return true;
  };
  const key = [domain, kind, tag, lang, decade, maxRt, showAnswered, country, theme, cuisine, main, diet, free.join(","), effort, terms.join(","), group, anim, sub, engine, power, seats, drive, words.join(" ")].join("|");
  const recs = useRecs(d, { n: 60, filter, explore: sort === "match" && !words.length ? 0.1 : 0, includeAnswered: showAnswered || words.length > 0, includeListed: true, diversity: words.length ? 1 : 0.9, noCaps: words.length > 0 }, key);
  const sorted = useMemo(() => {
    // fridge: most of your ingredients used first, then fewest still to buy
    if (terms.length) return [...(recs ?? [])].map((r) => ({ r, m: fridgeMatch(r.entity, terms) })).sort((a, b) => b.m.have.length - a.m.have.length || a.m.missing.length - b.m.missing.length || b.r.p - a.r.p).map((x) => x.r);
    if (!words.length || sort !== "match") return sortRecs(recs ?? [], sort, d?.entities ?? []);
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
  }, [recs, sort, words, terms]);
  const isFilm = domain === "films";

  return (
    <div key={domain} className="rise space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted">{T(DOMAIN[domain]?.label ?? "")}</p>
          <h1 className="font-display text-4xl md:text-5xl">{T("Search")}</h1>
        </div>
        <label className="flex items-center gap-2 text-sm text-muted">
          {T("Sort")}<select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="rounded-lg border border-line bg-panel px-2 py-1 text-ink">
            <option value="match">{T("Best match")}</option>
            <option value="date">{T("Newest first")}</option>
            <option value="popular">{T("Most popular")}</option>
            {isFilm && <option value="rating">{T("Community rating")}</option>}
            {(isFilm || domain === "youtube") && <option value="length">{T("Shortest first")}</option>}
            {domain === "recipes" && <option value="length">{T("Quickest first")}</option>}
            {domain === "youtube" && <option value="liked">{T("Best rated by viewers")}</option>}
            {(domain === "cars" || domain === "brands") && <option value="price-up">{T("Price: low to high")}</option>}
            {(domain === "cars" || domain === "brands") && <option value="price-down">{T("Price: high to low")}</option>}
          </select>
        </label>
      </header>
      <input value={q} onChange={(e) => setQ(e.target.value)} type="search" autoFocus
             placeholder={domain === "films" ? T("Search a title, a director, an actor, a theme…") : domain === "recipes" && fridge ? T("chicken, lemon, rice…") : domain === "recipes" ? T("A dish, an ingredient (chicken, lentils…), a cuisine…") : T("Search…")}
             className="w-full rounded-xl border border-line bg-panel px-4 py-3 outline-none placeholder:text-muted/70 focus:border-accent" />
      {isFilm && words.length > 0 && d ? <PeopleRow d={d as FilmData} q={q} /> : null}
      {isFilm && (
        <FilmFilters
          T={T} kind={kind} setKind={setKind} tags={facets.tags} tag={tag} setTag={(t) => { setTag(t); setSub(null); }} subs={subs} sub={sub} setSub={setSub}
          more={more} setMore={setMore} langs={facets.langs}
          v={{ maxRt, decade, lang, group, anim }}
          set={{ maxRt: setMaxRt, decade: setDecade, lang: setLang, group: setGroup, anim: setAnim }}
          reset={() => { setKind("any"); setTag(null); setSub(null); setMaxRt(null); setDecade(null); setLang(null); setGroup(null); setAnim(null); }}
        />
      )}
      <div className="space-y-2">
        {domain === "youtube" && (
          <div className="flex flex-wrap gap-1.5" aria-label={T("Themes")}>
            <button className="chip" data-on={!theme} onClick={() => setTheme(null)}>{T("All themes")}</button>
            {VIDEO_THEMES.map(([n]) => <button key={n} className="chip" data-on={theme === n} onClick={() => setTheme(theme === n ? null : n)}>{T(n)}</button>)}
          </div>
        )}
        {domain === "cars" && (
          <div className="space-y-1.5">
            <p className="text-[11px] text-muted">{T("Specs are known for the cars in the spec sheet; filtering by them shows only those.")}</p>
            <div className="flex flex-wrap gap-1.5" aria-label={T("Engine")}>
              <button className="chip text-xs" data-on={!engine} onClick={() => setEngine(null)}>{T("Any engine")}</button>
              {ENGINES.map(([n]) => <button key={n} className="chip text-xs" data-on={engine === n} onClick={() => setEngine(engine === n ? null : n)}>{T(n)}</button>)}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {POWER.map(([n]) => <button key={n} className="chip text-xs" data-on={power === n} onClick={() => setPower(power === n ? null : n)}>{n}</button>)}
              <span className="mx-1 w-px bg-line" />
              {[2, 4, 5].map((n) => <button key={n} className="chip text-xs" data-on={seats === n} onClick={() => setSeats(seats === n ? null : n)}>{n === 2 ? T("2 seats +") : T("{n} seats +", { n })}</button>)}
              <span className="mx-1 w-px bg-line" />
              {["RWD", "AWD", "4WD"].map((x) => <button key={x} className="chip text-xs" data-on={drive === x} onClick={() => setDrive(drive === x ? null : x)}>{x}</button>)}
              <Link href="/compare/" className="chip text-xs">⚖️ {T("Compare cars")}</Link>
            </div>
          </div>
        )}
        {domain === "places" && facets.countries.length > 0 && (
          <select value={country ?? ""} onChange={(e) => setCountry(e.target.value || null)} className="chip bg-transparent" aria-label={T("Country")} data-testid="country">
            <option value="">{T("Every country")}</option>
            {facets.countries.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        {domain === "recipes" && (
          <div className="flex flex-wrap gap-1.5">
            <button className="chip" data-on={!main && !diet} onClick={() => { setMain(null); setDiet(null); }}>{T("Anything")}</button>
            {MAINS.map(([n]) => <button key={n} className="chip" data-on={main === n} onClick={() => { setMain(main === n ? null : n); setDiet(null); }}>{T(n)}</button>)}
            <span className="mx-1 w-px bg-line" />
            {(["vegetarian", "vegan"] as const).map((x) => <button key={x} className="chip" data-on={diet === x} onClick={() => { setDiet(diet === x ? null : x); setMain(null); }}>{x === "vegetarian" ? T("🌱 Vegetarian") : T("🌿 Vegan")}</button>)}
            <span className="mx-1 w-px bg-line" />
            <select value={cuisine ?? ""} onChange={(e) => setCuisine(e.target.value || null)} className="chip bg-transparent" aria-label={T("Cuisine")}>
              <option value="">{T("Every cuisine")}</option>
              {facets.cuisines.map((c) => <option key={c} value={c}>{T(c)}</option>)}
            </select>
            <span className="mx-1 w-px bg-line" />
            {(["Easy", "Medium", "Involved"] as const).map((x) => <button key={x} className="chip text-xs" data-on={effort === x} onClick={() => setEffort(effort === x ? null : x)}>{T(x)}</button>)}
            <div className="flex w-full flex-wrap items-center gap-1.5">
              <span className="text-[11px] uppercase tracking-[0.14em] text-muted">{T("Free from")}</span>
              {(["gluten", "dairy", "eggs", "nuts", "peanuts", "fish", "shellfish", "sesame", "soy"] as const).map((a) => (
                <button key={a} className="chip text-xs" data-on={free.includes(a)} onClick={() => setFree(free.includes(a) ? free.filter((x) => x !== a) : [...free, a])}>{ALLERGEN_ICON[a]} {T(a)}</button>
              ))}
              <span className="mx-1 w-px self-stretch bg-line" />
              <button className="chip text-xs" data-on={fridge} onClick={() => setFridge(!fridge)} data-testid="fridge">🧊 {T("What's in my fridge")}</button>
            </div>
            {fridge && <p className="w-full text-xs text-muted">{T("List what you have in the search box, separated by commas (chicken, lemon, rice): recipes using most of it come first, with what's left to buy.")}</p>}
          </div>
        )}
        {!isFilm && (
          <div className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4">
            <button className="chip shrink-0" data-on={!tag} onClick={() => setTag(null)}>{T("All")}</button>
            {facets.tags.map((t) => <button key={t} className="chip shrink-0" data-on={tag === t} onClick={() => setTag(tag === t ? null : t)}>{T(t)}</button>)}
          </div>
        )}
        <label className="flex items-center gap-2 text-xs text-muted">
          <input type="checkbox" checked={showAnswered} onChange={(e) => setShowAnswered(e.target.checked)} /> {T("include things I already answered")}</label>
      </div>
      {domain === "brands" && words.length > 0 && recs && recs.length < 6 && <WebLookup key={q.trim()} query={q.trim()} />}
      {domain === "brands" && !words.length && <PieceFromLink d={d} />}
      <div key={key + sort} className="stagger grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
        {recs ? sorted.map((r) => terms.length ? (
          <div key={r.entity.key} className="space-y-1">
            <RecCard r={r} />
            <FridgeLine e={r.entity} terms={terms} />
          </div>
        ) : <RecCard key={r.entity.key} r={r} />) : Array.from({ length: 12 }).map((_, i) => <div key={i} className="card aspect-[2/3] animate-pulse" />)}
      </div>
      {recs && !recs.length && <p className="text-muted">{T("Nothing matches these filters.")}</p>}
    </div>
  );
}

const meta = (r: Rec, k: string) => {
  const v = r.entity.item?.meta?.[k];
  return typeof v === "number" ? v : 0;
};

function sortRecs(recs: Rec[], sort: Sort, all: Entity[]): Rec[] {
  const by = (fn: (r: Rec) => number) => [...recs].sort((a, b) => fn(b) - fn(a));
  switch (sort) {
    case "date": return by((r) => (r.entity.date ? Date.parse(r.entity.date) : 0));
    case "popular": return by((r) => r.entity.pop);
    case "rating": return by((r) => crowdRating(r.entity.film)?.v ?? 0);
    case "length": return by((r) => -(minutesOf(r.entity) || (r.entity.domain === "recipes" ? timeOf(r.entity) : 0) || 999));
    case "liked": return by((r) => videoScore(r.entity, all) ?? 0);
    case "price-up": return by((r) => -(meta(r, "price") || 1e12));
    case "price-down": return by((r) => meta(r, "price"));
    default: return recs;
  }
}

function FridgeLine({ e, terms }: { e: Entity; terms: string[] }) {
  const T = useT();
  const m = fridgeMatch(e, terms);
  return (
    <p className="px-1 text-[11px] leading-snug text-muted" data-testid="fridge-line">
      <b className="text-accent">{m.have.length}/{terms.length}</b> {T("of yours")}
      {m.missing.length > 0 && <> · {T("to buy")}: {m.missing.slice(0, 3).map((x) => x.replace(/^[\d\s/½¼¾.,]+(g|kg|ml|l|tsp|tbsp|tablespoons?|teaspoons?|cups?|cloves?)?\s*/i, "")).join(", ")}{m.missing.length > 3 ? ` +${m.missing.length - 3}` : ""}</>}
    </p>
  );
}

type Tr = ReturnType<typeof useT>;
type Anim = "no-anime" | "none" | "only" | null;
const LENGTHS: [number, string][] = [[100, "≤ 1h40"], [120, "≤ 2h"], [150, "≤ 2h30"]];
const DECADES = [2020, 2010, 2000, 1990, 1980, 1970, 1960, 1950];
const ANIM: [Exclude<Anim, null>, string][] = [["no-anime", "No anime / manga"], ["none", "No animation"], ["only", "Animation only"]];

/** One labelled line of choices inside "More filters". */
function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-[9rem_1fr] sm:items-baseline">
      <p className="text-[11px] uppercase tracking-[0.14em] text-muted">{label}</p>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

/**
 * Films & series: the type and the genre are always visible (with the genre's subgenres underneath); everything else
 * waits in "More filters". Whatever is on shows as a chip you can remove, so nothing filters silently.
 */
function FilmFilters({ T, kind, setKind, tags, tag, setTag, subs, sub, setSub, more, setMore, langs, v, set, reset }: {
  T: Tr; kind: "any" | "movie" | "tv"; setKind: (k: "any" | "movie" | "tv") => void; tags: string[]; tag: string | null; setTag: (t: string | null) => void;
  subs: string[]; sub: string | null; setSub: (s: string | null) => void; more: boolean; setMore: (b: boolean) => void; langs: string[];
  v: { maxRt: number | null; decade: number | null; lang: string | null; group: string | null; anim: Anim };
  set: { maxRt: (x: number | null) => void; decade: (x: number | null) => void; lang: (x: string | null) => void; group: (x: string | null) => void; anim: (x: Anim) => void };
  reset: () => void;
}) {
  const active: [string, () => void][] = [
    ...(kind !== "any" ? [[kind === "movie" ? T("Films") : T("Series"), () => setKind("any")] as [string, () => void]] : []),
    ...(tag ? [[T(tag), () => setTag(null)] as [string, () => void]] : []),
    ...(sub ? [[T(sub), () => setSub(null)] as [string, () => void]] : []),
    ...(v.maxRt ? [[LENGTHS.find(([m]) => m === v.maxRt)?.[1] ?? "", () => set.maxRt(null)] as [string, () => void]] : []),
    ...(v.decade ? [[`${v.decade}${T("s")}`, () => set.decade(null)] as [string, () => void]] : []),
    ...(v.lang ? [[`VO ${LANG_NAMES[v.lang] ?? v.lang}`, () => set.lang(null)] as [string, () => void]] : []),
    ...(v.group ? [[T(GROUPS.find((g) => g.id === v.group)?.label ?? v.group), () => set.group(null)] as [string, () => void]] : []),
    ...(v.anim ? [[T(ANIM.find(([a]) => a === v.anim)![1]), () => set.anim(null)] as [string, () => void]] : []),
  ];
  const hidden = [v.maxRt, v.decade, v.lang, v.group, v.anim].filter(Boolean).length;
  return (
    <div className="space-y-3" data-testid="film-filters">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-full border border-line bg-panel p-0.5 text-sm" role="radiogroup" aria-label={T("Type")}>
          {(["any", "movie", "tv"] as const).map((k) => (
            <button key={k} role="radio" aria-checked={kind === k} onClick={() => setKind(k)}
                    className={`rounded-full px-3 py-1 transition ${kind === k ? "bg-accent text-bg" : "text-muted hover:text-ink"}`}>
              {k === "any" ? T("Both") : k === "movie" ? T("Films") : T("Series")}
            </button>
          ))}
        </div>
        <button className="chip" data-on={more || hidden > 0} onClick={() => setMore(!more)} aria-expanded={more} data-testid="more-filters">
          ⚙ {T("More filters")}{hidden ? ` · ${hidden}` : ""} {more ? "▴" : "▾"}
        </button>
        {active.length > 0 && <button className="text-xs text-muted underline-offset-2 hover:text-ink hover:underline" onClick={reset}>{T("Reset")}</button>}
      </div>

      <div>
        <p className="mb-1.5 text-[11px] uppercase tracking-[0.14em] text-muted">{T("Genre")}</p>
        <div className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4">
          <button className="chip shrink-0" data-on={!tag} onClick={() => setTag(null)}>{T("All")}</button>
          {tags.map((t) => <button key={t} className="chip shrink-0" data-on={tag === t} onClick={() => setTag(tag === t ? null : t)}>{T(t)}</button>)}
        </div>
        {subs.length > 0 && (
          <div className="no-scrollbar -mx-4 mt-2 flex gap-1.5 overflow-x-auto border-l-2 border-accent/50 px-4 pl-3" aria-label={T("Subgenres")}>
            <span className="shrink-0 self-center pr-1 text-[11px] text-muted">{T(tag ?? "")} ›</span>
            {subs.map((k) => <button key={k} className="chip shrink-0 text-xs" data-on={sub === k} onClick={() => setSub(sub === k ? null : k)}>{T(k)}</button>)}
          </div>
        )}
      </div>

      {more && (
        <div className="card space-y-3 p-4" data-testid="more-panel">
          <Line label={T("Length")}>
            <button className="chip text-xs" data-on={!v.maxRt} onClick={() => set.maxRt(null)}>{T("Any length")}</button>
            {LENGTHS.map(([m, l]) => <button key={m} className="chip text-xs" data-on={v.maxRt === m} onClick={() => set.maxRt(v.maxRt === m ? null : m)}>{l}</button>)}
          </Line>
          <Line label={T("Decade")}>
            <button className="chip text-xs" data-on={!v.decade} onClick={() => set.decade(null)}>{T("Any decade")}</button>
            {DECADES.map((x) => <button key={x} className="chip text-xs" data-on={v.decade === x} onClick={() => set.decade(v.decade === x ? null : x)}>{x}{T("s")}</button>)}
          </Line>
          <Line label={T("Original language")}>
            <button className="chip text-xs" data-on={!v.lang} onClick={() => set.lang(null)}>{T("Any")}</button>
            {langs.map((l) => <button key={l} className="chip text-xs" data-on={v.lang === l} onClick={() => set.lang(v.lang === l ? null : l)}>{LANG_NAMES[l] ?? l}</button>)}
          </Line>
          <Line label={T("Collections")}>
            {GROUPS.map((g) => <button key={g.id} className="chip text-xs" data-on={v.group === g.id} onClick={() => set.group(v.group === g.id ? null : g.id)}>{g.id === "new" ? "✨ " : ""}{T(g.label)}</button>)}
          </Line>
          <Line label={T("Animation")}>
            <button className="chip text-xs" data-on={!v.anim} onClick={() => set.anim(null)}>{T("Everything")}</button>
            {ANIM.map(([a, l]) => <button key={a} className="chip text-xs" data-on={v.anim === a} onClick={() => set.anim(v.anim === a ? null : a)}>{T(l)}</button>)}
          </Line>
        </div>
      )}

      {active.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5" data-testid="active-filters">
          <span className="text-[11px] text-muted">{T("Showing")}:</span>
          {active.map(([l, clear]) => (
            <button key={l} onClick={clear} className="flex items-center gap-1 rounded-full bg-accent/15 px-2.5 py-0.5 text-xs text-accent hover:bg-accent/25" aria-label={`${T("Remove")} ${l}`}>
              {l} <span aria-hidden>×</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
