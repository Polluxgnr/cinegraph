"use client";

import { useT } from "@/lib/i18n";

import { useEffect, useRef, useState } from "react";
import { deezerArtistId, dzTop, type DzTrack } from "@/lib/deezer";
import type { Entity } from "@/lib/types";

/** Once you've pressed play, the next cards play on their own (browsers only allow sound after a tap). */
const AUTO_KEY = "cinegraph:autoplay";
const readAuto = () => {
  try {
    return localStorage.getItem(AUTO_KEY) === "1";
  } catch {
    return false;
  }
};
const writeAuto = (v: boolean) => {
  try {
    localStorage.setItem(AUTO_KEY, v ? "1" : "0");
  } catch {
    /* private mode */
  }
};

/** YouTube key of whatever can be watched for this entity: a film's trailer or the video itself. */
export function videoKey(e: Entity): string | null {
  if (e.film?.tr) return e.film.tr;
  const m = e.item?.meta?.embed;
  return typeof m === "string" ? m : null;
}

/** A YouTube search for the trailer, when the catalogue has no trailer key yet. */
export function trailerSearch(e: Entity): string {
  const q = `${e.film?.ot ?? e.title} ${e.film?.y ?? ""} ${e.film?.k === "tv" ? "série" : "film"} bande annonce`;
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
}

/**
 * The button on a swipe card: ▶ trailer (films), ▶ 30-second preview of the artist's top song (music),
 * ▶ the video (Videos). Stops pointer events so it doesn't start a drag.
 */
export default function MediaPreview({ e, className = "" }: { e: Entity; className?: string }) {
  const T = useT();
  const [open, setOpen] = useState(false);
  const yt = videoKey(e);
  const artist = deezerArtistId(e.key);

  if (artist) return <SongPreview artistId={artist} className={className} />;
  if (!yt && !e.film) return null;
  const stop = (ev: React.PointerEvent | React.MouseEvent) => ev.stopPropagation();
  return (
    <>
      {yt ? (
        <button onPointerDown={stop} onClick={(ev) => { stop(ev); setOpen(true); }}
                className={`rounded-full bg-black/70 px-3 py-1.5 text-xs font-medium text-white backdrop-blur hover:bg-black/90 ${className}`}>
          ▶ {e.film ? T("Trailer") : T("Play")}
        </button>
      ) : (
        <a onPointerDown={stop} href={trailerSearch(e)} target="_blank" rel="noreferrer"
           className={`rounded-full bg-black/70 px-3 py-1.5 text-xs font-medium text-white backdrop-blur hover:bg-black/90 ${className}`}>
          {T("▶ Trailer ↗")}</a>
      )}
      {open && yt && <VideoModal id={yt} title={e.title} onClose={() => setOpen(false)} />}
    </>
  );
}

export function VideoModal({ id, title, onClose }: { id: string; title: string; onClose: () => void }) {
  const T = useT();
  useEffect(() => {
    const k = (ev: KeyboardEvent) => ev.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/85 p-4" onClick={onClose} onPointerDown={(ev) => ev.stopPropagation()}>
      <div className="w-full max-w-4xl" onClick={(ev) => ev.stopPropagation()}>
        <div className="aspect-video overflow-hidden rounded-2xl bg-black">
          <iframe className="h-full w-full" src={`https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`} title={title}
                  allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen />
        </div>
        <button className="mt-3 text-sm text-white/70 hover:text-white" onClick={onClose}>{T("Close (Esc)")}</button>
      </div>
    </div>
  );
}

function SongPreview({ artistId, className }: { artistId: string; className: string }) {
  const T = useT();
  const [tracks, setTracks] = useState<DzTrack[] | null>(null);
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    let live = true;
    dzTop(artistId, 5).then((t) => live && setTracks(t.filter((x) => x.preview))).catch(() => live && setTracks([]));
    return () => {
      live = false; // the <audio> unmounts with the card, which pauses it
    };
  }, [artistId]);

  // autoplay the next cards once you've pressed play (and not paused) at least once
  useEffect(() => {
    if (!tracks?.length || !readAuto() || !audio.current) return;
    audio.current.play().then(() => setPlaying(true)).catch(() => {});
  }, [tracks]);

  if (!tracks?.length) return null;
  const t = tracks[i];
  const stop = (ev: React.PointerEvent | React.MouseEvent) => ev.stopPropagation();
  const toggle = (ev: React.MouseEvent) => {
    stop(ev);
    const a = audio.current;
    if (!a) return;
    if (a.paused) {
      a.play().then(() => setPlaying(true)).catch(() => {});
      writeAuto(true);
    } else {
      a.pause();
      setPlaying(false);
      writeAuto(false);
    }
  };
  return (
    <div onPointerDown={stop} className={`flex max-w-[85%] items-center gap-2 rounded-full bg-black/70 py-1 pl-1 pr-3 text-xs text-white backdrop-blur ${className}`}>
      <button onClick={toggle} aria-label={playing ? T("Pause") : T("Play preview")} className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white text-black">
        {playing ? "❚❚" : "▶"}
      </button>
      <button className="min-w-0 truncate text-left" title={T("Next song")} onClick={(ev) => { stop(ev); setI((i + 1) % tracks.length); setPlaying(false); }}>
        {t.title_short ?? t.title} <span className="text-white/50">· {i + 1}/{tracks.length} ⏭</span>
      </button>
      <audio ref={audio} src={t.preview} preload="none" onEnded={() => setPlaying(false)} onPause={() => setPlaying(false)} onPlay={() => setPlaying(true)}
             key={t.id} autoPlay={playing} />
    </div>
  );
}
