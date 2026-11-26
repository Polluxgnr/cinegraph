"use client";

import PieceFromLink from "@/components/PieceFromLink";
import { useT } from "@/lib/i18n";

import { motion } from "motion/react";
import Link from "next/link";
import { useMemo, useState } from "react";
import EntityImage from "@/components/EntityImage";
import ExtraRow from "@/components/ExtraRow";
import FilmHero from "@/components/FilmHero";
import Welcome from "@/components/Welcome";
import TonightPanel from "@/components/TonightPanel";
import RecCard, { detailHref, Progress, Row } from "@/components/RecCard";
import type { DomainData, FilmData } from "@/lib/data";
import { isFilmData } from "@/lib/data";
import { DOMAIN } from "@/lib/domains";
import { calibration } from "@/lib/engine/active";
import { buildProfile } from "@/lib/engine/profile";
import { runQuery, type QueryResult } from "@/lib/engine/query";
import { type Rec, recommend } from "@/lib/engine/recommend";
import { useDomain, useSpace } from "@/lib/hooks";
import { getState, isDone, useLoaded, useStore } from "@/lib/store";
import { useRecs } from "@/lib/useRecs";
import { groupTest } from "@/lib/groups";
import { careerInCatalog, personHref, personIndex } from "@/lib/people";
import { Channels, SubscriptionsRow, VideoCategories } from "@/components/VideoHub";
import type { Entity } from "@/lib/types";

const HERO: Record<string, { title: string; sub: string }> = {
  films: { title: "What are we watching", sub: "Films & series picked for you, with the reason why." },
  youtube: { title: "What do we learn today", sub: "Documentaries, science, culture: free, from channels worth your time." },
  music: { title: "What do we listen to", sub: "Artists close to what you love, and a few to stretch your ears." },
  recipes: { title: "What do we cook", sub: "Dishes matched to your palate." },
  places: { title: "Where do we go next", sub: "Destinations shaped by where you loved being." },
  cars: { title: "What goes in the garage", sub: "Your dream garage: icons, supercars, classics. No Kangoo." },
  brands: { title: "What's your style", sub: "Design-led and independent labels, the pieces you want, your Pinterest and Instagram finds." },
};

export default function Home() {
  const T = useT();
  const space = useSpace();
  const loaded = useLoaded();
  const { data: d } = useDomain(space);
  if (!loaded || !d) return <Skeleton />;
  if (isFilmData(d)) return <FilmHome d={d} />;
  return (
    <div key={space} className="rise space-y-10">
      <Welcome />
      <SyncNudge />
      <Hero space={space} d={d} />
      <ConnectStrip space={space} />
      {space === "youtube" && <SubscriptionsRow d={d} />}
      {isFilmData(d) && <ContinueRow films={d} />}
      <ForYou d={d} />
      <BecauseYouLiked d={d} />
      {space === "youtube" && <Fresh d={d} />}
      {space === "youtube" && <VideoCategories d={d} />}
      {space === "youtube" && <Channels d={d} />}
      {space === "music" && <ExtraRow d={d} name="releases" title={T("New releases")} hint="out in the last weeks, artists you like first" />}
      {space === "brands" && <PieceFromLink d={d} />}
      {space === "brands" && <Catalogue d={d} />}
      <Mine d={d} />
    </div>
  );
}

/** Until sync is on, answers live in one browser only: say so once there is something to lose. */
function SyncNudge() {
  const T = useT();
  const synced = useStore((s) => !!s.settings.gistToken);
  const answers = useStore((s) => Object.keys(s.feedback).length);
  if (synced || answers < 5) return null;
  return (
    <Link href="/settings/" className="card flex items-center gap-3 border-nope/40 p-3 text-sm hover:border-accent">
      <span className="text-lg">☁️</span>
      <span className="flex-1"><b>{answers} {T("answers saved in this browser only.")}</b> <span className="text-muted">{T("Turn on sync to see them on your iPad and phone too.")}</span></span>
      <span className="text-accent">{T("Set up →")}</span>
    </Link>
  );
}

/** Videos and Music learn much faster from your accounts than from swipes: offer the connection in the space itself. */
function ConnectStrip({ space }: { space: string }) {
  const yt = useStore((s) => !!(s.imports["youtube-live"] || s.imports.youtube));
  const sp = useStore((s) => !!(s.spotify || s.imports.spotify));
  const c = space === "youtube" && !yt
    ? { icon: "▶", text: "Connect YouTube: your liked videos and subscriptions shape this space.", href: "/import/#connect-youtube", cta: "Connect" }
    : space === "music" && !sp
      ? { icon: "🎧", text: "Connect Spotify: your top artists, liked songs and playlists shape this space.", href: "/import/#connect-spotify", cta: "Connect" }
      : null;
  if (!c) return null;
  return (
    <Link href={c.href} className="card -mt-4 flex items-center gap-3 p-3 text-sm hover:border-accent">
      <span className="text-lg">{c.icon}</span>
      <span className="flex-1 text-muted">{c.text}</span>
      <span className="text-accent">{c.cta} →</span>
    </Link>
  );
}

/** Films & series: one big pick, then rows of posters (streaming-app layout). */
function FilmHome({ d }: { d: FilmData }) {
  const T = useT();
  const recs = useRecs(d, { n: 16, explore: 0.12 }, "films-home");
  const version = useStore((s) => s.updatedAt);
  const cal = useMemo(() => calibration(d, getState()), [d, version]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="space-y-10">
      {recs?.[0] ? <FilmHero r={recs[0]} label={T(cal < 0.3 ? "A good place to start" : "Tonight's pick for you")} /> : <div className="-mx-4 -mt-4 h-[62vh] animate-pulse bg-panel md:-mx-8" />}
      <Welcome />
      <SyncNudge />
      {cal < 1 && (
        <Link href="/swipe/" className="card flex flex-wrap items-center gap-4 p-4 hover:border-accent">
          <div className="min-w-48 flex-1">
            <p className="font-medium">{cal === 0 ? T("Teach it your taste: swipe 20 titles") : T("Keep swiping: picks get sharper")}</p>
            <Progress className="mt-2" value={cal} />
          </div>
          <span className="btn">{T("Swipe")}</span>
        </Link>
      )}
      <TonightPanel compact />
      <ContinueRow films={d} />
      {recs && recs.length > 1 && (
        <Row title={T("For you")} href="/discover/">{recs.slice(1).map((r) => <RecCard key={r.entity.key} r={r} showWhy={false} />)}</Row>
      )}
      <NewForYou d={d} />
      <FollowedRows d={d} />
      <BecauseYouLiked d={d} />
    </div>
  );
}

/** Out in the last four months, ranked for you. */
/**
 * New and upcoming: what came out in the last four months (best match first, with its date), and what is coming,
 * by month, with a countdown and a mark on what is already on your list.
 */
function NewForYou({ d }: { d: FilmData }) {
  const T = useT();
  const [tab, setTab] = useState<"out" | "soon">("out");
  const [kind, setKind] = useState<"any" | "movie" | "tv">("any");
  const lists = useStore((s) => s.lists);
  const [now] = useState(() => Date.now());
  const isNew = useMemo(() => groupTest(d, "new"), [d]);
  const kindOk = (e: Entity) => kind === "any" || e.film?.k === kind;
  const out = useRecs(d, { n: 24, explore: 0, includeListed: true, filter: (e) => !!e.film && isNew(e.film) && kindOk(e) }, `films-new|${kind}`);
  const soon = useRecs(d, { n: 120, explore: 0, includeListed: true, includeAnswered: true, noCaps: true, filter: (e) => !!e.film?.d && Date.parse(e.film.d) > now && kindOk(e) }, `films-soon|${kind}`);
  const byMonth = useMemo(() => {
    const g = new Map<string, Rec[]>();
    for (const r of [...(soon ?? [])].sort((x, y) => (x.entity.film!.d ?? "").localeCompare(y.entity.film!.d ?? ""))) {
      const k = r.entity.film!.d!.slice(0, 7);
      g.set(k, [...(g.get(k) ?? []), r]);
    }
    return [...g];
  }, [soon]);
  if (!out?.length && !soon?.length) return null;
  const when = (iso: string) => {
    const days = Math.round((Date.parse(iso) - now) / 864e5);
    return days <= 0 ? T("today") : days === 1 ? T("tomorrow") : days < 60 ? T("in {n} days", { n: days }) : new Date(iso).toLocaleDateString(T.lang, { day: "numeric", month: "short", year: "numeric" });
  };
  return (
    <section data-testid="releases">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex rounded-full border border-line bg-panel p-0.5 text-sm" role="tablist">
          {([["out", "Out now"], ["soon", "Coming soon"]] as const).map(([k, l]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                    className={`rounded-full px-4 py-1.5 font-display text-lg transition md:text-xl ${tab === k ? "bg-accent text-bg" : "text-muted hover:text-ink"}`}>
              {T(l)}{k === "soon" && soon?.length ? <span className="ml-1 text-xs opacity-70">{soon.length}</span> : null}
            </button>
          ))}
        </div>
        <div className="flex gap-1.5">
          {(["any", "movie", "tv"] as const).map((k) => <button key={k} className="chip text-xs" data-on={kind === k} onClick={() => setKind(k)}>{k === "any" ? T("Both") : k === "movie" ? T("Films") : T("Series")}</button>)}
        </div>
      </div>
      {tab === "out" && (
        out?.length ? (
          <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 pb-1">
            {out.map((r) => (
              <div key={r.entity.key} className="w-36 shrink-0 space-y-1 md:w-44">
                <RecCard r={r} showWhy={false} />
                <p className="px-1 text-[11px] text-muted">{T("Out")} {new Date(r.entity.film!.d!).toLocaleDateString(T.lang, { day: "numeric", month: "short" })}</p>
              </div>
            ))}
          </div>
        ) : <p className="text-sm text-muted">{T("Nothing new of this kind in the last four months.")}</p>
      )}
      {tab === "soon" && (
        byMonth.length ? (
          <div className="space-y-5">
            {byMonth.map(([m, rs]) => (
              <div key={m}>
                <p className="mb-2 text-[11px] uppercase tracking-[0.18em] text-muted">{new Date(`${m}-01T12:00:00`).toLocaleDateString(T.lang, { month: "long", year: "numeric" })} · {rs.length}</p>
                <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 pb-1">
                  {rs.map((r) => (
                    <div key={r.entity.key} className="w-36 shrink-0 space-y-1 md:w-44" data-testid="upcoming">
                      <RecCard r={r} showWhy={false} />
                      <p className="px-1 text-[11px] text-muted">
                        <b className="text-accent">{when(r.entity.film!.d!)}</b>{lists[r.entity.key] ? ` · ${T("on your list")}` : ""}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : <p className="text-sm text-muted">{T("No announced date of this kind yet.")}</p>
      )}
    </section>
  );
}

/** One row per actor or director you follow: their titles you haven't answered, best match first. */
function FollowedRows({ d }: { d: FilmData }) {
  const T = useT();
  const following = useStore((s) => s.settings.following ?? {});
  const names = Object.entries(following).filter(([, v]) => v === 1).map(([n]) => n).slice(0, 4);
  return <>{names.map((n) => <FollowedRow key={n} d={d} name={n} T={T} />)}</>;
}

function FollowedRow({ d, name, T }: { d: FilmData; name: string; T: ReturnType<typeof useT> }) {
  const idx = personIndex(d, name);
  const keys = useMemo(() => new Set(idx == null ? [] : careerInCatalog(d, idx).map((c) => d.entities[c.row].key)), [d, idx]);
  const recs = useRecs(d, { n: 14, explore: 0, includeListed: true, noCaps: true, filter: (e) => keys.has(e.key) }, `follow|${name}`);
  if (idx == null || !recs?.length) return null;
  return <Row title={T("Because you follow {name}", { name })} href={personHref(idx, name)}>{recs.map((r) => <RecCard key={r.entity.key} r={r} showWhy={false} />)}</Row>;
}

function Skeleton() {
  return (
    <div className="space-y-6">
      <div className="h-14 w-2/3 animate-pulse rounded-xl bg-panel" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">{Array.from({ length: 10 }).map((_, i) => <div key={i} className="card aspect-[2/3] animate-pulse" />)}</div>
    </div>
  );
}

function Hero({ space, d }: { space: string; d: DomainData }) {
  const T = useT();
  const cfg = DOMAIN[space];
  const version = useStore((s) => s.updatedAt);
  const cal = useMemo(() => calibration(d, getState()), [d, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const hero = HERO[space] ?? { title: cfg.label, sub: "" };
  return (
    <section className="pt-1">
      <h1 className="font-display text-4xl leading-tight md:text-6xl" aria-label={`${T(hero.title)}?`}>
        {T(hero.title).split(" ").map((w, i) => (
          <motion.span key={`${w}${i}`} className="mr-[0.25em] inline-block" initial={{ opacity: 0, y: 18, filter: "blur(6px)" }}
                       animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} transition={{ delay: i * 0.07, duration: 0.5, ease: [0.2, 0.7, 0.2, 1] }}>
            {w}
          </motion.span>
        ))}
        <motion.span className="inline-block text-accent" initial={{ opacity: 0, rotate: -20 }} animate={{ opacity: 1, rotate: 0 }} transition={{ delay: 0.35, type: "spring" }}>?</motion.span>
      </h1>
      <p className="mt-1 text-sm text-muted">{T(hero.sub)}</p>
      {isFilmData(d) && <FilmSearch films={d} />}
      {cal < 1 && (
        <Link href="/swipe/" className="card mt-5 flex flex-wrap items-center gap-4 p-4 hover:border-accent">
          <div className="min-w-48 flex-1">
            <p className="font-semibold">{cal === 0 ? `Teach it your ${cfg.short.toLowerCase()} taste` : T("Keep calibrating")}</p>
            <Progress className="mt-2" value={cal} />
          </div>
          <span className="btn">{cal === 0 ? T("Start swiping") : T("Swipe more")} →</span>
        </Link>
      )}
    </section>
  );
}

const EXAMPLES = ["like Fauda but funnier, under 2h", "a mind-bending film like Interstellar", "korean thriller series", "epic war film after 2000"];

function FilmSearch({ films }: { films: FilmData }) {
  const T = useT();
  const [q, setQ] = useState("");
  const [res, setRes] = useState<QueryResult | null>(null);
  const [busy, setBusy] = useState(false);
  async function ask(text: string) {
    if (!text.trim()) return;
    setQ(text);
    setBusy(true);
    try {
      setRes(await runQuery(films, getState(), text));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mt-5">
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); ask(q); }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={T("like Fauda but funnier, under 2h, on Netflix…")}
               className="min-w-0 flex-1 rounded-xl border border-line bg-panel px-4 py-3 outline-none placeholder:text-muted/70 focus:border-accent" aria-label={T("Describe what you want to watch")} />
        <button className="btn" disabled={busy}>{busy ? "…" : T("Ask")}</button>
      </form>
      <div className="no-scrollbar mt-3 flex gap-2 overflow-x-auto">
        {EXAMPLES.map((ex) => <button key={ex} className="chip shrink-0 hover:text-ink" onClick={() => ask(ex)}>{ex}</button>)}
      </div>
      {res && (
        <section className="rise mt-6">
          <div className="mb-1 flex items-baseline gap-3">
            <h2 className="font-display text-3xl">“{q}”</h2>
            <button className="text-sm text-muted hover:text-ink" onClick={() => setRes(null)}>{T("clear")}</button>
          </div>
          <p className="mb-3 text-xs text-muted">
            {res.anchors.length > 0 && <>{T("anchored on")}{" "}{res.anchors.map((a) => a.title).join(", ")} · </>}
            {T("understood by")}{" "}{res.parser === "ai" ? T("Claude") : T("rules (add an Anthropic key in Settings for smarter parsing)")}
          </p>
          {res.notes.map((n) => <p key={n} className="mb-2 text-xs text-accent">{n}</p>)}
          {res.items.length ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">{res.items.map((r) => <RecCard key={r.entity.key} r={r} />)}</div>
          ) : <p className="text-muted">{T("Nothing fits all of that. Loosen one constraint.")}</p>}
        </section>
      )}
    </div>
  );
}

function ForYou({ d }: { d: DomainData }) {
  const T = useT();
  const recs = useRecs(d, { n: 15, explore: 0.15 }, d.name);
  if (!recs?.length) return null;
  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="font-display text-3xl">{T("For you")}</h2>
        <Link href="/discover/" className="text-sm text-accent">{T("Discover more →")}</Link>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">{recs.map((r) => <RecCard key={r.entity.key} r={r} />)}</div>
    </section>
  );
}

/** One row per thing you loved most recently: "Because you loved X". */
function BecauseYouLiked({ d }: { d: DomainData }) {
  const version = useStore((s) => s.updatedAt);
  const rows = useMemo(() => {
    if (!d.emb) return [];
    const s = getState();
    const p = buildProfile(d, s);
    const top = [...p.pos].sort((a, b) => (s.feedback[b.key]?.at ?? 0) - (s.feedback[a.key]?.at ?? 0)).slice(0, 3);
    return top.map((a) => {
      const v = d.emb!.row(a.row);
      const sims: [number, number][] = [];
      for (let i = 0; i < d.entities.length; i++) if (i !== a.row) sims.push([i, d.emb!.dot(i, v) / d.norms[i]]);
      sims.sort((x, y) => y[1] - x[1]);
      const near = new Set(sims.slice(0, 40).map(([i]) => d.entities[i].key));
      return { anchor: a, recs: recommend(d, s, { n: 10, explore: 0, filter: (e) => near.has(e.key) }) };
    });
  }, [d, version]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      {rows.filter((r) => r.recs.length).map(({ anchor, recs }) => (
        <Row key={anchor.key} title={`Because you ${verb(anchor.label)} ${anchor.title}`}>
          {recs.map((r) => <RecCard key={r.entity.key} r={r} showWhy={false} />)}
        </Row>
      ))}
    </>
  );
}

/** "which you loved" -> "loved", "on your list" -> "saved", "which you rated 4.5" -> "rated 4.5 →" */
function verb(label: string): string {
  if (label.startsWith("which you rated")) return `rated ${label.split(" ").pop()} ·`;
  if (label === "on your list") return "saved";
  if (label.startsWith("which you might")) return "might like";
  return label.replace(/^which you /, "").replace(/ on Letterboxd$/, "");
}

function Fresh({ d }: { d: DomainData }) {
  const T = useT();
  const recs = useRecs(d, { n: 12, explore: 0, filter: (e) => !!e.date && Date.now() - Date.parse(e.date) < 21 * 864e5 }, "fresh");
  if (!recs?.length) return null;
  return <Row title={T("New this week")} hint="latest from the channels, ranked for you">{recs.map((r) => <RecCard key={r.entity.key} r={r} />)}</Row>;
}

/**
 * Style: no open source lists a brand's whole range (Nike makes thousands of shoes), so the full catalogue is on each
 * brand's own site: every brand here with its website, best match first, searchable and by style; then the iconic
 * pieces that do have a real photo.
 */
function Catalogue({ d }: { d: DomainData }) {
  const T = useT();
  const [q, setQ] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const recs = useRecs(d, { n: 600, explore: 0, includeListed: true, includeAnswered: true, noCaps: true, diversity: 1, filter: (e) => e.item?.meta?.kind === "brand" }, "brand-directory");
  const tags = useMemo(() => {
    const c = new Map<string, number>();
    for (const r of recs ?? []) for (const t of r.entity.tags.slice(0, 2)) if (t && t !== "label") c.set(t, (c.get(t) ?? 0) + 1);
    return [...c].filter(([, n]) => n >= 3).sort((x, y) => y[1] - x[1]).slice(0, 16).map(([t]) => t);
  }, [recs]);
  const photos = useRecs(d, { n: 24, explore: 0, includeListed: true, noCaps: true, filter: (e) => e.tags.includes("piece") && !!(e.item?.meta?.photo || e.item?.meta?.from_shop) }, "photo-pieces");
  if (!recs?.length) return null;
  const n = q.trim().toLowerCase();
  const list = recs.filter((r) => (!n || `${r.entity.title} ${r.entity.subtitle} ${r.entity.tags.join(" ")}`.toLowerCase().includes(n)) && (!tag || r.entity.tags.includes(tag)));
  const shown = all || n ? list : list.slice(0, 24);
  return (
    <>
      {photos && photos.length > 0 && (
        <Row title={T("Iconic pieces")} hint={T("with a real photo · the full ranges are on the brands' sites below")}>
          {photos.map((r) => <RecCard key={r.entity.key} r={r} showWhy={false} />)}
        </Row>
      )}
      <section data-testid="catalogue">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-3xl">{T("Brands and their shops")}</h2>
          <span className="text-xs text-muted">{list.length} {T("brands")}</span>
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} type="search" placeholder={T("Find a brand: Nike, Our Legacy, Arc'teryx…")}
               className="mb-2 w-full rounded-xl border border-line bg-panel px-4 py-2.5 text-sm outline-none focus:border-accent" />
        <div className="no-scrollbar -mx-4 mb-3 flex gap-1.5 overflow-x-auto px-4">
          <button className="chip shrink-0 text-xs" data-on={!tag} onClick={() => setTag(null)}>{T("All")}</button>
          {tags.map((t) => <button key={t} className="chip shrink-0 text-xs" data-on={tag === t} onClick={() => setTag(tag === t ? null : t)}>{T(t)}</button>)}
        </div>
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map(({ entity: e, p }) => {
            const site = e.item?.url && !/wikidata\.org/.test(e.item.url) ? e.item.url : undefined;
            let host = "";
            try { host = site ? new URL(site).host.replace(/^www\./, "") : ""; } catch { /* not a URL */ }
            return (
              <li key={e.key} className="card flex min-w-0 items-center gap-3 p-2.5" data-testid="brand-row">
                <Link href={detailHref(e.key)} className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-panel-2"><EntityImage e={e} aspect="1/1" /></Link>
                <span className="min-w-0 flex-1">
                  <Link href={detailHref(e.key)} className="block truncate font-medium hover:text-accent">{e.title}</Link>
                  <span className="block truncate text-[11px] text-muted">{e.subtitle} · {Math.round(p * 100)}% {T("for you")}</span>
                </span>
                {site ? <a href={site} target="_blank" rel="noreferrer" className="btn-ghost shrink-0 px-3 py-1 text-xs" title={host}>{T("Shop")} ↗</a>
                  : <a href={`https://www.google.com/search?q=${encodeURIComponent(`${e.title} official site`)}`} target="_blank" rel="noreferrer" className="shrink-0 px-2 text-xs text-muted hover:text-ink">{T("Find site")} ↗</a>}
              </li>
            );
          })}
        </ul>
        {!all && !n && list.length > shown.length && <button className="btn-ghost mt-4 w-full" onClick={() => setAll(true)}>{T("Show all {n}", { n: list.length })}</button>}
      </section>
    </>
  );
}


function Mine({ d }: { d: DomainData }) {
  const T = useT();
  const custom = useStore((s) => s.custom.filter((c) => c.domain === d.name));
  if (d.name === "films") return null;
  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="font-display text-2xl">{T("Added by you")}</h2>
        <Link href="/add/" className="btn-ghost px-3 py-1.5 text-sm">{T("+ Add")}{" "}{DOMAIN[d.name]?.short.toLowerCase()}</Link>
      </div>
      {custom.length ? (
        <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4">
          {custom.slice(-20).reverse().map((c) => {
            const row = d.index.get(c.id);
            const e = row != null ? d.entities[row] : null;
            return e ? (
              <Link key={c.id} href={detailHref(c.id)} className="card w-40 shrink-0 overflow-hidden">
                <EntityImage e={e} aspect="4/3" />
                <p className="line-clamp-2 p-2 text-sm">{c.title}</p>
              </Link>
            ) : null;
          })}
        </div>
      ) : (
        <p className="text-sm text-muted">{T("Paste links to things you like (a brand site, a track, a recipe blog, a video): they join your taste profile.")}</p>
      )}
    </section>
  );
}

/** Series you're watching, sagas you started (next entry + progress bar). */
function ContinueRow({ films }: { films: FilmData }) {
  const T = useT();
  const lists = useStore((s) => s.lists);
  const feedback = useStore((s) => s.feedback);
  const progress = useStore((s) => s.progress);
  const watching = Object.values(lists).filter((l) => l.status === "watching" && l.domain === "films");
  const sagas = films.collections
    .map((c) => {
      const keys = c.items.map((id) => `films:${id}`);
      const seen = keys.filter((k) => isDone(feedback[k]?.action));
      const next = keys.find((k) => !seen.includes(k) && feedback[k]?.action !== "never");
      return { c, seen: seen.length, total: keys.length, next };
    })
    .filter((x) => x.seen > 0 && x.next);
  if (!watching.length && !sagas.length) return null;
  return (
    <Row title={T("Continue")} hint="what you're watching and sagas you started">
      {watching.map((w) => {
        const row = films.index.get(w.key);
        if (row == null) return null;
        const e = films.entities[row];
        const p = progress[w.key];
        const total = e.film?.ns ?? 0;
        return (
          <Link key={w.key} href={detailHref(w.key)} className="card overflow-hidden">
            <EntityImage e={e} aspect="2/3" />
            <div className="p-3">
              <p className="line-clamp-1 font-semibold">{e.title}</p>
              <p className="text-xs text-muted">{p ? `S${p.season} · E${p.episode}` : T("Watching")}</p>
              {total > 0 && <Progress className="mt-2" value={Math.min(1, ((p?.season ?? 1) - 1) / total)} />}
            </div>
          </Link>
        );
      })}
      {sagas.map(({ c, seen, total, next }) => {
        const e = films.entities[films.index.get(next!)!];
        return (
          <Link key={c.key} href={detailHref(next!)} className="card overflow-hidden">
            <EntityImage e={e} aspect="2/3" />
            <div className="p-3">
              <p className="line-clamp-1 text-xs uppercase tracking-wider text-accent">{c.name}</p>
              <p className="line-clamp-1 font-semibold">{T("Next:")}{" "}{e.title}</p>
              <Progress className="mt-2" value={seen / total} />
              <p className="mt-1 text-[11px] text-muted">{seen} / {total} {T("seen")}</p>
            </div>
          </Link>
        );
      })}
    </Row>
  );
}
