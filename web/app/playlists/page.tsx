"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { detailHref } from "@/components/RecCard";
import type { DomainData } from "@/lib/data";
import { dzPlaylist, dzRelated, dzSearchArtist, dzTop, type DzTrack } from "@/lib/deezer";
import { context, scoreOne } from "@/lib/engine/recommend";
import { useDomain } from "@/lib/hooks";
import { spotifyPlaylist, spotifyToken, startLogin } from "@/lib/spotify";
import { getState, recordFeedback, update, useStore } from "@/lib/store";
import { normTitle } from "@/lib/text";

interface PTrack { title: string; artist: string; artistId?: number; url?: string }
interface Playlist { source: "deezer" | "spotify"; id: string; name: string; image?: string; url: string; tracks: PTrack[] }
interface Suggestion { track: DzTrack; because: string[]; score: number; key?: string }

function parse(url: string): { source: "deezer" | "spotify"; id: string } | null {
  const dz = url.match(/deezer\.com\/(?:[a-z]{2}\/)?playlist\/(\d+)/);
  if (dz) return { source: "deezer", id: dz[1] };
  const sp = url.match(/open\.spotify\.com\/(?:intl-[a-z]+\/)?playlist\/([A-Za-z0-9]+)/);
  if (sp) return { source: "spotify", id: sp[1] };
  return null;
}

async function load(url: string): Promise<Playlist> {
  const p = parse(url);
  if (!p) throw new Error("Paste a Deezer or Spotify playlist link");
  if (p.source === "deezer") {
    const pl = await dzPlaylist(p.id);
    return { ...p, name: pl.title, image: pl.picture_medium, url: pl.link, tracks: pl.tracks.data.map((t) => ({ title: t.title, artist: t.artist.name, artistId: t.artist.id, url: t.link })) };
  }
  const pl = await spotifyPlaylist(p.id);
  return { ...p, name: pl.name, image: pl.image, url, tracks: pl.tracks };
}

/**
 * Link a playlist and make it better: what it says about your taste, songs that would fit (from who the
 * playlist's artists' fans also play, weighted by your own taste), and the tracks that stick out.
 */
export default function Playlists() {
  const { data: d } = useDomain("music");
  const saved = useStore((s) => Object.entries(s.imports).filter(([k]) => k.startsWith("playlist:")));
  const [url, setUrl] = useState("");
  const [pl, setPl] = useState<Playlist | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function open(u: string) {
    setBusy(true);
    setErr(null);
    setPl(null);
    try {
      const p = await load(u);
      setPl(p);
      update((s) => {
        s.imports[`playlist:${p.source}:${p.id}`] = { at: Date.now(), summary: `${p.name} · ${p.tracks.length} tracks`, channels: [{ name: p.name, url: u, count: p.tracks.length }] };
      });
    } catch (e) {
      const msg = (e as Error).message;
      setErr(msg);
      if (parse(u)?.source === "spotify" && !spotifyToken()) sessionStorage.setItem("spotify_return", `/playlists/?u=${encodeURIComponent(u)}`);
    } finally {
      setBusy(false);
    }
  }

  // coming back from the Spotify login, or a shared link
  useEffect(() => {
    const u = new URLSearchParams(window.location.search).get("u");
    if (u) {
      Promise.resolve().then(() => {
        setUrl(u);
        open(u);
      });
    }
  }, []);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-4xl md:text-5xl">Playlists</h1>
        <p className="text-sm text-muted">Paste a Deezer or Spotify playlist: see what it says about your taste, songs that would fit, and the ones that stick out.</p>
      </header>
      <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (url.trim()) open(url.trim()); }}>
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://open.spotify.com/playlist/… or https://www.deezer.com/playlist/…"
               className="min-w-0 flex-1 rounded-xl border border-line bg-panel px-4 py-3 outline-none focus:border-accent" />
        <button className="btn" disabled={busy}>{busy ? "Reading…" : "Open"}</button>
      </form>
      {err && (
        <p className="card p-3 text-sm">
          {err}
          {parse(url)?.source === "spotify" && !spotifyToken() && getState().settings.spotifyClientId && (
            <button className="btn ml-3 px-3 py-1 text-xs" onClick={() => startLogin()}>Connect Spotify</button>
          )}
          {parse(url)?.source === "spotify" && !getState().settings.spotifyClientId && (
            <Link className="ml-2 text-accent" href="/import/#connect-spotify">Set up Spotify →</Link>
          )}
        </p>
      )}
      {saved.length > 0 && !pl && (
        <section>
          <h2 className="mb-2 font-display text-2xl">My playlists</h2>
          <ul className="space-y-1">
            {saved.map(([k, v]) => (
              <li key={k}><button className="text-left text-sm hover:text-accent" onClick={() => { const u = v.channels?.[0]?.url ?? ""; setUrl(u); open(u); }}>▸ {v.summary}</button></li>
            ))}
          </ul>
        </section>
      )}
      {pl && d && <Analysis pl={pl} d={d} />}
    </div>
  );
}

function Analysis({ pl, d }: { pl: Playlist; d: DomainData }) {
  const [sugg, setSugg] = useState<Suggestion[] | null>(null);
  const [learned, setLearned] = useState<string | null>(null);
  const [playing, setPlaying] = useState<number | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);

  const byName = useMemo(() => new Map(d.entities.map((e) => [normTitle(e.title), e])), [d]);
  const artists = useMemo(() => {
    const m = new Map<string, { name: string; n: number; id?: number }>();
    for (const t of pl.tracks) {
      const k = normTitle(t.artist);
      const cur = m.get(k) ?? { name: t.artist, n: 0, id: t.artistId };
      cur.n++;
      m.set(k, cur);
    }
    return [...m.values()].sort((a, b) => b.n - a.n);
  }, [pl]);
  const fb = getState().feedback;
  const misfits = pl.tracks.filter((t) => {
    const e = byName.get(normTitle(t.artist));
    const a = e ? fb[e.key]?.action : undefined;
    return a === "disliked" || a === "never" || a === "dropped";
  });
  const genres = useMemo(() => {
    const c = new Map<string, number>();
    for (const a of artists) for (const t of byName.get(normTitle(a.name))?.tags.slice(0, 2) ?? []) c.set(t, (c.get(t) ?? 0) + a.n);
    return [...c.entries()].sort((x, y) => y[1] - x[1]).slice(0, 8);
  }, [artists, byName]);

  useEffect(() => {
    let live = true;
    (async () => {
      // 1. Deezer ids of the playlist's main artists
      const seeds: { id: number; name: string; w: number }[] = [];
      for (const a of artists.slice(0, 10)) {
        let id = a.id;
        if (!id) {
          const e = byName.get(normTitle(a.name));
          if (e && /^music:\d+$/.test(e.key)) id = Number(e.key.slice(6));
          else id = (await dzSearchArtist(a.name).catch(() => []))[0]?.id;
        }
        if (id) seeds.push({ id, name: a.name, w: a.n });
      }
      // 2. who their fans also play, weighted by how central each seed is to the playlist
      const inPlaylist = new Set(artists.map((a) => normTitle(a.name)));
      const votes = new Map<number, { name: string; v: number; because: Set<string>; fans: number }>();
      const rel = await Promise.all(seeds.map((s) => dzRelated(s.id, 15).catch(() => [])));
      rel.forEach((list, i) => list.forEach((r, rank) => {
        if (inPlaylist.has(normTitle(r.name))) return;
        const cur = votes.get(r.id) ?? { name: r.name, v: 0, because: new Set<string>(), fans: r.nb_fan };
        cur.v += Math.sqrt(seeds[i].w) * (1 - rank / 20);
        cur.because.add(seeds[i].name);
        votes.set(r.id, cur);
      }));
      // 3. your taste: the model's match for artists in the catalogue, vetoes for ones you rejected
      const s = getState();
      const ctx = context(d, s);
      const scored = [...votes.entries()].map(([id, v]) => {
        const key = `music:${id}`;
        const row = d.index.get(key);
        const a = s.feedback[key]?.action;
        if (a === "disliked" || a === "never") return null;
        const p = row != null ? scoreOne(d, s, row, ctx).p : 0.5;
        return { id, key: row != null ? key : undefined, because: [...v.because], score: v.v * (0.5 + p) };
      }).filter((x): x is NonNullable<typeof x> => !!x).sort((a, b) => b.score - a.score).slice(0, 18);
      // 4. each candidate's most played song that isn't already there
      const titles = new Set(pl.tracks.map((t) => normTitle(t.title)));
      const tops = await Promise.all(scored.map((c) => dzTop(c.id, 3).catch(() => [])));
      const out: Suggestion[] = [];
      tops.forEach((ts, i) => {
        const t = ts.find((x) => !titles.has(normTitle(x.title)));
        if (t) out.push({ track: t, because: scored[i].because.slice(0, 2), score: scored[i].score, key: scored[i].key });
      });
      if (live) setSugg(out);
    })().catch(() => live && setSugg([]));
    return () => {
      live = false;
    };
  }, [pl, d, artists, byName]);

  const play = (t: DzTrack) => {
    const el = audio.current;
    if (!el) return;
    if (playing === t.id) return void (el.pause(), setPlaying(null));
    el.src = t.preview;
    el.play().then(() => setPlaying(t.id)).catch(() => {});
  };

  function learn() {
    let n = 0;
    for (const a of artists) {
      const e = byName.get(normTitle(a.name));
      if (e && !getState().feedback[e.key]) {
        recordFeedback({ key: e.key, domain: "music", action: a.n >= 3 ? "loved" : "liked", source: `playlist:${pl.id}` });
        n++;
      }
    }
    setLearned(`${n} artists added to your taste`);
  }

  return (
    <div className="space-y-8">
      <audio ref={audio} onEnded={() => setPlaying(null)} />
      <section className="flex flex-wrap items-center gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element -- playlist cover */}
        {pl.image && <img src={pl.image} alt="" className="h-24 w-24 rounded-xl object-cover" />}
        <div className="flex-1">
          <a href={pl.url} target="_blank" rel="noreferrer" className="font-display text-3xl hover:text-accent">{pl.name}</a>
          <p className="text-sm text-muted">{pl.tracks.length} tracks · {artists.length} artists · {pl.source === "spotify" ? "Spotify" : "Deezer"}</p>
          {genres.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{genres.map(([g]) => <span key={g} className="chip text-xs">{g}</span>)}</div>}
        </div>
        <button className="btn-ghost text-sm" onClick={learn}>{learned ?? "Learn my taste from it"}</button>
      </section>

      <section>
        <h2 className="mb-1 font-display text-2xl">Songs that would fit</h2>
        <p className="mb-3 text-xs text-muted">From who the fans of this playlist&apos;s artists also play, weighted by your own taste. ▶ plays 30 s.</p>
        {!sugg ? <div className="card h-40 animate-pulse" /> : !sugg.length ? <p className="text-sm text-muted">No suggestions found.</p> : (
          <ol className="space-y-1">
            {sugg.map((s) => (
              <li key={s.track.id} className="flex items-center gap-3 rounded-xl px-2 py-1.5 hover:bg-panel">
                <button onClick={() => play(s.track)} disabled={!s.track.preview} className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent text-xs text-bg disabled:opacity-30">{playing === s.track.id ? "❚❚" : "▶"}</button>
                {/* eslint-disable-next-line @next/next/no-img-element -- cover */}
                {s.track.album.cover_medium && <img src={s.track.album.cover_medium} alt="" className="h-10 w-10 rounded" loading="lazy" />}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{s.track.title} <span className="text-muted">· {s.key ? <Link href={detailHref(s.key)} className="hover:text-accent">{s.track.artist.name}</Link> : s.track.artist.name}</span></p>
                  <p className="truncate text-[11px] text-muted">fans of {s.because.join(" & ")} play them</p>
                </div>
                <a className="text-xs text-muted hover:text-ink" href={s.track.link} target="_blank" rel="noreferrer">Deezer ↗</a>
                <a className="text-xs text-muted hover:text-ink" href={`https://open.spotify.com/search/${encodeURIComponent(`${s.track.artist.name} ${s.track.title}`)}`} target="_blank" rel="noreferrer">Spotify ↗</a>
              </li>
            ))}
          </ol>
        )}
        {sugg && sugg.length > 0 && (
          <button className="btn-ghost mt-3 text-xs" onClick={() => navigator.clipboard.writeText(sugg.map((s) => `${s.track.artist.name} - ${s.track.title}`).join("\n"))}>Copy the list</button>
        )}
      </section>

      {misfits.length > 0 && (
        <section>
          <h2 className="mb-2 font-display text-2xl">Tracks that stick out</h2>
          <p className="mb-2 text-xs text-muted">By artists you said weren&apos;t for you.</p>
          <ul className="space-y-1 text-sm">{misfits.map((t, i) => <li key={i}>{t.title} <span className="text-muted">· {t.artist}</span></li>)}</ul>
        </section>
      )}

      <section>
        <h2 className="mb-2 font-display text-2xl">Who&apos;s in it</h2>
        <div className="flex flex-wrap gap-1.5">
          {artists.slice(0, 40).map((a) => {
            const e = byName.get(normTitle(a.name));
            return e ? <Link key={a.name} href={detailHref(e.key)} className="chip text-xs">{a.name} · {a.n}</Link> : <span key={a.name} className="chip text-xs opacity-70">{a.name} · {a.n}</span>;
          })}
        </div>
      </section>
    </div>
  );
}
