"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { aiEnabled, tastePortrait } from "@/lib/ai";
import { type DomainData, loadDomain } from "@/lib/data";
import { DOMAIN, DOMAINS } from "@/lib/domains";
import { summarise, summaryText, type TasteSummary } from "@/lib/engine/summary";
import { useManifest } from "@/lib/hooks";
import { getState, useLoaded, useStore } from "@/lib/store";

/** "Understand my tastes": per-domain portrait, taste axes, what the model learned, accuracy. */
export default function Me() {
  const m = useManifest().data;
  const loaded = useLoaded();
  const version = useStore((s) => s.updatedAt);
  const spotify = useStore((s) => s.spotify);
  const [data, setData] = useState<DomainData[]>([]);
  const [portrait, setPortrait] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!m) return;
    Promise.all(Object.keys(m.domains).map((d) => loadDomain(d).catch(() => null))).then((x) => setData(x.filter((d): d is DomainData => !!d)));
  }, [m]);

  const sums = useMemo(
    () => (loaded ? data.map((d) => summarise(d, getState())).filter((s) => s.answers > 0) : []),
    [data, loaded, version], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const total = sums.reduce((a, s) => a + s.answers, 0);

  async function writePortrait() {
    setBusy(true);
    try {
      const facts = sums.map((s) => `${DOMAIN[s.domain]?.label}: ${summaryText(s)} Loved ${s.loved}. Liked tags: ${s.likedTags.map(([t]) => t).join(", ")}. Disliked: ${s.dislikedTags.map(([t]) => t).join(", ")}.`).join("\n");
      const music = spotify ? `\nSpotify top artists: ${spotify.topArtists.slice(0, 20).map((a) => a.name).join(", ")}` : "";
      setPortrait((await tastePortrait(facts + music)) ?? "No answer from the model.");
    } catch (e) {
      setPortrait(`Error: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-display text-4xl md:text-6xl">My taste</h1>
        <p className="text-sm text-muted">{total} answers so far across {sums.length} areas. Everything here updates with each answer.</p>
      </header>

      <section className="card space-y-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-2xl">Portrait</h2>
          {aiEnabled() ? (
            <button className="btn px-3 py-1.5 text-sm" onClick={writePortrait} disabled={busy || !total}>{busy ? "Writing…" : "Write my portrait with Claude"}</button>
          ) : (
            <Link href="/settings/" className="text-xs text-muted hover:text-ink">Add an Anthropic key for a written portrait →</Link>
          )}
        </div>
        <p className="whitespace-pre-line leading-relaxed text-ink/90">
          {portrait ?? (sums.length ? sums.map((s) => `${DOMAIN[s.domain]?.emoji} ${summaryText(s)}`).join("\n\n") : "Swipe a few cards in any area and your portrait starts here.")}
        </p>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        {sums.map((s) => <DomainCard key={s.domain} s={s} />)}
      </div>

      {spotify && (
        <section className="card p-5">
          <h2 className="font-display text-2xl">🎧 From Spotify</h2>
          <p className="mb-3 text-xs text-muted">Imported {new Date(spotify.connectedAt).toLocaleDateString("fr-FR")}</p>
          <div className="flex flex-wrap gap-1.5">{spotify.topArtists.slice(0, 30).map((a) => <a key={a.name} href={a.url} target="_blank" rel="noreferrer" className="chip text-xs">{a.name}</a>)}</div>
          <h3 className="mt-4 text-sm text-muted">Playlists</h3>
          <ul className="mt-1 grid gap-1 text-sm sm:grid-cols-2">{spotify.playlists.map((p) => <li key={p.name}><a href={p.url} target="_blank" rel="noreferrer" className="hover:text-accent">{p.name}</a> <span className="text-xs text-muted">{p.tracks} tracks</span></li>)}</ul>
        </section>
      )}
      {!sums.length && loaded && (
        <div className="flex flex-wrap gap-2">{DOMAINS.map((d) => <Link key={d.name} className="btn-ghost" href={`/swipe/?d=${d.name}`}>{d.emoji} Swipe {d.short}</Link>)}</div>
      )}
    </div>
  );
}

function Bars({ items, neg = false }: { items: [string, number][]; neg?: boolean }) {
  const max = Math.max(...items.map(([, v]) => Math.abs(v)), 0.01);
  return (
    <ul className="space-y-1">
      {items.map(([k, v]) => (
        <li key={k} className="grid grid-cols-[1fr_2fr] items-center gap-2 text-xs">
          <span className="truncate">{k}</span>
          <span className="h-1.5 rounded-full bg-panel-2"><span className={`block h-full rounded-full ${neg ? "bg-nope" : "bg-like"}`} style={{ width: `${(Math.abs(v) / max) * 100}%` }} /></span>
        </li>
      ))}
    </ul>
  );
}

function DomainCard({ s }: { s: TasteSummary }) {
  const cfg = DOMAIN[s.domain];
  return (
    <section className="card space-y-4 p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-2xl">{cfg?.emoji} {cfg?.label}</h2>
        <span className="text-xs text-muted">{s.answers} answers{s.accuracy != null ? ` · model right ${Math.round(s.accuracy * 100)}% of the time` : ""}</span>
      </div>
      <p className="text-sm text-ink/85">{summaryText(s)}</p>
      {s.axes.some((a) => a.value !== 0) && s.domain === "films" && (
        <div className="space-y-2">
          {s.axes.map((a) => (
            <div key={a.label.join()} className="grid grid-cols-[70px_1fr_70px] items-center gap-2 text-xs text-muted">
              <span>{a.label[0]}</span>
              <span className="relative h-1.5 rounded-full bg-panel-2">
                <span className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent" style={{ left: `${50 + a.value * 50}%` }} />
              </span>
              <span className="text-right">{a.label[1]}</span>
            </div>
          ))}
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {s.likedTags.length > 0 && <div><h3 className="mb-1 text-xs uppercase tracking-wider text-muted">You like</h3><Bars items={s.likedTags} /></div>}
        {s.dislikedTags.length > 0 && <div><h3 className="mb-1 text-xs uppercase tracking-wider text-muted">Not for you</h3><Bars items={s.dislikedTags} neg /></div>}
        {s.people.length > 0 && <div><h3 className="mb-1 text-xs uppercase tracking-wider text-muted">People</h3><Bars items={s.people} /></div>}
        {s.languages.length > 0 && <div><h3 className="mb-1 text-xs uppercase tracking-wider text-muted">Original language</h3><Bars items={s.languages} /></div>}
        {s.decades.length > 0 && <div><h3 className="mb-1 text-xs uppercase tracking-wider text-muted">Decades</h3><Bars items={s.decades} /></div>}
        {s.learnedSignals.length > 0 && (
          <div>
            <h3 className="mb-1 text-xs uppercase tracking-wider text-muted">What your ranker learned</h3>
            <ul className="space-y-0.5 text-xs">{s.learnedSignals.map(([f, v]) => <li key={f}>{v > 0 ? "▲" : "▼"} {f.replace(/_/g, " ")} <span className="text-muted">({v > 0 ? "+" : ""}{v.toFixed(2)})</span></li>)}</ul>
          </div>
        )}
      </div>
    </section>
  );
}
