"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

interface Stats {
  movies: number;
  series: number;
  tmdb_detailed: number;
  embedded: number;
  graph_edges: number;
  ratings: number;
  swipes: number;
  watchlist: number;
  pending: number;
  ltr: { examples?: number; importance?: Record<string, number> };
  rss: { items?: number; new?: number };
}
interface Meta {
  platforms: string[];
  my_platforms: string[];
}
interface ImportResult {
  rows: Record<string, number>;
  matched: Record<string, number>;
  unmatched: { file: string; name: string; year: string }[];
  unmatched_total: number;
}

export default function Settings() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [imp, setImp] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = () => {
    api.get<Stats>("/stats").then(setStats);
    api.get<Meta>("/meta").then(setMeta);
  };
  useEffect(load, []);

  async function run(label: string, fn: () => Promise<unknown>, done: (r: never) => string) {
    setBusy(label);
    setMsg(null);
    try {
      const r = await fn();
      setMsg(done(r as never));
      load();
    } catch (e) {
      setMsg(`Error: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  async function upload(file: File) {
    const fd = new FormData();
    fd.append("file", file);
    await run("import", async () => {
      const r = await api.post<ImportResult>("/import/letterboxd", fd);
      setImp(r);
      return r;
    }, (r: ImportResult) => `Imported: ${Object.entries(r.matched).map(([k, v]) => `${k} ${v}/${r.rows[k]}`).join(", ")}`);
  }

  async function togglePlatform(p: string) {
    if (!meta) return;
    const next = meta.my_platforms.includes(p) ? meta.my_platforms.filter((x) => x !== p) : [...meta.my_platforms, p];
    const r = await api.put<{ my_platforms: string[] }>("/settings", { platforms: next });
    setMeta({ ...meta, my_platforms: r.my_platforms });
  }

  return (
    <div className="space-y-8">
      <h1 className="font-display text-4xl md:text-5xl">Import & settings</h1>

      <section className="card space-y-3 p-5">
        <h2 className="font-display text-2xl">Letterboxd → CineGraph</h2>
        <p className="text-sm text-muted">
          On letterboxd.com: Settings → Data → <em>Export your data</em>. Drop the ZIP here. Titles are matched on
          name and year; anything unmatched is listed below.
        </p>
        <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line p-6 text-sm text-muted hover:border-accent">
          <input
            type="file"
            accept=".zip"
            className="hidden"
            data-testid="lb-upload"
            onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
          />
          {busy === "import" ? "Importing…" : "Choose letterboxd-….zip"}
        </label>
        <button
          className="btn-ghost"
          disabled={!!busy}
          onClick={() => run("rss", () => api.post("/sync/rss"), (r: { items: number; new: number }) =>
            `RSS: ${r.items ?? 0} items, ${r.new ?? 0} new diary entries`)}
        >
          {busy === "rss" ? "Syncing…" : "Sync RSS now"}
        </button>
        {imp && imp.unmatched_total > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer text-muted">{imp.unmatched_total} unmatched</summary>
            <ul className="mt-2 max-h-48 overflow-auto text-xs text-muted">
              {imp.unmatched.map((u, i) => (
                <li key={i}>
                  {u.name} ({u.year}) · {u.file}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <section className="card space-y-3 p-5">
        <h2 className="font-display text-2xl">CineGraph → Letterboxd</h2>
        <p className="text-sm text-muted">
          CSVs in Letterboxd&apos;s import format (films only). Upload the diary, ratings and watched files at{" "}
          <a className="text-accent" href="https://letterboxd.com/import/" target="_blank" rel="noreferrer">
            letterboxd.com/import
          </a>{" "}
          and the watchlist file with the import button on your watchlist page.
        </p>
        <div className="flex flex-wrap gap-2">
          <a className="btn" href="/api/export/letterboxd.zip">
            Download Letterboxd CSVs
          </a>
          {["diary", "ratings", "watched", "watchlist"].map((k) => (
            <a key={k} className="btn-ghost text-sm" href={`/api/export/letterboxd/${k}.csv`}>
              {k}.csv
            </a>
          ))}
        </div>
      </section>

      <section className="card space-y-3 p-5">
        <h2 className="font-display text-2xl">My platforms</h2>
        <div className="flex flex-wrap gap-2">
          {meta?.platforms.map((p) => (
            <button key={p} className="chip" data-on={meta.my_platforms.includes(p)} onClick={() => togglePlatform(p)}>
              {p}
            </button>
          ))}
        </div>
      </section>

      <section className="card space-y-3 p-5">
        <h2 className="font-display text-2xl">Models</h2>
        {stats && (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
            {[
              ["Films", stats.movies],
              ["Series", stats.series],
              ["TMDB detailed", stats.tmdb_detailed],
              ["Embedded", stats.embedded],
              ["Graph edges", stats.graph_edges],
              ["Your ratings", stats.ratings],
              ["Swipes", stats.swipes],
              ["Unmatched imports", stats.pending],
            ].map(([k, v]) => (
              <div key={k as string} className="flex justify-between border-b border-line/50 py-1">
                <dt className="text-muted">{k}</dt>
                <dd>{Number(v).toLocaleString()}</dd>
              </div>
            ))}
          </dl>
        )}
        {stats?.ltr?.importance && (
          <p className="text-xs text-muted">
            Ranker trained on {stats.ltr.examples} examples. Top signals:{" "}
            {Object.entries(stats.ltr.importance)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 5)
              .map(([k]) => k)
              .join(", ")}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button className="btn-ghost" disabled={!!busy}
                  onClick={() => run("ltr", () => api.post("/train/ltr"), (r: { trained: boolean; examples: number; reason?: string }) =>
                    r.trained ? `Ranker retrained on ${r.examples} examples` : `Not trained: ${r.reason}`)}>
            {busy === "ltr" ? "Training…" : "Retrain ranker"}
          </button>
          <button className="btn-ghost" disabled={!!busy}
                  onClick={() => run("all", () => api.post("/train/all"), () => "Graph, embeddings, ALS and ranker rebuilt")}>
            {busy === "all" ? "Rebuilding (minutes)…" : "Rebuild everything"}
          </button>
        </div>
      </section>
      {msg && <p className="fixed bottom-24 left-1/2 z-40 -translate-x-1/2 rounded-xl bg-panel-2 px-4 py-2 text-sm shadow-xl md:bottom-6">{msg}</p>}
      <p className="text-xs text-muted/70">
        Film and series data from TMDB (this product uses the TMDB API but is not endorsed or certified by TMDB),
        Wikidata and MovieLens (GroupLens). Streaming availability: TMDB / JustWatch.
      </p>
    </div>
  );
}
