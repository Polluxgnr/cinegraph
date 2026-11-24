"use client";

import { filmOverview, useT, itemDescription } from "@/lib/i18n";

import Link from "next/link";
import { useMemo } from "react";
import AnswerPanel from "@/components/AnswerPanel";
import EntityImage from "@/components/EntityImage";
import Match from "@/components/Match";
import RecCard, { detailHref, Progress, Row } from "@/components/RecCard";
import Stars from "@/components/Stars";
import { type DomainData, type FilmData, isFilmData } from "@/lib/data";
import { actionLabel, DOMAIN } from "@/lib/domains";
import { answer } from "@/lib/engine/learn";
import { recommend, scoreOne } from "@/lib/engine/recommend";
import { useDomain, useQueryParam } from "@/lib/hooks";
import { addVault, getState, isDone, setList, setProgress, useLoaded, useStore } from "@/lib/store";
import { crowdRating, exploreLinks, fmtRuntime, itemFacts, LANG_NAMES } from "@/lib/text";
import type { Entity } from "@/lib/types";
import ArtistPanel from "@/components/ArtistPanel";
import { useFilmDetails } from "@/lib/useFilmDetails";
import FilmSources from "@/components/FilmSources";
import CastStrip from "@/components/CastStrip";
import RecipeView from "@/components/RecipeView";
import { toggleCompare, useCompare } from "@/lib/compare";
import Poster3D from "@/components/Poster3D";
import AskPeople from "@/components/AskPeople";
import { carSpecs, cuisineOf, dietOf, mainsOf, variations } from "@/lib/facets";
import MatchBreakdown from "@/components/MatchBreakdown";
import BrandPieces from "@/components/BrandPieces";
import { trailerSearch } from "@/components/MediaPreview";
import PlaceSpots from "@/components/PlaceSpots";
import PlaceClimate from "@/components/PlaceClimate";
import { deezerArtistId } from "@/lib/deezer";
import { watchOptions } from "@/lib/watch";

const LINK_LABEL: Record<string, string> = {
  senscritique: "SensCritique", allocine: "AlloCiné", letterboxd: "Letterboxd", imdb: "IMDb", wikipedia: "Wikipedia",
  tmdb: "TMDB", wikidata: "Wikidata", justwatch: "JustWatch", marmiton: "Marmiton", video: "Video", wikivoyage: "Wikivoyage",
  maps: "Map", pinterest: "Pinterest", spotify: "Spotify", youtube: "YouTube", shop: "Find it new", vinted: "Second hand (Vinted)",
  instagram: "Instagram", deezer: "Deezer", configurator: "Configure it",
};

export default function ItemPage() {
  const T = useT();
  const [k] = useQueryParam("k");
  const domain = k?.split(":")[0] ?? "films";
  const { data: d } = useDomain(domain);
  if (!k) return null;
  if (!d) return <div className="card h-96 animate-pulse" />;
  const row = d.index.get(k);
  if (row == null) return <p className="card p-4">{T("Not found in the catalogue.")}</p>;
  return <Detail key={k} d={d} row={row} />;
}

function Detail({ d, row }: { d: DomainData; row: number }) {
  const T = useT();
  const e = d.entities[row];
  useFilmDetails(e.film);
  const cfg = DOMAIN[e.domain];
  const loaded = useLoaded();
  const version = useStore((s) => s.updatedAt);
  const fb = useStore((s) => s.feedback[e.key]);
  const listed = useStore((s) => s.lists[e.key]);
  const rec = useMemo(() => (loaded ? scoreOne(d, getState(), row) : null), [d, row, loaded, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const similar = useMemo(() => {
    if (!loaded || !d.emb) return [];
    const v = d.emb.row(row);
    const sims: [number, number][] = [];
    for (let i = 0; i < d.entities.length; i++) if (i !== row) sims.push([i, d.emb.dot(i, v) / d.norms[i]]);
    sims.sort((a, b) => b[1] - a[1]);
    const keep = new Set(sims.slice(0, 40).map(([i]) => d.entities[i].key));
    return recommend(d, getState(), { n: 12, explore: 0, includeListed: true, filter: (x) => keep.has(x.key) });
  }, [d, row, loaded, version]); // eslint-disable-line react-hooks/exhaustive-deps

  const variants = useMemo(() => {
    if (!loaded || e.domain !== "recipes") return [];
    const keep = new Set(variations(e, d.entities, 12).map((x) => x.key));
    return keep.size ? recommend(d, getState(), { n: 12, explore: 0, includeListed: true, includeAnswered: true, noCaps: true, filter: (x) => keep.has(x.key) }) : [];
  }, [d, e, loaded, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const recipeBadges = e.domain === "recipes" ? [cuisineOf(e), ...mainsOf(e), dietOf(e) === "vegan" ? "🌿 Vegan" : dietOf(e) === "vegetarian" ? "🌱 Vegetarian" : undefined].filter(Boolean) as string[] : [];

  const f = e.film;
  const backdrop = f?.bd;
  return (
    <div className="space-y-10">
      {backdrop && (
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[75vh] overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element -- TMDB backdrop */}
          <img src={backdrop} alt="" className="hero-backdrop h-full w-full object-cover object-top opacity-60" />
          <div className="absolute inset-0 bg-gradient-to-t from-bg via-bg/70 to-bg/20" />
          <div className="absolute inset-0 bg-gradient-to-r from-bg/80 to-transparent" />
        </div>
      )}
      <div className={`relative grid gap-6 md:grid-cols-[280px_1fr] ${backdrop ? "pt-[22vh] md:pt-[28vh]" : ""}`}>
        <Poster3D className="mx-auto w-52 self-start md:w-full">
          <EntityImage e={e} aspect={cfg?.aspect ?? "2/3"} big />
        </Poster3D>
        <div className="space-y-4">
          <div>
            {!f && <p className="text-xs uppercase tracking-[0.2em] text-muted">{cfg?.emoji} {cfg?.label}</p>}
            <h1 className="font-display text-4xl leading-tight md:text-6xl">{e.title}</h1>
            {f?.ot && <p className="text-muted">{f.ot}</p>}
            {!f && e.subtitle && <p className="text-muted">{e.subtitle}</p>}
            {!f && itemFacts(e).length > 0 && <p className="text-sm text-ink/80">{itemFacts(e).join(" · ")}</p>}
          </div>
          {rec && (
            <div className="space-y-1">
              <Match p={rec.p} film={rec.entity.film} />
              <p className="text-sm text-ink/85">{rec.why}</p>
            </div>
          )}
          {f ? <FilmFacts d={d as FilmData} row={row} /> : <ItemFacts e={e} />}

          <div className="card space-y-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-muted">{fb ? `${T("Your answer")}: ${actionLabel(e.domain, fb.action)}${fb.chips?.length ? ` (${fb.chips.join(", ")})` : ""}` : T("What do you think?")}</p>
              <div className="flex gap-2">
                <button className="btn-ghost px-3 py-1.5 text-xs" onClick={() => setList(e.key, e.domain, listed ? null : "want")}>{listed ? T("✓ On my list") : T("+ My list")}</button>
                <button className="btn-ghost px-3 py-1.5 text-xs" onClick={() => addVault({ title: e.title, url: e.item?.url ?? f?.links?.wikipedia, tags: [e.domain, ...e.tags.slice(0, 3)], domain: e.domain, image: e.image })}>{T("Save to vault")}</button>
              </div>
            </div>
            <AnswerPanel e={e} onAnswer={(a, extra) => answer(e.key, e.domain, a, { ...extra, source: "detail" })} compact />
            {f && (
              <div className="flex items-center gap-3 border-t border-line pt-3">
                <span className="text-xs text-muted">{T("Rate it")}</span>
                <Stars value={fb?.rating ?? null} size={24} onChange={(v) => answer(e.key, e.domain, v >= 4.5 ? "loved" : v >= 3.5 ? "liked" : v >= 2.5 ? "ok" : "disliked", { rating: v, source: "detail" })} />
              </div>
            )}
          </div>
          {f?.k === "tv" && <SeriesTracker k={e.key} seasons={f.ns ?? 0} />}
        </div>
      </div>
      {f && isFilmData(d) && <CastStrip d={d} f={f} />}
      {rec && <MatchBreakdown d={d} rec={rec} s={getState()} />}
      {f && <Trailer e={e} />}
      {f && <FilmSources f={f} />}
      {deezerArtistId(e.key) && <ArtistPanel id={deezerArtistId(e.key)!} d={d} />}
      {e.domain === "places" && <PlaceClimate e={e} />}
      {e.domain === "places" && <PlaceSpots e={e} />}
      {e.domain === "brands" && <BrandPieces d={d} e={e} />}
      {f && <Saga d={d as FilmData} row={row} />}
      {carSpecs(e).length > 0 && (
        <section className="card grid gap-x-8 gap-y-3 p-5 sm:grid-cols-2 lg:grid-cols-4">
          {carSpecs(e).map(([k, v]) => (
            <div key={k}><p className="text-[11px] uppercase tracking-[0.14em] text-muted">{T(k)}</p><p className="font-display text-xl">{v}</p></div>
          ))}
          <div className="flex flex-wrap items-center justify-between gap-2 sm:col-span-2 lg:col-span-4">
            <p className="text-[11px] text-muted">{T("Approximate figures from the manufacturer, rounded (config/car_specs.yaml).")}</p>
            <CompareButton k={e.key} />
          </div>
        </section>
      )}
      {recipeBadges.length > 0 && <div className="flex flex-wrap gap-1.5">{recipeBadges.map((b) => <span key={b} className="chip text-xs">{T(b)}</span>)}</div>}
      {variants.length > 0 && <Row title={T("Variations")} hint={T("Other takes on the same dish, and recipes sharing most of its ingredients")}>{variants.map((r) => <RecCard key={r.entity.key} r={r} />)}</Row>}
      <AskPeople key={e.key} suggestions={askFor(e, T)} />
      {similar.length > 0 && <Row title={T("Similar")}>{similar.map((r) => <RecCard key={r.entity.key} r={r} />)}</Row>}
    </div>
  );
}

function Trailer({ e }: { e: Entity }) {
  const T = useT();
  const key = e.film?.tr;
  return (
    <section>
      <h2 className="mb-3 font-display text-2xl">{T("Trailer")}</h2>
      {key ? (
        <div className="aspect-video max-w-3xl overflow-hidden rounded-2xl border border-line bg-black">
          <iframe className="h-full w-full" src={`https://www.youtube-nocookie.com/embed/${key}?rel=0`} title={`${e.title} trailer`}
                  allow="encrypted-media; picture-in-picture; fullscreen" allowFullScreen loading="lazy" />
        </div>
      ) : (
        <a href={trailerSearch(e)} target="_blank" rel="noreferrer" className="btn-ghost text-sm">{T("▶ Watch the trailer on YouTube ↗")}</a>
      )}
    </section>
  );
}

function Links({ links }: { links?: Record<string, string> }) {
  const T = useT();
  if (!links) return null;
  const order = ["senscritique", "allocine", "letterboxd", "imdb", "justwatch", "wikipedia", "tmdb"];
  const entries = Object.entries(links).sort((a, b) => (order.indexOf(a[0]) + 99) % 99 - (order.indexOf(b[0]) + 99) % 99);
  return (
    <div className="flex flex-wrap gap-1.5">
      {entries.map(([k, v]) => (
        <a key={k} href={v} target="_blank" rel="noreferrer" className="chip text-xs hover:text-ink">{T(LINK_LABEL[k] ?? k)} ↗</a>
      ))}
    </div>
  );
}

function FilmFacts({ d, row }: { d: FilmData; row: number }) {
  const T = useT();
  const f = d.films[row];
  const platforms = useStore((s) => s.settings.platforms);
  const names = (ids?: number[]) => (ids ?? []).map((i) => d.people[i]).join(", ");
  const facts: [string, string][] = [
    ["Released", f.d ? new Date(f.d).toLocaleDateString("fr-FR", { year: "numeric", month: "long", day: "numeric" }) : String(f.y ?? "")],
    ["Length", f.k === "tv" ? [f.ns ? T(f.ns === 1 ? "{n} season" : "{n} seasons", { n: f.ns }) : "", f.ne ? T(f.ne === 1 ? "{n} episode" : "{n} episodes", { n: f.ne }) : "", f.rt ? T("{n} min/ep", { n: f.rt }) : ""].filter(Boolean).join(" · ") : fmtRuntime(f.rt)],
    ["Original language (VO)", f.lang ? LANG_NAMES[f.lang] ?? f.lang : ""],
    ["Countries", (f.c ?? []).join(", ")],
    ["Directed by", names(f.dir)],
    ["Created by", names(f.cre)],
    ["Written by", names(f.wri)],
    ["Cast", names(f.cast)],
    ["Music", names(f.mus)],
    ["Awards", (f.aw ?? []).slice(0, 6).join(", ")],
    ["Nominated for", (f.nom ?? []).slice(0, 4).join(", ")],
    ["Based on", (f.src ?? []).join(", ")],
    ["Influenced by", (f.inf ?? []).join(", ")],
    ["Set in", (f.loc ?? []).join(", ")],
    ["Community rating", (() => { const cr = crowdRating(f); return cr ? `${cr.v.toFixed(1)}/10 (${cr.n.toLocaleString()} votes, ${cr.src})` : ""; })()],
  ];
  const watch = watchOptions(f, platforms);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">{(f.g ?? []).map((g) => <span key={g} className="chip">{T(g)}</span>)}</div>
      {filmOverview(f) && <p className="max-w-3xl leading-relaxed text-ink/90">{filmOverview(f)}</p>}
      <div>
        <p className="mb-1.5 text-xs uppercase tracking-wider text-muted">{T("Where to watch (legal, France)")}</p>
        <div className="flex flex-wrap gap-1.5">
          {watch.map((w) => (
            <a key={w.label} href={w.url} target="_blank" rel="noreferrer"
               className={`chip text-xs ${w.kind === "mine" ? "border-like text-like" : w.kind === "free" ? "border-accent text-accent" : ""}`}>
              {w.kind === "mine" ? "▶ " : w.kind === "free" ? T("Free · ") : ""}{w.label} ↗
            </a>
          ))}
        </div>
      </div>
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        {facts.filter(([, v]) => v).map(([k, v]) => (
          <div key={k}><dt className="text-xs text-muted">{k}</dt><dd className="line-clamp-3">{v}</dd></div>
        ))}
      </dl>
      {f.kw?.length ? <p className="text-xs leading-relaxed text-muted">{f.kw.slice(0, 20).join(" · ")}</p> : null}
      <Links links={f.links} />
      <Explore e={d.entities[row]} />
    </div>
  );
}

function ItemFacts({ e }: { e: import("@/lib/types").Entity }) {
  const T = useT();
  const it = e.item!;
  const meta = it.meta ?? {};
  return (
    <div className="space-y-4">
      {typeof meta.embed === "string" && (
        <div className="aspect-video overflow-hidden rounded-2xl border border-line">
          <iframe className="h-full w-full" src={`https://www.youtube-nocookie.com/embed/${meta.embed}`} title={e.title}
                  allow="accelerometer; encrypted-media; picture-in-picture" allowFullScreen />
        </div>
      )}
      <div className="flex flex-wrap gap-1.5">{(it.tags ?? []).slice(0, 8).map((t) => <span key={t} className="chip">{t}</span>)}</div>
      {itemDescription(meta) && <p className="text-ink/90">{itemDescription(meta)}</p>}
      {Array.isArray(meta.ingredients) && <RecipeView e={e} />}
      {it.date && <p className="text-xs text-muted">{new Date(it.date).toLocaleDateString("fr-FR")}</p>}
      <div className="flex flex-wrap gap-1.5">
        {it.url && <a href={it.url} target="_blank" rel="noreferrer" className="btn px-3 py-1.5 text-sm">{T("Open ↗")}</a>}
        <Links links={it.links} />
      </div>
      <Explore e={e} />
    </div>
  );
}

function Explore({ e }: { e: Entity }) {
  const T = useT();
  const links = exploreLinks(e);
  if (!Object.keys(links).length) return null;
  return (
    <div>
      <p className="mb-1.5 text-[11px] uppercase tracking-[0.18em] text-muted">{T("Go further")}</p>
      <div className="flex flex-wrap gap-1.5">
        {Object.entries(links).map(([k, v]) => <a key={k} href={v} target="_blank" rel="noreferrer" className="chip text-xs hover:text-ink">{k} ↗</a>)}
      </div>
    </div>
  );
}

function Saga({ d, row }: { d: FilmData; row: number }) {
  const T = useT();
  const f = d.films[row];
  const feedback = useStore((s) => s.feedback);
  if (!f.coll) return null;
  const c = d.collectionOf.get(f.coll);
  if (!c) return null;
  const seenN = c.items.filter((id) => isDone(feedback[`films:${id}`]?.action)).length;
  return (
    <section className="card p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="font-display text-2xl">{c.name}</h2>
        <span className="text-xs text-muted">{seenN} / {c.items.length} {T("seen")}</span>
      </div>
      <Progress value={seenN / c.items.length} />
      <ol className="no-scrollbar mt-4 flex gap-3 overflow-x-auto">
        {c.items.map((id, i) => {
          const r = d.index.get(`films:${id}`)!;
          const x = d.entities[r];
          const a = feedback[x.key]?.action;
          const seen = isDone(a);
          return (
            <li key={id} className="w-28 shrink-0">
              <Link href={detailHref(x.key)} className={`block overflow-hidden rounded-xl border ${r === row ? "border-accent" : "border-line"} ${seen ? "" : "opacity-70"}`}>
                <EntityImage e={x} aspect="2/3" />
              </Link>
              <p className="mt-1 line-clamp-2 text-xs"><span className="text-muted">{i + 1}.</span> {x.title}</p>
              <p className="text-[11px] text-muted">{seen ? T("✓ seen") : x.film?.y}</p>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function SeriesTracker({ k, seasons }: { k: string; seasons: number }) {
  const T = useT();
  const p = useStore((s) => s.progress[k]);
  const season = p?.season ?? 1;
  const episode = p?.episode ?? 0;
  return (
    <div className="card flex flex-wrap items-center gap-3 p-4 text-sm">
      <span className="text-muted">{T("Where I am")}</span>
      <label className="flex items-center gap-1">S
        <input type="number" min={1} max={Math.max(seasons, 1)} value={season} onChange={(ev) => setProgress(k, +ev.target.value, episode)}
               className="w-14 rounded-lg border border-line bg-panel px-2 py-1" />
      </label>
      <label className="flex items-center gap-1">E
        <input type="number" min={0} value={episode} onChange={(ev) => setProgress(k, season, +ev.target.value)}
               className="w-16 rounded-lg border border-line bg-panel px-2 py-1" />
      </label>
      <button className="btn-ghost px-3 py-1 text-xs" onClick={() => setProgress(k, season, episode + 1)}>{T("+1 episode")}</button>
      {seasons > 0 && <Progress className="w-full" value={Math.min(1, (season - 1) / seasons)} label={`${season - 1} of ${seasons} seasons done`} />}
    </div>
  );
}

/** Questions worth asking real people about this, by space. */
function askFor(e: Entity, T: (s: string, v?: Record<string, string | number>) => string): string[] {
  const t = e.title;
  switch (e.domain) {
    case "films": return [T("Is {t} worth watching? (no spoilers)", { t }), T("What fans loved and hated about {t}", { t }), T("Films like {t} people recommend", { t })];
    case "places": return [T("Best hidden spots in {t} according to locals", { t }), T("Where locals eat in {t}", { t }), T("Tourist traps to avoid in {t}", { t })];
    case "brands": return [T("{t} sizing and quality: what buyers say", { t }), T("Is {t} worth the price?", { t })];
    case "cars": return [T("{t}: reliability and running costs from owners", { t }), T("What owners love and regret about the {t}", { t })];
    case "recipes": return [T("Tips to nail {t}", { t }), T("Best variations of {t}", { t })];
    case "music": return [T("Where to start with {t}", { t }), T("Best {t} live performances", { t })];
    default: return [T("What people think of {t}", { t })];
  }
}

function CompareButton({ k }: { k: string }) {
  const T = useT();
  const list = useCompare();
  const on = list.includes(k);
  return (
    <div className="flex items-center gap-2">
      <button className="chip text-xs" data-on={on} onClick={() => toggleCompare(k)} data-testid="compare-toggle">{on ? T("✓ In comparison") : T("+ Compare")}</button>
      {list.length > 0 && <Link className="text-xs text-accent hover:underline" href="/compare/">{T("Open comparison ({n})", { n: list.length })} →</Link>}
    </div>
  );
}
