"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import TitleCard from "@/components/TitleCard";
import { api, type Rec, type RecsResponse } from "@/lib/api";

type Kind = "any" | "movie" | "tv";

interface QueryResponse {
  query: string;
  parser: string;
  reranked_by: string | null;
  anchors: string[];
  intent: Record<string, unknown>;
  items: Rec[];
  notes?: string[];
}

const EXAMPLES = [
  "like Fauda but funnier, under 2h, on Netflix",
  "a mind-bending film like Interstellar",
  "dark comedy series like OSS 117",
  "tense thriller under 2h",
];

export default function Home() {
  const [kind, setKind] = useState<Kind>("any");
  const [recs, setRecs] = useState<RecsResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [qres, setQres] = useState<QueryResponse | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.get<RecsResponse>(`/recs?n=20&kind=${kind}`);
      setErr(null);
      setRecs(r);
    } catch (e) {
      setErr(String((e as Error).message));
    }
  }, [kind]);

  useEffect(() => {
    let live = true;
    api
      .get<RecsResponse>(`/recs?n=20&kind=${kind}`)
      .then((r) => live && (setErr(null), setRecs(r)))
      .catch((e) => live && setErr(String(e.message)));
    return () => {
      live = false;
    };
  }, [kind]);

  async function ask(text: string) {
    if (!text.trim()) return;
    setQ(text);
    setBusy(true);
    try {
      setQres(await api.post<QueryResponse>("/query", { q: text, n: 10 }));
    } catch (e) {
      setErr(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-10">
      <section className="pt-2">
        <h1 className="font-display text-4xl leading-tight md:text-6xl">
          What are we watching<span className="text-accent">?</span>
        </h1>
        <form
          className="mt-5 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            ask(q);
          }}
        >
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="like Fauda but funnier, under 2h, on Netflix…"
            className="min-w-0 flex-1 rounded-xl border border-line bg-panel px-4 py-3 outline-none placeholder:text-muted/70 focus:border-accent"
            aria-label="Describe what you want to watch"
          />
          <button className="btn" disabled={busy}>
            {busy ? "Thinking…" : "Ask"}
          </button>
        </form>
        <div className="no-scrollbar mt-3 flex gap-2 overflow-x-auto">
          {EXAMPLES.map((ex) => (
            <button key={ex} className="chip shrink-0 hover:text-ink" onClick={() => ask(ex)}>
              {ex}
            </button>
          ))}
        </div>
      </section>

      {qres && (
        <section>
          <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="font-display text-3xl">“{qres.query}”</h2>
            <button className="text-sm text-muted hover:text-ink" onClick={() => setQres(null)}>
              clear
            </button>
          </div>
          <p className="mb-4 text-xs text-muted">
            {qres.anchors.length > 0 && <>anchored on {qres.anchors.join(", ")} · </>}
            {qres.reranked_by ? `reranked by ${qres.reranked_by}` : "ranked by the recommender (no LLM configured)"}
            {" · parsed by "}
            {qres.parser}
          </p>
          {qres.notes?.map((n) => (
            <p key={n} className="mb-3 text-xs text-accent">{n}</p>
          ))}
          {qres.items.length === 0 ? (
            <p className="text-muted">Nothing fits all of that. Try loosening a constraint.</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {qres.items.map((t) => (
                <TitleCard key={t.id} t={t} />
              ))}
            </div>
          )}
        </section>
      )}

      <section>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-3xl">For you</h2>
            {recs && (
              <p className="text-xs text-muted">
                {recs.profile_size} signals in your profile · ranked by{" "}
                {recs.model === "ltr" ? "your learned ranker" : "the default blend (swipe more to train it)"}
              </p>
            )}
          </div>
          <div className="flex gap-1">
            {(["any", "movie", "tv"] as Kind[]).map((k) => (
              <button key={k} className="chip" data-on={kind === k} onClick={() => setKind(k)}>
                {k === "any" ? "Both" : k === "movie" ? "Films" : "Series"}
              </button>
            ))}
            <button className="chip" onClick={load} title="Refresh">
              ↻
            </button>
          </div>
        </div>
        {err && <p className="card p-4 text-sm text-nope">{err}</p>}
        {recs && recs.profile_size < 10 && (
          <Link href="/swipe" className="card mb-4 block p-4 text-sm hover:border-accent">
            Your profile is thin. <span className="text-accent">Swipe ~50 titles</span> or import your Letterboxd
            data to sharpen these.
          </Link>
        )}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {recs?.items.map((t) => <TitleCard key={t.id} t={t} />) ??
            Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="card aspect-[2/3] animate-pulse bg-panel-2" />
            ))}
        </div>
      </section>
    </div>
  );
}
