"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import Match from "@/components/Match";
import { trailerSearch, VideoModal } from "@/components/MediaPreview";
import { detailHref } from "@/components/RecCard";
import type { Rec } from "@/lib/engine/recommend";
import { setList, useStore } from "@/lib/store";
import { fmtRuntime } from "@/lib/text";

/**
 * The opening frame of Films & series: your best pick on its backdrop, full bleed, like the first shot of a
 * film. The only orchestrated motion on the page: the image settles, then the title and actions arrive.
 */
export default function FilmHero({ r, label }: { r: Rec; label: string }) {
  const e = r.entity;
  const f = e.film!;
  const reduce = useReducedMotion();
  const listed = useStore((s) => !!s.lists[e.key]);
  const [play, setPlay] = useState(false);
  const meta = [f.y, f.k === "tv" ? (f.ns ? `${f.ns} season${f.ns === 1 ? "" : "s"}` : "Series") : fmtRuntime(f.rt), (f.g ?? []).slice(0, 2).join(", ")].filter(Boolean).join("  ·  ");
  const rise = (delay: number) => (reduce ? {} : { initial: { opacity: 0, y: 16 }, animate: { opacity: 1, y: 0 }, transition: { delay, duration: 0.6, ease: [0.2, 0.7, 0.2, 1] as const } });
  return (
    <section className="relative -mx-4 -mt-4 overflow-hidden md:-mx-8 md:-mt-6">
      <div className="relative min-h-[62vh] md:min-h-[70vh]">
        {(f.bd || e.image) && (
          // eslint-disable-next-line @next/next/no-img-element -- TMDB backdrop
          <img src={f.bd ?? e.image} alt="" aria-hidden className="hero-backdrop absolute inset-0 h-full w-full object-cover object-top" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-bg via-bg/55 to-bg/10" />
        <div className="absolute inset-0 bg-gradient-to-r from-bg/90 via-bg/30 to-transparent" />
        <div className="relative flex min-h-[62vh] max-w-3xl flex-col justify-end gap-4 px-4 pb-10 md:min-h-[70vh] md:px-8 md:pb-14">
          <motion.p {...rise(0.25)} className="text-sm text-ink/70">{label}</motion.p>
          <motion.h1 {...rise(0.35)} className="font-display text-5xl leading-[0.95] md:text-7xl">{e.title}</motion.h1>
          <motion.div {...rise(0.45)} className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink/80">
            <Match p={r.p} stars={r.stars} />
            <span>{meta}</span>
          </motion.div>
          <motion.p {...rise(0.5)} className="line-clamp-2 max-w-xl text-base text-ink/85">{r.why}</motion.p>
          <motion.div {...rise(0.6)} className="flex flex-wrap gap-2 pt-1">
            {f.tr ? (
              <button className="btn px-5 py-2.5 text-sm" onClick={() => setPlay(true)}>▶ Trailer</button>
            ) : (
              <a className="btn px-5 py-2.5 text-sm" href={trailerSearch(e)} target="_blank" rel="noreferrer">▶ Trailer</a>
            )}
            <button className="rounded-xl border border-ink/25 bg-bg/40 px-5 py-2.5 text-sm backdrop-blur hover:border-accent" onClick={() => setList(e.key, e.domain, listed ? null : "want")}>
              {listed ? "✓ On my list" : "+ My list"}
            </button>
            <Link href={detailHref(e.key)} className="rounded-xl px-4 py-2.5 text-sm text-ink/80 hover:text-ink">Details</Link>
          </motion.div>
        </div>
      </div>
      {play && f.tr && <VideoModal id={f.tr} title={e.title} onClose={() => setPlay(false)} />}
    </section>
  );
}
