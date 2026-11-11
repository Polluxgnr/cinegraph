"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import EntityImage from "@/components/EntityImage";
import RecCard, { detailHref, Progress, Row } from "@/components/RecCard";
import type { DomainData, FilmData } from "@/lib/data";
import { isFilmData } from "@/lib/data";
import { DOMAIN } from "@/lib/domains";
import { calibration } from "@/lib/engine/active";
import { buildProfile } from "@/lib/engine/profile";
import { runQuery, type QueryResult } from "@/lib/engine/query";
import { recommend } from "@/lib/engine/recommend";
import { useDomain, useSpace } from "@/lib/hooks";
import { getState, useLoaded, useStore } from "@/lib/store";
import { useRecs } from "@/lib/useRecs";

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
  const space = useSpace();
  const loaded = useLoaded();
  const { data: d } = useDomain(space);
  if (!loaded || !d) return <Skeleton />;
  return (
    <div key={space} className="rise space-y-10">
      <Hero space={space} d={d} />
      {isFilmData(d) && <ContinueRow films={d} />}
      <ForYou d={d} />
      <BecauseYouLiked d={d} />
      {space === "youtube" && <Fresh d={d} />}
      <Mine d={d} />
    </div>
  );
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
  const cfg = DOMAIN[space];
  const version = useStore((s) => s.updatedAt);
  const cal = useMemo(() => calibration(d, getState()), [d, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const hero = HERO[space] ?? { title: cfg.label, sub: "" };
  return (
    <section className="pt-1">
      <h1 className="font-display text-4xl leading-tight md:text-6xl">
        {hero.title}<span className="text-accent">?</span>
      </h1>
      <p className="mt-1 text-sm text-muted">{hero.sub}</p>
      {isFilmData(d) && <FilmSearch films={d} />}
      {cal < 1 && (
        <Link href="/swipe/" className="card mt-5 flex flex-wrap items-center gap-4 p-4 hover:border-accent">
          <div className="min-w-48 flex-1">
            <p className="font-semibold">{cal === 0 ? `Teach it your ${cfg.short.toLowerCase()} taste` : "Keep calibrating"}</p>
            <Progress className="mt-2" value={cal} />
          </div>
          <span className="btn">{cal === 0 ? "Start swiping" : "Swipe more"} →</span>
        </Link>
      )}
    </section>
  );
}

const EXAMPLES = ["like Fauda but funnier, under 2h", "a mind-bending film like Interstellar", "korean thriller series", "epic war film after 2000"];

function FilmSearch({ films }: { films: FilmData }) {
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
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="like Fauda but funnier, under 2h, on Netflix…"
               className="min-w-0 flex-1 rounded-xl border border-line bg-panel px-4 py-3 outline-none placeholder:text-muted/70 focus:border-accent" aria-label="Describe what you want to watch" />
        <button className="btn" disabled={busy}>{busy ? "…" : "Ask"}</button>
      </form>
      <div className="no-scrollbar mt-3 flex gap-2 overflow-x-auto">
        {EXAMPLES.map((ex) => <button key={ex} className="chip shrink-0 hover:text-ink" onClick={() => ask(ex)}>{ex}</button>)}
      </div>
      {res && (
        <section className="rise mt-6">
          <div className="mb-1 flex items-baseline gap-3">
            <h2 className="font-display text-3xl">“{q}”</h2>
            <button className="text-sm text-muted hover:text-ink" onClick={() => setRes(null)}>clear</button>
          </div>
          <p className="mb-3 text-xs text-muted">
            {res.anchors.length > 0 && <>anchored on {res.anchors.map((a) => a.title).join(", ")} · </>}
            understood by {res.parser === "ai" ? "Claude" : "rules (add an Anthropic key in Settings for smarter parsing)"}
          </p>
          {res.notes.map((n) => <p key={n} className="mb-2 text-xs text-accent">{n}</p>)}
          {res.items.length ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">{res.items.map((r) => <RecCard key={r.entity.key} r={r} />)}</div>
          ) : <p className="text-muted">Nothing fits all of that. Loosen one constraint.</p>}
        </section>
      )}
    </div>
  );
}

function ForYou({ d }: { d: DomainData }) {
  const recs = useRecs(d, { n: 15, explore: 0.15 }, d.name);
  if (!recs?.length) return null;
  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="font-display text-3xl">For you</h2>
        <Link href="/discover/" className="text-sm text-accent">Discover more →</Link>
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
  const recs = useRecs(d, { n: 12, explore: 0, filter: (e) => !!e.date && Date.now() - Date.parse(e.date) < 21 * 864e5 }, "fresh");
  if (!recs?.length) return null;
  return <Row title="New this week" hint="latest from the channels, ranked for you">{recs.map((r) => <RecCard key={r.entity.key} r={r} />)}</Row>;
}

function Mine({ d }: { d: DomainData }) {
  const custom = useStore((s) => s.custom.filter((c) => c.domain === d.name));
  if (d.name === "films") return null;
  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="font-display text-2xl">Added by you</h2>
        <Link href="/add/" className="btn-ghost px-3 py-1.5 text-sm">+ Add {DOMAIN[d.name]?.short.toLowerCase()}</Link>
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
        <p className="text-sm text-muted">Paste links to things you like (a brand site, a track, a recipe blog, a video): they join your taste profile.</p>
      )}
    </section>
  );
}

/** Series you're watching, sagas you started (next entry + progress bar). */
function ContinueRow({ films }: { films: FilmData }) {
  const lists = useStore((s) => s.lists);
  const feedback = useStore((s) => s.feedback);
  const progress = useStore((s) => s.progress);
  const watching = Object.values(lists).filter((l) => l.status === "watching" && l.domain === "films");
  const sagas = films.collections
    .map((c) => {
      const keys = c.items.map((id) => `films:${id}`);
      const seen = keys.filter((k) => ["loved", "liked", "ok", "disliked"].includes(feedback[k]?.action ?? ""));
      const next = keys.find((k) => !seen.includes(k) && feedback[k]?.action !== "never");
      return { c, seen: seen.length, total: keys.length, next };
    })
    .filter((x) => x.seen > 0 && x.next);
  if (!watching.length && !sagas.length) return null;
  return (
    <Row title="Continue" hint="what you're watching and sagas you started">
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
              <p className="text-xs text-muted">{p ? `S${p.season} · E${p.episode}` : "Watching"}</p>
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
              <p className="line-clamp-1 font-semibold">Next: {e.title}</p>
              <Progress className="mt-2" value={seen / total} />
              <p className="mt-1 text-[11px] text-muted">{seen} / {total} seen</p>
            </div>
          </Link>
        );
      })}
    </Row>
  );
}
