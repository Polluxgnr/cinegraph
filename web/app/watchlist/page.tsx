"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Poster from "@/components/Poster";
import { api, kindLabel, runtimeLabel, type Title } from "@/lib/api";

interface Item extends Title {
  status: "want" | "watching";
  source: string;
  note: string | null;
}

export default function Watchlist() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [filter, setFilter] = useState<"all" | "movie" | "tv" | "watching">("all");

  const load = () => api.get<Item[]>("/watchlist").then(setItems);
  useEffect(() => {
    load();
  }, []);

  async function setStatus(id: number, status: "want" | "watching") {
    await api.post("/watchlist", { title_id: id, status });
    load();
  }
  async function remove(id: number) {
    await api.del(`/watchlist/${id}`);
    setItems((xs) => xs?.filter((x) => x.id !== id) ?? null);
  }

  const shown = (items ?? []).filter((t) =>
    filter === "all" ? true : filter === "watching" ? t.status === "watching" : t.kind === filter,
  );

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-4xl md:text-5xl">Watchlist</h1>
          <p className="text-sm text-muted">{items ? `${items.length} titles` : "…"}</p>
        </div>
        <div className="flex gap-1">
          {(["all", "watching", "movie", "tv"] as const).map((f) => (
            <button key={f} className="chip" data-on={filter === f} onClick={() => setFilter(f)}>
              {f === "all" ? "All" : f === "watching" ? "Watching" : f === "movie" ? "Films" : "Series"}
            </button>
          ))}
        </div>
      </header>

      {items && items.length === 0 && (
        <p className="card p-4 text-sm text-muted">
          Empty. Run <code>cinegraph seed-watchlist</code>, import Letterboxd, or add titles from recommendations.
        </p>
      )}

      <ul className="grid gap-2 md:grid-cols-2">
        {shown.map((t) => (
          <li key={t.id} className="card flex gap-3 overflow-hidden p-2">
            <Link href={`/title/${t.id}`} className="w-20 shrink-0 overflow-hidden rounded-lg">
              <Poster t={t} size="w185" />
            </Link>
            <div className="flex min-w-0 flex-1 flex-col py-1">
              <Link href={`/title/${t.id}`} className="truncate font-semibold hover:text-accent">
                {t.title}
              </Link>
              <p className="text-xs text-muted">
                {[kindLabel(t.kind), t.year, runtimeLabel(t)].filter(Boolean).join(" · ")}
              </p>
              {t.platforms.length > 0 && <p className="mt-1 text-xs text-like">{t.platforms.join(" · ")}</p>}
              {t.note && <p className="mt-1 text-xs text-muted">{t.note}</p>}
              <div className="mt-auto flex gap-2 pt-2 text-xs">
                {t.status === "watching" ? (
                  <span className="rounded-full bg-accent/15 px-2 py-1 text-accent">Watching</span>
                ) : (
                  <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setStatus(t.id, "watching")}>
                    Start watching
                  </button>
                )}
                <Link href={`/title/${t.id}`} className="btn-ghost px-2 py-1 text-xs">
                  Rate
                </Link>
                <button className="ml-auto px-2 text-muted hover:text-nope" onClick={() => remove(t.id)}>
                  Remove
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
