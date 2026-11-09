"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import Poster from "@/components/Poster";
import Stars from "@/components/Stars";
import { api, kindLabel, poster, runtimeLabel, type Title } from "@/lib/api";

interface Detail extends Title {
  original_title: string | null;
  countries: string[];
  credits: { name: string; role: string; character: string | null }[];
  providers: { provider_name: string; offer_type: string }[];
  facts: { prop: string; object_label: string }[];
  imdb_id: string | null;
}

const FACT_LABEL: Record<string, string> = {
  award: "Awards",
  nominated: "Nominations",
  based_on: "Based on",
  influenced_by: "Influenced by",
  series: "Part of",
  follows: "Follows",
  followed_by: "Followed by",
  narrative_location: "Set in",
  main_subject: "About",
};

export default function TitlePage() {
  const { id } = useParams<{ id: string }>();
  const [t, setT] = useState<Detail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = () => api.get<Detail>(`/titles/${id}`).then(setT).catch((e) => setErr(e.message));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (err) return <p className="card p-4 text-nope">{err}</p>;
  if (!t) return <div className="card h-96 animate-pulse" />;

  const people = (role: string) => t.credits.filter((c) => c.role === role).map((c) => c.name);
  const facts = t.facts.reduce<Record<string, string[]>>((acc, f) => {
    (acc[f.prop] ??= []).push(f.object_label);
    return acc;
  }, {});
  const stream = t.providers.filter((p) => ["flatrate", "free", "ads"].includes(p.offer_type));

  async function rate(v: number) {
    await api.post("/ratings", { title_id: t!.id, rating: v });
    setMsg(`Rated ${v}. Your recommendations are updated.`);
    load();
  }
  async function toggleWatchlist() {
    if (t!.user?.watchlist) await api.del(`/watchlist/${t!.id}`);
    else await api.post("/watchlist", { title_id: t!.id });
    load();
  }

  const backdrop = poster(t.backdrop_path, "w1280");
  return (
    <div className="space-y-8">
      {backdrop && (
        <div
          className="pointer-events-none fixed inset-x-0 top-0 -z-0 h-[55vh] bg-cover bg-center opacity-25"
          style={{ backgroundImage: `url(${backdrop})`, maskImage: "linear-gradient(black, transparent)" }}
        />
      )}
      <div className="relative grid gap-6 md:grid-cols-[260px_1fr]">
        <div className="mx-auto w-48 self-start overflow-hidden rounded-2xl border border-line md:w-full">
          <Poster t={t} big />
        </div>
        <div className="space-y-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-muted">
              {[kindLabel(t.kind), t.year, runtimeLabel(t), t.countries.slice(0, 2).join(", ")].filter(Boolean).join(" · ")}
            </p>
            <h1 className="font-display text-4xl leading-tight md:text-6xl">{t.title}</h1>
            {t.original_title && t.original_title !== t.title && <p className="text-muted">{t.original_title}</p>}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {t.genres.map((g) => (
              <span key={g} className="chip">
                {g}
              </span>
            ))}
          </div>
          {t.overview && <p className="max-w-2xl leading-relaxed text-ink/90">{t.overview}</p>}

          <div className="card flex flex-wrap items-center gap-4 p-4">
            <div>
              <p className="mb-1 text-xs text-muted">{t.user?.rating ? "Your rating" : "Seen it? Rate it"}</p>
              <Stars value={t.user?.rating ?? null} onChange={rate} />
            </div>
            <button className="btn-ghost ml-auto" onClick={toggleWatchlist}>
              {t.user?.watchlist ? "✓ On watchlist" : "+ Watchlist"}
            </button>
            <Link className="btn-ghost" href={`/graph?title=${t.id}`}>
              Explore graph
            </Link>
          </div>
          {msg && <p className="text-sm text-like">{msg}</p>}

          <div className="grid gap-4 text-sm sm:grid-cols-2">
            {[
              ["Directed by", people("director")],
              ["Created by", people("creator")],
              ["Written by", people("writer")],
              ["Starring", people("cast").slice(0, 8)],
              ["Music", people("composer")],
            ]
              .filter(([, v]) => (v as string[]).length)
              .map(([k, v]) => (
                <div key={k as string}>
                  <p className="text-xs text-muted">{k as string}</p>
                  <p>{(v as string[]).join(", ")}</p>
                </div>
              ))}
            <div>
              <p className="text-xs text-muted">Streaming in France</p>
              <p className={stream.length ? "text-like" : "text-muted"}>
                {stream.length ? [...new Set(stream.map((p) => p.provider_name))].join(", ") : "not on a subscription service (or no data yet)"}
              </p>
            </div>
          </div>

          {Object.keys(facts).length > 0 && (
            <div className="grid gap-3 text-sm sm:grid-cols-2">
              {Object.entries(facts).map(([k, v]) => (
                <div key={k}>
                  <p className="text-xs text-muted">{FACT_LABEL[k] ?? k}</p>
                  <p className="line-clamp-3">{v.slice(0, 8).join(", ")}</p>
                </div>
              ))}
            </div>
          )}
          {t.keywords && t.keywords.length > 0 && (
            <p className="text-xs leading-relaxed text-muted">{t.keywords.slice(0, 20).join(" · ")}</p>
          )}
          <p className="text-xs text-muted/70">
            {t.imdb_id && (
              <a className="hover:text-ink" href={`https://www.imdb.com/title/${t.imdb_id}/`} target="_blank" rel="noreferrer">
                IMDb
              </a>
            )}
            {" · "}
            <a
              className="hover:text-ink"
              href={`https://www.themoviedb.org/${t.kind === "tv" ? "tv" : "movie"}/${t.tmdb_id}`}
              target="_blank"
              rel="noreferrer"
            >
              TMDB
            </a>
            {t.kind === "movie" && (
              <>
                {" · "}
                <a className="hover:text-ink" href={`https://letterboxd.com/tmdb/${t.tmdb_id}/`} target="_blank" rel="noreferrer">
                  Letterboxd
                </a>
              </>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
