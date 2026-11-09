"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import EntityImage from "@/components/EntityImage";
import RecCard, { detailHref, Progress, Row } from "@/components/RecCard";
import { DOMAINS } from "@/lib/domains";
import { calibration } from "@/lib/engine/active";
import { runQuery, type QueryResult } from "@/lib/engine/query";
import type { FilmData } from "@/lib/data";
import { useDomain, useFilms, useManifest } from "@/lib/hooks";
import { getState, useLoaded, useStore } from "@/lib/store";
import { useRecs } from "@/lib/useRecs";

const EXAMPLES = ["like Fauda but funnier, under 2h", "a mind-bending film like Interstellar", "korean thriller series", "epic war film after 2000"];

export default function Home() {
  const films = useFilms().data;
  const m = useManifest().data;
  const loaded = useLoaded();
  const answers = useStore((s) => Object.keys(s.feedback).length);
  const [q, setQ] = useState("");
  const [res, setRes] = useState<QueryResult | null>(null);
  const [busy, setBusy] = useState(false);

  async function ask(text: string) {
    if (!films || !text.trim()) return;
    setQ(text);
    setBusy(true);
    try {
      setRes(await runQuery(films, getState(), text));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-10">
      <section className="pt-2">
        <h1 className="font-display text-4xl leading-tight md:text-6xl">
          What are we into tonight<span className="text-accent">?</span>
        </h1>
        <form className="mt-5 flex gap-2" onSubmit={(e) => { e.preventDefault(); ask(q); }}>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="like Fauda but funnier, under 2h, on Netflix…"
            className="min-w-0 flex-1 rounded-xl border border-line bg-panel px-4 py-3 outline-none placeholder:text-muted/70 focus:border-accent"
            aria-label="Describe what you want to watch"
          />
          <button className="btn" disabled={busy || !films}>{busy ? "…" : "Ask"}</button>
        </form>
        <div className="no-scrollbar mt-3 flex gap-2 overflow-x-auto">
          {EXAMPLES.map((ex) => <button key={ex} className="chip shrink-0 hover:text-ink" onClick={() => ask(ex)}>{ex}</button>)}
        </div>
      </section>

      {res && (
        <section>
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
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">{res.items.map((r) => <RecCard key={r.entity.key} r={r} />)}</div>
          ) : <p className="text-muted">Nothing fits all of that. Loosen one constraint.</p>}
        </section>
      )}

      {loaded && answers < 15 && (
        <Link href="/swipe/" className="card block overflow-hidden p-5 hover:border-accent">
          <p className="font-display text-3xl">Start here: teach it your taste</p>
          <p className="mt-1 text-sm text-muted">
            No data needed. Swipe a few dozen films and series (seen / not seen, then how it felt); every answer makes the
            next card and every recommendation sharper. Then do the same for music, food, travel…
          </p>
          <span className="btn mt-4">Start swiping →</span>
        </Link>
      )}

      {films && <ContinueRow films={films} />}
      {films && <DomainRow name="films" title="For you" hint="films & series, ranked by your model" />}
      {m && DOMAINS.filter((d) => d.name !== "films" && m.domains[d.name]?.count).map((d) => (
        <DomainRow key={d.name} name={d.name} title={`${d.emoji} ${d.label}`} />
      ))}
      {!films && <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="card aspect-[2/3] animate-pulse" />)}</div>}
    </div>
  );
}

function DomainRow({ name, title, hint }: { name: string; title: string; hint?: string }) {
  const d = useDomain(name).data;
  const recs = useRecs(d, { n: 12, explore: 0.15 }, name);
  const version = useStore((s) => s.updatedAt);
  const cal = useMemo(() => (d ? calibration(d, getState()) : 0), [d, version]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!recs?.length) return null;
  return (
    <div className="space-y-2">
      <Row title={title} href={`/discover/?d=${name}`} hint={hint}>
        {recs.map((r) => <RecCard key={r.entity.key} r={r} />)}
      </Row>
      {cal < 1 && (
        <Link href={`/swipe/?d=${name}`} className="block max-w-sm">
          <Progress value={cal} label={`Taste calibration · swipe ${name === "films" ? "films & series" : name} to improve`} />
        </Link>
      )}
    </div>
  );
}

/** Series you're watching, sagas you started (next entry + progress bar), and your list. */
function ContinueRow({ films }: { films: FilmData }) {
  const lists = useStore((s) => s.lists);
  const feedback = useStore((s) => s.feedback);
  const progress = useStore((s) => s.progress);
  const watching = Object.values(lists).filter((l) => l.status === "watching");
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
