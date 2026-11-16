"use client";

import { useEffect, useMemo, useState } from "react";
import { Row } from "@/components/RecCard";
import { type DomainData, loadExtra } from "@/lib/data";
import { context, scoreOne } from "@/lib/engine/recommend";
import { addCustom, getState, recordFeedback, useStore } from "@/lib/store";
import { fmtPrice } from "@/lib/text";

/** A music release or a clothing piece: something outside the catalogue that belongs to an item in it. */
export interface Extra {
  id: string;
  title: string;
  image?: string;
  url?: string;
  date?: string;
  /** the catalogue item it belongs to (artist, brand), used to rank it with your taste */
  artist?: string;
  artist_key?: string | null;
  brand?: string;
  brand_key?: string | null;
  type?: string;
  price?: number;
  currency?: string;
  spotify?: string;
  tags?: string[];
}

/**
 * New releases (music) or new pieces (style): each row ranked by how much you like whoever made it,
 * then by freshness. "Keep" saves it to your list in that space.
 */
export default function ExtraRow({ d, name, title, hint }: { d: DomainData; name: string; title: string; hint: string }) {
  const [rows, setRows] = useState<Extra[] | null>(null);
  const [now, setNow] = useState(0);
  const version = useStore((s) => s.updatedAt);
  const kept = useStore((s) => new Set(s.custom.filter((c) => c.domain === d.name).map((c) => c.url)));

  useEffect(() => {
    loadExtra<Extra>(d.name, name).then((r) => {
      setNow(Date.now());
      setRows(r);
    });
  }, [d.name, name]);

  const ranked = useMemo(() => {
    if (!rows?.length) return [];
    const s = getState();
    const ctx = context(d, s); // one profile build for the whole row
    const owner = new Map<string, number>();
    const fit = (key?: string | null) => {
      if (!key) return 0.35;
      if (!owner.has(key)) {
        const row = d.index.get(key);
        const a = s.feedback[key]?.action;
        const base = row == null ? 0.35 : scoreOne(d, s, row, ctx).p;
        owner.set(key, a === "fav" || a === "loved" ? 1 : a === "liked" ? 0.85 : a === "disliked" || a === "never" ? 0 : base);
      }
      return owner.get(key)!;
    };
    return rows
      .map((r) => {
        const age = r.date ? (now - Date.parse(r.date)) / 864e5 : 60;
        return { r, fit: fit(r.artist_key ?? r.brand_key), score: fit(r.artist_key ?? r.brand_key) + Math.exp(-Math.max(age, 0) / 30) * 0.25 };
      })
      .filter((x) => x.fit > 0.05)
      .sort((a, b) => b.score - a.score)
      .slice(0, 24);
  }, [rows, d, version, now]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!ranked.length) return null;
  const keep = (r: Extra) => {
    const [id] = addCustom([{
      domain: d.name, title: r.title, subtitle: r.artist ?? r.brand, url: r.url, image: r.image,
      tags: [...(r.tags ?? []), (r.artist ?? r.brand ?? "").toLowerCase(), r.type ?? ""].filter(Boolean),
      meta: r.price ? { price: r.price } : undefined, source: name,
    }]);
    if (!getState().feedback[id]) recordFeedback({ key: id, domain: d.name, action: "want", source: name });
  };
  return (
    <Row title={title} hint={hint}>
      {ranked.map(({ r, fit }) => (
        <article key={r.id} className="card flex flex-col overflow-hidden">
          <a href={r.url} target="_blank" rel="noreferrer" className="relative block aspect-square overflow-hidden bg-panel-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- static export, remote images */}
            {r.image && <img src={r.image} alt={r.title} loading="lazy" className="h-full w-full object-cover transition duration-500 hover:scale-[1.03]" />}
            {fit >= 0.7 && <span className="absolute left-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-[10px] uppercase tracking-wider text-accent">for you</span>}
          </a>
          <div className="flex flex-1 flex-col gap-1 p-3">
            <a href={r.url} target="_blank" rel="noreferrer" className="line-clamp-2 text-sm font-semibold leading-snug hover:text-accent">{r.title}</a>
            <p className="line-clamp-1 text-xs text-muted">
              {[r.artist ?? r.brand, r.type && r.type !== "album" ? r.type.toUpperCase() : "", r.price ? fmtPrice(r.price) : "", r.date ? new Date(r.date).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) : ""].filter(Boolean).join(" · ")}
            </p>
            <div className="mt-auto flex gap-1.5 pt-1">
              <button className="btn-ghost flex-1 px-2 py-1 text-xs" disabled={kept.has(r.url)} onClick={() => keep(r)}>{kept.has(r.url) ? "✓ Kept" : "+ Keep"}</button>
              {r.spotify && <a className="btn-ghost px-2 py-1 text-xs" href={r.spotify} target="_blank" rel="noreferrer" title="Open in Spotify">Spotify</a>}
            </div>
          </div>
        </article>
      ))}
    </Row>
  );
}
