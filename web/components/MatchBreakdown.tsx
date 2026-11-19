"use client";

import { motion } from "motion/react";
import type { DomainData } from "@/lib/data";
import type { Rec } from "@/lib/engine/recommend";
import { confidence, FEATURES, prior, weights } from "@/lib/engine/score";
import type { State } from "@/lib/store";

const LABEL: Record<string, string> = {
  emb_profile: "Close to your overall taste",
  emb_max_pos: "Like something you loved",
  emb_max_neg: "Like something you rejected",
  tag_aff: "Genres & themes you rate well",
  graph: "Shared people, sagas, sources with your favourites",
  cf: "People with your taste loved it (MovieLens)",
  people: "Cast & crew you like",
  lang: "Original language",
  decade: "Era",
  runtime_fit: "Length",
  quality: "Critics & audiences",
  popularity: "Popularity",
  recency: "How recent",
  saga_next: "Next in a saga you started",
  listed: "On your list",
  genre_aff: "Genres you rate well",
  kind_aff: "Films vs series, as you like them",
};

/**
 * Why this score: each signal's push (weight × value, from the ranker that learned your weights) and how much
 * of the final number still comes from the crowd because the model doesn't know you well yet.
 */
export default function MatchBreakdown({ d, rec, s }: { d: DomainData; rec: Rec; s: State }) {
  const learned = s.learned.ranker[d.name];
  const w = weights(learned);
  const parts = FEATURES.map((f, i) => ({ f, v: f === "bias" ? 0 : w[i] * rec.scored.x[i] }))
    .filter((p) => Math.abs(p.v) > 0.02)
    .sort((a, b) => Math.abs(b.v) - Math.abs(a.v))
    .slice(0, 7);
  const n = Object.values(s.feedback).filter((x) => x.domain === d.name).length;
  const own = confidence(n);
  const max = Math.max(0.5, ...parts.map((p) => Math.abs(p.v)));
  const crowd = prior(d, rec.scored.row);
  return (
    <section className="card space-y-3 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-xl">Why {Math.round(rec.p * 100)}%</h2>
        <span className="text-[11px] text-muted">{Math.round(own * 100)}% your model · {Math.round((1 - own) * 100)}% the crowd ({n} answers here)</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-line/60" title="Share of the score from your own model vs the crowd">
        <motion.div className="h-full rounded-full bg-accent" initial={{ width: 0 }} animate={{ width: `${own * 100}%` }} transition={{ duration: 0.7 }} />
      </div>
      <ul className="space-y-1.5">
        {parts.map((p, i) => (
          <li key={p.f} className="grid grid-cols-[1fr_7rem] items-center gap-3 text-sm sm:grid-cols-[1fr_10rem]">
            <span className="truncate text-ink/85">{LABEL[p.f] ?? p.f}</span>
            <span className="relative h-2 rounded-full bg-line/40">
              <motion.span className="absolute top-0 h-2 rounded-full" style={{ background: p.v > 0 ? "var(--like)" : "var(--nope)", [p.v > 0 ? "left" : "right"]: "50%" }}
                           initial={{ width: 0 }} animate={{ width: `${(Math.abs(p.v) / max) * 50}%` }} transition={{ duration: 0.6, delay: i * 0.05 }} />
              <span className="absolute left-1/2 top-[-2px] h-3 w-px bg-muted/60" />
            </span>
          </li>
        ))}
        {!parts.length && <li className="text-sm text-muted">Too few answers for personal signals yet: the score comes from the crowd.</li>}
        {parts.length > 0 && n === 0 && <li className="text-[11px] text-muted">These are the signals your model will weigh once you answer; for now the crowd decides.</li>}
      </ul>
      <p className="text-[11px] text-muted">Crowd prior: {crowd >= 0 ? "+" : ""}{crowd.toFixed(2)} (critics & audience, weighted by vote count). Green pushes the score up, red down; weights are learned from your answers.</p>
    </section>
  );
}
