"use client";

import { motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { type DzAlbum, dzAlbums, dzSearchArtist } from "@/lib/deezer";
import { useT } from "@/lib/i18n";
import { useStore } from "@/lib/store";

interface Fresh extends DzAlbum { artist: string }

/**
 * New releases from the artists you actually listen to (Spotify top artists, else the artists you loved here),
 * found live on Deezer's public API: albums, EPs and singles out in the last 90 days, newest first.
 */
export default function FreshReleases() {
  const T = useT();
  const spotify = useStore((s) => s.spotify?.topArtists);
  const loved = useStore((s) => Object.values(s.feedback).filter((f) => f.domain === "music" && (f.action === "loved" || f.action === "fav" || f.action === "liked")).length);
  const names = useMemo(() => (spotify ?? []).slice(0, 24).map((a) => a.name), [spotify]);
  const [items, setItems] = useState<Fresh[] | null>(null);
  const [done, setDone] = useState(0);

  useEffect(() => {
    if (!names.length) return;
    let live = true;
    const since = Date.now() - 90 * 864e5;
    (async () => {
      const out: Fresh[] = [];
      for (let i = 0; i < names.length && live; i += 4) {
        // a few artists at a time: Deezer's public API is rate-limited
        const batch = await Promise.all(names.slice(i, i + 4).map(async (n) => {
          const a = (await dzSearchArtist(n).catch(() => []))[0];
          if (!a || a.name.toLowerCase() !== n.toLowerCase()) return [];
          const albums = await dzAlbums(a.id, 12).catch(() => []);
          return albums.filter((x) => x.release_date && Date.parse(x.release_date) >= since).map((x) => ({ ...x, artist: a.name }));
        }));
        out.push(...batch.flat());
        if (live) {
          setDone(Math.min(names.length, i + 4));
          setItems([...out].sort((a, b) => (b.release_date ?? "").localeCompare(a.release_date ?? "")));
        }
      }
    })();
    return () => {
      live = false;
    };
  }, [names]);

  if (!names.length) {
    return (
      <section className="card space-y-1 p-4 text-sm text-muted">
        <h2 className="font-display text-2xl text-ink">{T("New from your artists")}</h2>
        <p>{loved ? T("Connect Spotify to follow releases from the artists you actually listen to.") : T("Connect Spotify, or love a few artists, to follow their new releases here.")}</p>
      </section>
    );
  }
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-2xl md:text-3xl">{T("New from your artists")}</h2>
        <p className="text-xs text-muted">{T("Last 90 days · {done}/{n} artists checked on Deezer", { done, n: names.length })}</p>
      </div>
      {items && !items.length && done >= names.length && <p className="text-sm text-muted">{T("Nothing new from them in the last 90 days.")}</p>}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {(items ?? []).map((x, i) => (
          <motion.a key={x.id} href={x.link} target="_blank" rel="noreferrer" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 12) * 0.03 }}
                    className="group card overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element -- Deezer cover */}
            {x.cover_medium && <img src={x.cover_medium} alt={x.title} loading="lazy" className="aspect-square w-full object-cover transition duration-500 group-hover:scale-105" />}
            <div className="p-2.5">
              <p className="line-clamp-1 text-sm font-medium group-hover:text-accent">{x.title}</p>
              <p className="line-clamp-1 text-xs text-muted">{x.artist} · {T(x.record_type === "single" ? "Single" : x.record_type === "ep" ? "EP" : "Album")} · {x.release_date}</p>
            </div>
          </motion.a>
        ))}
        {!items && Array.from({ length: 6 }, (_, i) => <div key={i} className="card aspect-[3/4] animate-pulse" />)}
      </div>
    </section>
  );
}
