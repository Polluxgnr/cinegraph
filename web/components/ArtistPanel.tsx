"use client";

import { useT } from "@/lib/i18n";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { detailHref } from "@/components/RecCard";
import type { DomainData } from "@/lib/data";
import { artistBio, type ArtistBio } from "@/lib/artistBio";
import { dzAlbums, dzArtist, dzRelated, dzTop, type DzAlbum, type DzArtist, type DzTrack } from "@/lib/deezer";
import { compact } from "@/lib/text";

/**
 * Everything about an artist, live from Deezer: fans, the most played songs (30 s previews, with
 * Deezer's popularity rank as a bar), the discography and similar artists, linked back to their pages here.
 * Exact stream counts aren't published by any open API; Deezer's rank is the closest public signal.
 */
export default function ArtistPanel({ id, d }: { id: string; d: DomainData }) {
  const T = useT();
  const [a, setA] = useState<DzArtist | null>(null);
  const [top, setTop] = useState<DzTrack[]>([]);
  const [albums, setAlbums] = useState<DzAlbum[]>([]);
  const [related, setRelated] = useState<DzArtist[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [bio, setBio] = useState<ArtistBio | null>(null);
  const [more, setMore] = useState(false);
  const [playing, setPlaying] = useState<number | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    Promise.all([dzArtist(id), dzTop(id, 15), dzAlbums(id, 40), dzRelated(id, 12)])
      .then(([x, t, al, r]) => {
        setA(x);
        setTop(t);
        setAlbums(al.sort((p, q) => (q.release_date ?? "").localeCompare(p.release_date ?? "")));
        setRelated(r);
      })
      .catch((e) => setErr(String(e.message ?? e)));
  }, [id]);
  useEffect(() => {
    if (!a?.name) return;
    let live = true;
    artistBio(a.name, T.lang).then((b) => live && setBio(b)).catch(() => {});
    return () => { live = false; };
  }, [a?.name, T.lang]);

  const play = (t: DzTrack) => {
    const el = audio.current;
    if (!el) return;
    if (playing === t.id) {
      el.pause();
      setPlaying(null);
      return;
    }
    el.src = t.preview;
    el.play().then(() => setPlaying(t.id)).catch(() => {});
  };

  if (err) return <p className="text-sm text-muted">{T("Deezer didn't answer (")}{err}).</p>;
  if (!a) return <div className="card h-40 animate-pulse" />;
  const maxRank = Math.max(1, ...top.map((t) => t.rank));
  const albumsOnly = albums.filter((x) => x.record_type === "album");
  const singles = albums.filter((x) => x.record_type !== "album");
  return (
    <div className="space-y-8">
      <audio ref={audio} onEnded={() => setPlaying(null)} />
      {bio && (
        <section className="card space-y-2 p-5" data-testid="artist-bio">
          <p className="text-[11px] uppercase tracking-[0.16em] text-muted">{bio.description ?? T("Biography")}</p>
          <p className={`text-sm leading-relaxed text-ink/90 ${more ? "" : "line-clamp-4"}`}>{bio.extract}</p>
          <div className="flex gap-3 text-xs">
            {bio.extract.length > 320 && <button className="text-accent hover:underline" onClick={() => setMore(!more)}>{more ? T("Less") : T("More")}</button>}
            <a className="text-muted hover:text-accent" href={bio.url} target="_blank" rel="noreferrer">Wikipedia ↗</a>
          </div>
        </section>
      )}
      <div className="flex flex-wrap gap-6 text-sm">
        <Stat label="Deezer fans" value={compact(a.nb_fan)} />
        <Stat label="Albums & EPs" value={String(a.nb_album)} />
        {top[0] && <Stat label="Most played" value={top[0].title_short ?? top[0].title} />}
      </div>

      <section>
        <h2 className="mb-3 font-display text-2xl">{T("Most played songs")}</h2>
        <ol className="space-y-1">
          {top.map((t, i) => (
            <li key={t.id} className="flex items-center gap-3 rounded-xl px-2 py-1.5 hover:bg-panel">
              <span className="w-5 text-right text-xs tabular-nums text-muted">{i + 1}</span>
              <button onClick={() => play(t)} disabled={!t.preview} aria-label={playing === t.id ? T("Pause") : `Play ${t.title}`}
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent text-xs text-bg disabled:opacity-30">
                {playing === t.id ? "❚❚" : "▶"}
              </button>
              {/* eslint-disable-next-line @next/next/no-img-element -- remote cover */}
              {t.album.cover_medium && <img src={t.album.cover_medium} alt="" className="h-9 w-9 rounded" loading="lazy" />}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{t.title}</p>
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-line/60" title={`Deezer popularity rank ${t.rank.toLocaleString("fr-FR")}`}>
                  <div className="h-full rounded-full bg-accent" style={{ width: `${(t.rank / maxRank) * 100}%` }} />
                </div>
              </div>
              <span className="text-xs tabular-nums text-muted">{Math.floor(t.duration / 60)}:{String(t.duration % 60).padStart(2, "0")}</span>
              <a href={t.link} target="_blank" rel="noreferrer" className="text-xs text-muted hover:text-ink">{T("Deezer ↗")}</a>
              <a href={`https://open.spotify.com/search/${encodeURIComponent(`${a.name} ${t.title}`)}`} target="_blank" rel="noreferrer" className="hidden text-xs text-muted hover:text-ink sm:inline">{T("Spotify ↗")}</a>
            </li>
          ))}
        </ol>
      </section>

      {[["Albums", albumsOnly], ["Singles & EPs", singles]].map(([label, list]) => (list as DzAlbum[]).length ? (
        <section key={label as string}>
          <h2 className="mb-3 font-display text-2xl">{label as string} <span className="text-base text-muted">({(list as DzAlbum[]).length})</span></h2>
          <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 pb-2">
            {(list as DzAlbum[]).map((al) => (
              <a key={al.id} href={al.link} target="_blank" rel="noreferrer" className="w-32 shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element -- remote cover */}
                <img src={al.cover_medium} alt={al.title} loading="lazy" className="aspect-square w-full rounded-xl object-cover" />
                <p className="mt-1 line-clamp-2 text-xs">{al.title}</p>
                <p className="text-[11px] text-muted">{al.release_date?.slice(0, 4)}</p>
              </a>
            ))}
          </div>
        </section>
      ) : null)}

      {related.length > 0 && (
        <section>
          <h2 className="mb-3 font-display text-2xl">{T("Fans also listen to")}</h2>
          <div className="flex flex-wrap gap-2">
            {related.map((r) => {
              const key = `music:${r.id}`;
              const inside = d.index.has(key);
              const body = <>{r.name} <span className="text-muted">· {compact(r.nb_fan)}</span></>;
              return inside
                ? <Link key={r.id} href={detailHref(key)} className="chip text-sm">{body}</Link>
                : <a key={r.id} href={r.link} target="_blank" rel="noreferrer" className="chip text-sm">{body} ↗</a>;
            })}
          </div>
        </section>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-[0.18em] text-muted">{label}</p>
      <p className="max-w-56 truncate font-display text-2xl">{value}</p>
    </div>
  );
}
