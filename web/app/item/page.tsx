"use client";

import Link from "next/link";
import { useMemo } from "react";
import AnswerPanel from "@/components/AnswerPanel";
import EntityImage from "@/components/EntityImage";
import Match from "@/components/Match";
import RecCard, { detailHref, Progress, Row } from "@/components/RecCard";
import Stars from "@/components/Stars";
import type { DomainData, FilmData } from "@/lib/data";
import { actionLabel, DOMAIN } from "@/lib/domains";
import { answer } from "@/lib/engine/learn";
import { recommend, scoreOne } from "@/lib/engine/recommend";
import { useDomain, useQueryParam } from "@/lib/hooks";
import { addVault, getState, setList, setProgress, useLoaded, useStore } from "@/lib/store";
import { fmtRuntime, LANG_NAMES } from "@/lib/text";
import { watchOptions } from "@/lib/watch";

const LINK_LABEL: Record<string, string> = {
  senscritique: "SensCritique", allocine: "AlloCiné", letterboxd: "Letterboxd", imdb: "IMDb", wikipedia: "Wikipedia",
  tmdb: "TMDB", wikidata: "Wikidata", justwatch: "JustWatch", marmiton: "Marmiton", video: "Video", wikivoyage: "Wikivoyage",
  maps: "Map", pinterest: "Pinterest", spotify: "Spotify", youtube: "YouTube",
};

export default function ItemPage() {
  const [k] = useQueryParam("k");
  const domain = k?.split(":")[0] ?? "films";
  const { data: d } = useDomain(domain);
  if (!k) return null;
  if (!d) return <div className="card h-96 animate-pulse" />;
  const row = d.index.get(k);
  if (row == null) return <p className="card p-4">Not found in the catalogue.</p>;
  return <Detail d={d} row={row} />;
}

function Detail({ d, row }: { d: DomainData; row: number }) {
  const e = d.entities[row];
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

  const f = e.film;
  const backdrop = f?.bd;
  return (
    <div className="space-y-10">
      {backdrop && (
        <div className="pointer-events-none fixed inset-x-0 top-0 h-[55vh] bg-cover bg-center opacity-25"
             style={{ backgroundImage: `url(${backdrop})`, maskImage: "linear-gradient(black, transparent)" }} />
      )}
      <div className="relative grid gap-6 md:grid-cols-[280px_1fr]">
        <div className="mx-auto w-52 self-start overflow-hidden rounded-2xl border border-line md:w-full">
          <EntityImage e={e} aspect={cfg?.aspect ?? "2/3"} big />
        </div>
        <div className="space-y-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-muted">{cfg?.emoji} {cfg?.label}</p>
            <h1 className="font-display text-4xl leading-tight md:text-6xl">{e.title}</h1>
            {f?.ot && <p className="text-muted">{f.ot}</p>}
            {!f && e.subtitle && <p className="text-muted">{e.subtitle}</p>}
          </div>
          {rec && (
            <div className="space-y-1">
              <Match p={rec.p} stars={rec.stars} />
              <p className="text-sm text-ink/85">{rec.why}</p>
            </div>
          )}
          {f ? <FilmFacts d={d as FilmData} row={row} /> : <ItemFacts e={e} />}

          <div className="card space-y-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-muted">{fb ? `Your answer: ${actionLabel(e.domain, fb.action)}${fb.chips?.length ? ` (${fb.chips.join(", ")})` : ""}` : "What do you think?"}</p>
              <div className="flex gap-2">
                <button className="btn-ghost px-3 py-1.5 text-xs" onClick={() => setList(e.key, e.domain, listed ? null : "want")}>{listed ? "✓ On my list" : "+ My list"}</button>
                <button className="btn-ghost px-3 py-1.5 text-xs" onClick={() => addVault({ title: e.title, url: e.item?.url ?? f?.links?.wikipedia, tags: [e.domain, ...e.tags.slice(0, 3)], domain: e.domain, image: e.image })}>Save to vault</button>
              </div>
            </div>
            <AnswerPanel e={e} onAnswer={(a, extra) => answer(e.key, e.domain, a, { ...extra, source: "detail" })} compact />
            {f && (
              <div className="flex items-center gap-3 border-t border-line pt-3">
                <span className="text-xs text-muted">Rate it</span>
                <Stars value={fb?.rating ?? null} size={24} onChange={(v) => answer(e.key, e.domain, v >= 4.5 ? "loved" : v >= 3.5 ? "liked" : v >= 2.5 ? "ok" : "disliked", { rating: v, source: "detail" })} />
              </div>
            )}
          </div>
          {f?.k === "tv" && <SeriesTracker k={e.key} seasons={f.ns ?? 0} />}
        </div>
      </div>
      {f && <Saga d={d as FilmData} row={row} />}
      {similar.length > 0 && <Row title="Similar">{similar.map((r) => <RecCard key={r.entity.key} r={r} />)}</Row>}
    </div>
  );
}

function Links({ links }: { links?: Record<string, string> }) {
  if (!links) return null;
  const order = ["senscritique", "allocine", "letterboxd", "imdb", "justwatch", "wikipedia", "tmdb"];
  const entries = Object.entries(links).sort((a, b) => (order.indexOf(a[0]) + 99) % 99 - (order.indexOf(b[0]) + 99) % 99);
  return (
    <div className="flex flex-wrap gap-1.5">
      {entries.map(([k, v]) => (
        <a key={k} href={v} target="_blank" rel="noreferrer" className="chip text-xs hover:text-ink">{LINK_LABEL[k] ?? k} ↗</a>
      ))}
    </div>
  );
}

function FilmFacts({ d, row }: { d: FilmData; row: number }) {
  const f = d.films[row];
  const platforms = useStore((s) => s.settings.platforms);
  const names = (ids?: number[]) => (ids ?? []).map((i) => d.people[i]).join(", ");
  const facts: [string, string][] = [
    ["Released", f.d ? new Date(f.d).toLocaleDateString("fr-FR", { year: "numeric", month: "long", day: "numeric" }) : String(f.y ?? "")],
    ["Length", f.k === "tv" ? [f.ns ? `${f.ns} seasons` : "", f.ne ? `${f.ne} episodes` : "", f.rt ? `${f.rt} min/ep` : ""].filter(Boolean).join(" · ") : fmtRuntime(f.rt)],
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
    ["Community rating", f.va ? `${f.va.toFixed(1)}/10 (${f.vc} votes, TMDB)` : ""],
  ];
  const watch = watchOptions(f, platforms);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">{(f.g ?? []).map((g) => <span key={g} className="chip">{g}</span>)}</div>
      {f.ov && <p className="max-w-3xl leading-relaxed text-ink/90">{f.ov}</p>}
      <div>
        <p className="mb-1.5 text-xs uppercase tracking-wider text-muted">Where to watch (legal, France)</p>
        <div className="flex flex-wrap gap-1.5">
          {watch.map((w) => (
            <a key={w.label} href={w.url} target="_blank" rel="noreferrer"
               className={`chip text-xs ${w.kind === "mine" ? "border-like text-like" : w.kind === "free" ? "border-accent text-accent" : ""}`}>
              {w.kind === "mine" ? "▶ " : w.kind === "free" ? "Free · " : ""}{w.label} ↗
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
    </div>
  );
}

function ItemFacts({ e }: { e: import("@/lib/types").Entity }) {
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
      {typeof meta.description === "string" && <p className="text-ink/90">{meta.description}</p>}
      {Array.isArray(meta.ingredients) && (
        <div className="grid gap-4 md:grid-cols-[220px_1fr]">
          <ul className="space-y-1 text-sm">{(meta.ingredients as string[]).map((x) => <li key={x}>• {x}</li>)}</ul>
          <p className="whitespace-pre-line text-sm leading-relaxed text-ink/85">{String(meta.instructions ?? "")}</p>
        </div>
      )}
      {it.date && <p className="text-xs text-muted">{new Date(it.date).toLocaleDateString("fr-FR")}</p>}
      <div className="flex flex-wrap gap-1.5">
        {it.url && <a href={it.url} target="_blank" rel="noreferrer" className="btn px-3 py-1.5 text-sm">Open ↗</a>}
        <Links links={it.links} />
      </div>
    </div>
  );
}

function Saga({ d, row }: { d: FilmData; row: number }) {
  const f = d.films[row];
  const feedback = useStore((s) => s.feedback);
  if (!f.coll) return null;
  const c = d.collectionOf.get(f.coll);
  if (!c) return null;
  const seenN = c.items.filter((id) => ["loved", "liked", "ok", "disliked"].includes(feedback[`films:${id}`]?.action ?? "")).length;
  return (
    <section className="card p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="font-display text-2xl">{c.name}</h2>
        <span className="text-xs text-muted">{seenN} / {c.items.length} seen</span>
      </div>
      <Progress value={seenN / c.items.length} />
      <ol className="no-scrollbar mt-4 flex gap-3 overflow-x-auto">
        {c.items.map((id, i) => {
          const r = d.index.get(`films:${id}`)!;
          const x = d.entities[r];
          const a = feedback[x.key]?.action;
          const seen = ["loved", "liked", "ok", "disliked"].includes(a ?? "");
          return (
            <li key={id} className="w-28 shrink-0">
              <Link href={detailHref(x.key)} className={`block overflow-hidden rounded-xl border ${r === row ? "border-accent" : "border-line"} ${seen ? "" : "opacity-70"}`}>
                <EntityImage e={x} aspect="2/3" />
              </Link>
              <p className="mt-1 line-clamp-2 text-xs"><span className="text-muted">{i + 1}.</span> {x.title}</p>
              <p className="text-[11px] text-muted">{seen ? "✓ seen" : x.film?.y}</p>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function SeriesTracker({ k, seasons }: { k: string; seasons: number }) {
  const p = useStore((s) => s.progress[k]);
  const season = p?.season ?? 1;
  const episode = p?.episode ?? 0;
  return (
    <div className="card flex flex-wrap items-center gap-3 p-4 text-sm">
      <span className="text-muted">Where I am</span>
      <label className="flex items-center gap-1">S
        <input type="number" min={1} max={Math.max(seasons, 1)} value={season} onChange={(ev) => setProgress(k, +ev.target.value, episode)}
               className="w-14 rounded-lg border border-line bg-panel px-2 py-1" />
      </label>
      <label className="flex items-center gap-1">E
        <input type="number" min={0} value={episode} onChange={(ev) => setProgress(k, season, +ev.target.value)}
               className="w-16 rounded-lg border border-line bg-panel px-2 py-1" />
      </label>
      <button className="btn-ghost px-3 py-1 text-xs" onClick={() => setProgress(k, season, episode + 1)}>+1 episode</button>
      {seasons > 0 && <Progress className="w-full" value={Math.min(1, (season - 1) / seasons)} label={`${season - 1} of ${seasons} seasons done`} />}
    </div>
  );
}
