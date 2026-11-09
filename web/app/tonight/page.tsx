"use client";

import { useState } from "react";
import RecCard from "@/components/RecCard";
import { MOODS, moodMatch } from "@/lib/engine/query";
import { useFilms } from "@/lib/hooks";
import { useStore } from "@/lib/store";
import { useRecs } from "@/lib/useRecs";
import { platformOf } from "@/lib/watch";

const HINT: Record<string, string> = { tense: "gripping", laugh: "dark, sharp humour", mind: "twists, time, reality", horror: "lights off", epic: "big, sweeping" };

export default function Tonight() {
  const films = useFilms().data;
  const platforms = useStore((s) => s.settings.platforms);
  const [mood, setMood] = useState<string | null>(null);
  const [kind, setKind] = useState<"any" | "movie" | "tv">("any");
  const [maxRt, setMaxRt] = useState<number | null>(null);
  const [mine, setMine] = useState(true);
  const hasProviders = !!films?.films.some((f) => f.prov?.length);
  const onlyMine = mine && hasProviders;
  const recs = useRecs(
    films,
    {
      n: 18,
      explore: 0.1,
      includeListed: true,
      filter: (e) => {
        const f = e.film!;
        if (kind !== "any" && f.k !== kind) return false;
        if (maxRt && f.rt && f.rt > maxRt) return false;
        if (mood && moodMatch(e, mood) <= 0) return false;
        if (onlyMine && !(f.prov ?? []).some((p) => { const x = platformOf(p); return !!x && (platforms.includes(x) || x === "arte.tv" || x === "france.tv"); })) return false;
        return true;
      },
    },
    [mood, kind, maxRt, onlyMine, platforms.join()].join("|"),
  );
  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-4xl md:text-5xl">Tonight</h1>
        <p className="text-sm text-muted">On {platforms.join(", ")} + free (arte.tv, france.tv), in France.</p>
      </header>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {Object.entries(MOODS).map(([id, m]) => (
          <button key={id} onClick={() => setMood(mood === id ? null : id)} data-on={mood === id}
                  className="card p-3 text-left transition hover:border-accent data-[on=true]:border-accent data-[on=true]:bg-accent/10">
            <span className="block font-display text-2xl">{m.label}</span>
            <span className="text-xs text-muted">{HINT[id]}</span>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {(["any", "movie", "tv"] as const).map((k) => <button key={k} className="chip" data-on={kind === k} onClick={() => setKind(k)}>{k === "any" ? "Film or series" : k === "movie" ? "Film" : "Series"}</button>)}
        <span className="mx-1 h-5 w-px bg-line" />
        {[null, 100, 120, 150].map((r) => <button key={String(r)} className="chip" data-on={maxRt === r} onClick={() => setMaxRt(r)}>{r ? `≤ ${Math.floor(r / 60)}h${r % 60 ? String(r % 60).padStart(2, "0") : ""}` : "Any length"}</button>)}
        <span className="mx-1 h-5 w-px bg-line" />
        <button className="chip" data-on={mine} onClick={() => setMine(!mine)}>{mine ? "My platforms only" : "Anywhere"}</button>
      </div>
      {mine && !hasProviders && films && (
        <p className="card p-4 text-sm text-muted">Streaming availability arrives with the TMDB crawl (add the TMDB key as a GitHub secret, see README). Showing everything meanwhile.</p>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {recs ? recs.map((r) => <RecCard key={r.entity.key} r={r} />) : Array.from({ length: 6 }).map((_, i) => <div key={i} className="card aspect-[2/3] animate-pulse" />)}
      </div>
    </div>
  );
}
