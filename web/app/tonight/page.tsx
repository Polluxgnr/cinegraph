"use client";

import { useEffect, useState } from "react";
import TitleCard from "@/components/TitleCard";
import { api, type RecsResponse } from "@/lib/api";

const MOODS: { id: string; label: string; hint: string }[] = [
  { id: "tense", label: "Tense", hint: "gripping, can't look away" },
  { id: "laugh", label: "Laugh", hint: "dark, sharp humour" },
  { id: "mind", label: "Mind-bending", hint: "twists, time, reality" },
  { id: "horror", label: "Horror", hint: "lights off" },
  { id: "epic", label: "Epic", hint: "big, sweeping" },
];

interface Meta {
  platforms: string[];
  my_platforms: string[];
}

export default function Tonight() {
  const [mood, setMood] = useState<string | null>(null);
  const [kind, setKind] = useState<"any" | "movie" | "tv">("any");
  const [maxRuntime, setMaxRuntime] = useState<number | null>(null);
  const [anyPlatform, setAnyPlatform] = useState(false);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [state, setState] = useState<{ key: string; res: RecsResponse | null; err: string | null } | null>(null);

  useEffect(() => {
    api.get<Meta>("/meta").then(setMeta).catch(() => {});
  }, []);

  useEffect(() => {
    const p = new URLSearchParams({ kind, n: "12" });
    if (mood) p.set("mood", mood);
    if (maxRuntime) p.set("max_runtime", String(maxRuntime));
    if (anyPlatform) p.set("any_platform", "true");
    const key = p.toString();
    let live = true;
    api
      .get<RecsResponse>(`/tonight?${key}`)
      .then((res) => live && setState({ key, res, err: null }))
      .catch((e) => live && setState({ key, res: null, err: e.message }));
    return () => {
      live = false;
    };
  }, [mood, kind, maxRuntime, anyPlatform]);

  const currentKey = (() => {
    const p = new URLSearchParams({ kind, n: "12" });
    if (mood) p.set("mood", mood);
    if (maxRuntime) p.set("max_runtime", String(maxRuntime));
    if (anyPlatform) p.set("any_platform", "true");
    return p.toString();
  })();
  const fresh = state?.key === currentKey;
  const res = fresh ? state.res : null;
  const err = fresh ? state.err : null;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-4xl md:text-5xl">Tonight</h1>
        <p className="text-sm text-muted">
          Streaming in France on {meta?.my_platforms.join(", ") ?? "your platforms"}.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {MOODS.map((m) => (
          <button
            key={m.id}
            onClick={() => setMood(mood === m.id ? null : m.id)}
            data-on={mood === m.id}
            className="card p-3 text-left transition hover:border-accent data-[on=true]:border-accent data-[on=true]:bg-accent/10"
          >
            <span className="block font-display text-2xl">{m.label}</span>
            <span className="text-xs text-muted">{m.hint}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(["any", "movie", "tv"] as const).map((k) => (
          <button key={k} className="chip" data-on={kind === k} onClick={() => setKind(k)}>
            {k === "any" ? "Film or series" : k === "movie" ? "Film" : "Series"}
          </button>
        ))}
        <span className="mx-1 h-5 w-px bg-line" />
        {[null, 100, 120, 150].map((r) => (
          <button key={String(r)} className="chip" data-on={maxRuntime === r} onClick={() => setMaxRuntime(r)}>
            {r ? `≤ ${Math.floor(r / 60)}h${r % 60 ? String(r % 60).padStart(2, "0") : ""}` : "Any length"}
          </button>
        ))}
        <span className="mx-1 h-5 w-px bg-line" />
        <button className="chip" data-on={!anyPlatform} onClick={() => setAnyPlatform(!anyPlatform)}>
          {anyPlatform ? "Any availability" : "My platforms only"}
        </button>
      </div>

      {res && res.provider_data === false && !anyPlatform && (
        <p className="card p-4 text-sm text-muted">
          No streaming data yet: it comes from the TMDB crawl (needs <code>TMDB_API_KEY</code>, see README).
          Showing nothing is expected until then; switch to <button className="text-accent underline" onClick={() => setAnyPlatform(true)}>any availability</button>.
        </p>
      )}
      {err && <p className="card p-4 text-sm text-nope">{err}</p>}
      {res && res.items.length === 0 && res.provider_data !== false && (
        <p className="text-muted">Nothing matches every filter. Loosen one.</p>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {res
          ? res.items.map((t) => <TitleCard key={t.id} t={t} />)
          : !err && Array.from({ length: 8 }).map((_, i) => <div key={i} className="card aspect-[2/3] animate-pulse" />)}
      </div>
    </div>
  );
}
