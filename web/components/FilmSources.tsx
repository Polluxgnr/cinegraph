"use client";

import { useT } from "@/lib/i18n";

import { motion } from "motion/react";
import { useEffect, useState } from "react";
import type { Film } from "@/lib/types";
import { sparql } from "@/lib/wikidata";

/**
 * Where a film's reputation comes from, source by source, live from open data: review scores Wikidata records
 * (Rotten Tomatoes, Metacritic, IMDb, AlloCiné...), TMDB's audience score, MovieLens (individual ratings), and
 * the Wikipedia summary. Every number links to the page it comes from.
 */
interface Score { source: string; method?: string; value: string; pct: number | null; date?: string; url?: string }

/** Every score shown out of 10 with one decimal so sources compare at a glance; a Tomatometer-style
 * "% of positive reviews" is a share, not a grade, so it stays a percentage. */
export function display(v: string, method = ""): { value: string; pct: number | null } {
  const pct = toPct(v);
  if (pct == null) return { value: v, pct };
  if (/%\s*$/.test(v) || /tomatometer|popcorn|audience score|positive/i.test(method)) return { value: `${pct}%`, pct };
  return { value: `${(pct / 10).toFixed(1)}/10`, pct };
}

/** Wikidata method labels (English) -> short, translatable names. */
const METHOD: [RegExp, string][] = [
  [/tomatometer/i, "critics · % positive reviews"],
  [/popcorn|audience score/i, "audience · % positive"],
  [/rotten tomatoes average|average rating/i, "critics' average rating"],
  [/metascore/i, "critics · Metascore"],
  [/user score/i, "users"],
  [/imdb|weighted average/i, "users · weighted average"],
];
const methodName = (m?: string) => (m ? METHOD.find(([re]) => re.test(m))?.[1] ?? m : undefined);
const ORDER = ["IMDb", "Rotten Tomatoes", "Metacritic", "TMDB", "MovieLens", "AlloCiné"];

const SITE_URL: Record<string, (id: string) => string> = {
  "Rotten Tomatoes": (id) => `https://www.rottentomatoes.com/${id}`,
  Metacritic: (id) => `https://www.metacritic.com/${id}`,
  IMDb: (id) => `https://www.imdb.com/title/${id}/`,
  AlloCiné: (id) => `https://www.allocine.fr/film/fichefilm_gen_cfilm=${id}.html`,
};

/** "7.1/10" -> 71, "74/100" -> 74, "73%" -> 73, anything else -> null */
export function toPct(v: string): number | null {
  const frac = v.match(/^([\d.,]+)\s*\/\s*([\d.,]+)$/);
  if (frac) return Math.round((parseFloat(frac[1].replace(",", ".")) / parseFloat(frac[2].replace(",", "."))) * 100);
  const pc = v.match(/^([\d.,]+)\s*%$/);
  return pc ? Math.round(parseFloat(pc[1].replace(",", "."))) : null;
}

async function wikidataScores(qid: string): Promise<{ scores: Score[]; ids: Record<string, string> }> {
  const q = `SELECT ?score ?byLabel ?methodLabel ?date ?rt ?mc ?imdb ?ac WHERE {
    OPTIONAL { wd:${qid} p:P444 ?st . ?st ps:P444 ?score . OPTIONAL { ?st pq:P447 ?by } OPTIONAL { ?st pq:P459 ?method } OPTIONAL { ?st pq:P585 ?date } }
    OPTIONAL { wd:${qid} wdt:P1258 ?rt } OPTIONAL { wd:${qid} wdt:P1712 ?mc } OPTIONAL { wd:${qid} wdt:P345 ?imdb } OPTIONAL { wd:${qid} wdt:P1265 ?ac }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en,fr". } }`;
  const rows = (await sparql(q, 30_000)) as Record<string, { value: string }>[];
  const ids: Record<string, string> = {};
  const first = rows[0] ?? {};
  if (first.rt) ids["Rotten Tomatoes"] = first.rt.value;
  if (first.mc) ids.Metacritic = first.mc.value;
  if (first.imdb) ids.IMDb = first.imdb.value;
  if (first.ac) ids["AlloCiné"] = first.ac.value;
  // latest value per (source, method)
  const best = new Map<string, Score>();
  const ALIAS: Record<string, string> = { "Internet Movie Database": "IMDb" };
  for (const b of rows) {
    if (!b.score) continue;
    const source = ALIAS[b.byLabel?.value ?? ""] ?? b.byLabel?.value ?? "Other";
    const k = `${source}|${b.methodLabel?.value ?? ""}`;
    const cur = best.get(k);
    if (cur && (cur.date ?? "") >= (b.date?.value ?? "")) continue;
    best.set(k, { source, method: methodName(b.methodLabel?.value), ...display(b.score.value, b.methodLabel?.value), date: b.date?.value?.slice(0, 10), url: ids[source] ? SITE_URL[source]?.(ids[source]) : undefined });
  }
  return { scores: [...best.values()].filter((s) => s.pct != null), ids };
}

async function wikipediaSummary(url: string): Promise<{ text: string; url: string } | null> {
  const m = url.match(/^https:\/\/([a-z]+)\.wikipedia\.org\/wiki\/(.+)$/);
  if (!m) return null;
  const r = await fetch(`https://${m[1]}.wikipedia.org/api/rest_v1/page/summary/${m[2]}`, { signal: AbortSignal.timeout(15_000) });
  if (!r.ok) return null;
  const j = await r.json();
  return j.extract ? { text: j.extract, url } : null;
}

export default function FilmSources({ f }: { f: Film }) {
  const T = useT();
  const [scores, setScores] = useState<Score[] | null>(null);
  const [wiki, setWiki] = useState<{ text: string; url: string } | null>(null);
  const qid = f.links?.wikidata?.split("/").pop();

  useEffect(() => {
    let live = true;
    if (qid) wikidataScores(qid).then((x) => live && setScores(x.scores)).catch(() => live && setScores([]));
    else Promise.resolve().then(() => live && setScores([]));
    if (f.links?.wikipedia) wikipediaSummary(f.links.wikipedia).then((w) => live && setWiki(w)).catch(() => {});
    return () => {
      live = false;
    };
  }, [qid, f.links?.wikipedia]);

  const all: Score[] = [
    // IMDb from its official dataset (refreshed with each weekly build) beats Wikidata's dated copy
    ...(f.ir && f.ic ? [{ source: "IMDb", method: T("users · {n} votes", { n: f.ic.toLocaleString() }), value: `${f.ir.toFixed(1)}/10`, pct: Math.round(f.ir * 10), url: f.links?.imdb }] : []),
    ...(f.va && f.vc ? [{ source: "TMDB", method: T("audience · {n} votes", { n: f.vc.toLocaleString() }), value: `${f.va.toFixed(1)}/10`, pct: Math.round(f.va * 10), url: f.links?.tmdb }] : []),
    ...(f.mlr && f.mlc ? [{ source: "MovieLens", method: T("{n} individual ratings", { n: f.mlc.toLocaleString() }), value: `${(f.mlr * 2).toFixed(1)}/10`, pct: Math.round(f.mlr * 20), url: undefined }] : []),
    ...(scores ?? []).filter((x) => !(f.ir && x.source === "IMDb")),
  ].sort((a, b) => (ORDER.indexOf(a.source) + 1 || 99) - (ORDER.indexOf(b.source) + 1 || 99));
  const reviews: [string, string | undefined][] = [
    ["SensCritique", f.links?.senscritique], ["AlloCiné", f.links?.allocine], ["Letterboxd", f.links?.letterboxd], ["IMDb", f.links?.imdb],
  ];

  return (
    <section className="space-y-5">
      <h2 className="font-display text-2xl">{T("What everyone thinks")}</h2>
      <div className="grid gap-2 sm:grid-cols-2">
        {all.map((s, i) => (
          <motion.a key={`${s.source}${s.method}`} href={s.url} target={s.url ? "_blank" : undefined} rel="noreferrer"
                    initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
                    className={`card block p-3 ${s.url ? "hover:border-accent" : ""}`}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-medium">{s.source}</span>
              <span className="font-display text-2xl tabular-nums">{s.value}</span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line/60">
              <motion.div className="h-full rounded-full" style={{ background: (s.pct ?? 0) >= 70 ? "var(--like)" : (s.pct ?? 0) >= 50 ? "var(--accent)" : "var(--nope)" }}
                          initial={{ width: 0 }} animate={{ width: `${s.pct}%` }} transition={{ duration: 0.8, delay: 0.1 + i * 0.05, ease: "easeOut" }} />
            </div>
            <p className="mt-1 text-[11px] text-muted">{[s.method ? T(s.method) : "", s.date ? T("as of {date}", { date: s.date }) : ""].filter(Boolean).join(" · ")}{s.url ? " ↗" : ""}</p>
          </motion.a>
        ))}
        {scores === null && <div className="card h-20 animate-pulse" />}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="text-muted">{T("Read the reviews:")}</span>
        {reviews.filter(([, u]) => u).map(([n, u]) => <a key={n} href={u} target="_blank" rel="noreferrer" className="chip text-xs">{n} ↗</a>)}
        <a className="chip text-xs" target="_blank" rel="noreferrer" href={`https://www.youtube.com/results?search_query=${encodeURIComponent(`${f.ot ?? f.t} ${f.y ?? ""} critique`)}`}>{T("Video reviews ↗")}</a>
      </div>
      {wiki && (
        <div className="card space-y-2 p-4">
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted">{T("Summary · Wikipedia")}</p>
          <p className="text-sm leading-relaxed text-ink/90">{wiki.text}</p>
          <a href={wiki.url} target="_blank" rel="noreferrer" className="text-xs text-accent">{T("Full article ↗")}</a>
        </div>
      )}
      <p className="text-[11px] text-muted/80">
        {T("Scores: IMDb (official dataset), Wikidata (as recorded from each site, with its date), TMDB, MovieLens (GroupLens). Letterboxd and SensCritique publish no open ratings, so they are linked, not scored. Summary: Wikipedia, CC BY-SA. No site is scraped.")}</p>
    </section>
  );
}
