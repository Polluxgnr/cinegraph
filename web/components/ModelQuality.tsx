"use client";

import { useT } from "@/lib/i18n";

import { motion } from "motion/react";
import { useManifest } from "@/lib/hooks";

const METHODS: [string, string, string][] = [
  ["popular", "Most popular", "everyone gets the same top films"],
  ["content", "Content", "films whose description resembles what you liked"],
  ["als", "People like you", "collaborative filtering on 32M individual ratings"],
  ["hybrid", "CineGraph", "the blend the app uses"],
];

/**
 * How good are the recommendations, measured: favourites of real MovieLens users are hidden and each method
 * has to find them again. Rebuilt with the catalogue every week.
 */
export default function ModelQuality() {
  const T = useT();
  const ev = useManifest().data?.eval;
  if (!ev) return null;
  const max = Math.max(...METHODS.map(([k]) => ev[k as "hybrid"]?.hr10 ?? 0), 0.01);
  return (
    <section className="card space-y-3 p-5">
      <div>
        <h2 className="font-display text-2xl">{T("How good is it, measured")}</h2>
        <p className="text-xs text-muted">
          {T("For")}{" "}{ev.users.toLocaleString("fr-FR")} {T("MovieLens users, 20% of the films they rated 4/5 or more were hidden; each method ranks")}{" "}{ev.items.toLocaleString("fr-FR")} {T("films and we check whether a hidden favourite lands in its top 10.")}</p>
      </div>
      <ul className="space-y-2">
        {METHODS.map(([k, label, hint], i) => {
          const m = ev[k as "hybrid"];
          if (!m) return null;
          return (
            <li key={k} className="grid grid-cols-[8.5rem_1fr_4rem] items-center gap-3 text-sm">
              <span title={hint} className={k === "hybrid" ? "font-semibold text-accent" : ""}>{label}</span>
              <span className="h-2.5 overflow-hidden rounded-full bg-line/50">
                <motion.span className="block h-full rounded-full" style={{ background: k === "hybrid" ? "var(--accent)" : "var(--muted, #71717a)" }}
                             initial={{ width: 0 }} animate={{ width: `${(m.hr10 / max) * 100}%` }} transition={{ duration: 0.8, delay: i * 0.08 }} />
              </span>
              <span className="text-right tabular-nums">{Math.round(m.hr10 * 100)}%</span>
            </li>
          );
        })}
      </ul>
      {ev.app && (
        <p className="text-sm">
          {T("The app's own engine (what you see): HR@10")}{" "}<b>{Math.round(ev.app.after.hr10 * 100)}%</b>{T(", NDCG@10")}{" "}{ev.app.after.ndcg10.toFixed(3)}
          <span className="text-muted"> {T("· before the last tuning")}{" "}{Math.round(ev.app.before.hr10 * 100)}% / {ev.app.before.ndcg10.toFixed(3)} ({ev.app.after.users} {T("users)")}</span>
        </p>
      )}
      <p className="text-[11px] text-muted">
        {T("Share of people with a hidden favourite in the top 10 (HR@10). NDCG@10")}{" "}{ev.hybrid?.ndcg10.toFixed(3)} {T("· Recall@20")}{" "}{ev.hybrid?.recall20.toFixed(3)} {T("for CineGraph. Blend weights picked on half the users, scores reported on the other half.")}</p>
    </section>
  );
}
