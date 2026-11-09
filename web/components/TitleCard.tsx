"use client";

import Link from "next/link";
import { useState } from "react";
import Poster from "@/components/Poster";
import { api, kindLabel, runtimeLabel, type Rec, type Title } from "@/lib/api";

export default function TitleCard({ t, onAction }: { t: Title | Rec; onAction?: (id: number) => void }) {
  const rec = "why" in t ? (t as Rec) : null;
  const [saved, setSaved] = useState(t.user?.watchlist != null);
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;

  async function toWatchlist() {
    await api.post("/watchlist", { title_id: t.id });
    setSaved(true);
    onAction?.(t.id);
  }
  async function notForMe() {
    await api.post(`/hide/${t.id}`);
    setHidden(true);
    onAction?.(t.id);
  }

  return (
    <article className="group card flex flex-col overflow-hidden">
      <Link href={`/title/${t.id}`} className="relative block overflow-hidden">
        <Poster t={t} size="w342" className="transition duration-500 group-hover:scale-[1.03]" />
        {rec?.explore && (
          <span className="absolute left-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-[10px] uppercase tracking-wider text-unseen">
            exploring
          </span>
        )}
        {t.platforms?.length > 0 && (
          <span className="absolute bottom-2 left-2 rounded-full bg-black/75 px-2 py-0.5 text-[11px] text-ink">
            {t.platforms.join(" · ")}
          </span>
        )}
      </Link>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <div>
          <Link href={`/title/${t.id}`} className="line-clamp-1 font-semibold hover:text-accent">
            {t.title}
          </Link>
          <p className="text-xs text-muted">
            {[kindLabel(t.kind), t.year, runtimeLabel(t)].filter(Boolean).join(" · ")}
          </p>
        </div>
        {rec && <p className="line-clamp-3 text-[13px] leading-snug text-ink/85">{rec.why}</p>}
        <div className="mt-auto flex gap-2 pt-1">
          <button onClick={toWatchlist} disabled={saved} className="btn-ghost flex-1 px-2 py-1.5 text-xs">
            {saved ? "On watchlist" : "+ Watchlist"}
          </button>
          <button onClick={notForMe} className="btn-ghost px-2 py-1.5 text-xs text-muted" title="Not for me">
            ✕
          </button>
        </div>
      </div>
    </article>
  );
}
