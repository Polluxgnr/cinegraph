"use client";

import { animate, motion, useMotionValue, useTransform } from "motion/react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AnswerPanel from "@/components/AnswerPanel";
import EntityImage from "@/components/EntityImage";
import Match from "@/components/Match";
import { detailHref, Progress } from "@/components/RecCard";
import type { DomainData, FilmData } from "@/lib/data";
import { isFilmData } from "@/lib/data";
import { DOMAIN, DOMAINS } from "@/lib/domains";
import { calibration, type Card, nextCard } from "@/lib/engine/active";
import { answer } from "@/lib/engine/learn";
import { useDomain, useManifest, useQueryParam } from "@/lib/hooks";
import { type Action, getState, undoLast, useLoaded, useStore } from "@/lib/store";
import { fmtRuntime, LANG_NAMES } from "@/lib/text";

const THRESHOLD = 110;

export default function SwipePage() {
  const [dParam, setD] = useQueryParam("d");
  const domain = dParam && DOMAIN[dParam] ? dParam : "films";
  const m = useManifest().data;
  const available = DOMAINS.filter((d) => !m || d.name === "films" || m.domains[d.name]?.count);
  return (
    <div className="mx-auto max-w-md">
      <div className="no-scrollbar -mx-4 mb-4 flex gap-1.5 overflow-x-auto px-4">
        {available.map((d) => (
          <button key={d.name} className="chip shrink-0" data-on={d.name === domain} onClick={() => setD(d.name)}>
            {d.emoji} {d.short}
          </button>
        ))}
      </div>
      <Deck key={domain} domain={domain} />
    </div>
  );
}

function Deck({ domain }: { domain: string }) {
  const { data: d, error } = useDomain(domain);
  const loaded = useLoaded();
  const version = useStore((s) => s.updatedAt);
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [count, setCount] = useState(0);
  const busy = useRef(false);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotate = useTransform(x, [-300, 300], [-12, 12]);
  const likeO = useTransform(x, [20, THRESHOLD], [0, 1]);
  const nopeO = useTransform(x, [-THRESHOLD, -20], [1, 0]);
  const loveO = useTransform(y, [-THRESHOLD, -20], [1, 0]);
  const unseenO = useTransform(y, [20, THRESHOLD], [0, 1]);
  const [unseenMode, setUnseenMode] = useState(false);

  const card: Card | null = useMemo(
    () => (d && loaded ? nextCard(d, getState(), skip) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [d, loaded, version, skip],
  );
  const cal = useMemo(() => (d ? calibration(d, getState()) : 0), [d, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const cfg = DOMAIN[domain];

  const decide = useCallback(
    async (a: Action, extra: { chips?: string[] } = {}, fly: [number, number] = [0, 0]) => {
      if (!card || busy.current) return;
      busy.current = true;
      await Promise.all([animate(x, fly[0] * 600, { duration: 0.25 }), animate(y, fly[1] * 700, { duration: 0.25 })]);
      await answer(card.rec.entity.key, domain, a, { ...extra, source: "swipe" });
      setCount((n) => n + 1);
      setUnseenMode(false);
      x.set(0);
      y.set(0);
      busy.current = false;
    },
    [card, domain, x, y],
  );

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if ((ev.target as HTMLElement)?.tagName === "INPUT") return;
      if (ev.key === "ArrowRight") decide("liked", {}, [1, 0]);
      else if (ev.key === "ArrowLeft") decide("disliked", {}, [-1, 0]);
      else if (ev.key === "ArrowUp") decide("loved", {}, [0, -1]);
      else if (ev.key === "ArrowDown") setUnseenMode(true);
      else if (ev.key === "Backspace" || ev.key === "z") undo();
      else return;
      ev.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function undo() {
    const last = undoLast();
    if (last) setSkip(new Set());
  }

  if (error) return <p className="card p-4 text-sm text-nope">Couldn&apos;t load {cfg?.label}: {error}</p>;
  const e = card?.rec.entity;
  return (
    <div className="flex flex-col items-center">
      <div className="mb-4 w-full">
        <div className="flex items-baseline justify-between">
          <h1 className="font-display text-3xl">{cfg?.emoji} {cfg?.label}</h1>
          <span className="text-xs text-muted">{card ? `${card.info.labels} answer${card.info.labels === 1 ? "" : "s"}` : ""}</span>
        </div>
        <Progress className="mt-2" value={cal} />
        <p className="mt-1 text-[11px] text-muted">
          {cal < 0.5 ? "Learning the basics: cards cover very different things on purpose." : cal < 1 ? "Getting sharper: more cards it expects you to like." : "Calibrated. Keep going to refine, or check your recommendations."}
        </p>
      </div>

      <div
        className="relative mx-auto w-full"
        style={{
          aspectRatio: cfg?.aspect === "2/3" ? "2/3.05" : "4/4.6",
          // keep the whole card + answers on screen
          maxWidth: cfg?.aspect === "2/3" ? "calc(58dvh * 0.656)" : "calc(58dvh * 0.87)",
          touchAction: "none",
        }}
      >
        {e ? (
          <motion.div
            key={e.key}
            data-testid="swipe-card"
            className="absolute inset-0 cursor-grab overflow-hidden rounded-3xl border border-line bg-panel shadow-2xl shadow-black/60 active:cursor-grabbing"
            style={{ x, y, rotate }}
            drag
            dragSnapToOrigin
            dragElastic={0.9}
            onDragEnd={(_, info) => {
              const { x: ox, y: oy } = info.offset;
              if (Math.abs(ox) > Math.abs(oy)) {
                if (ox > THRESHOLD) decide("liked", {}, [1, 0]);
                else if (ox < -THRESHOLD) decide("disliked", {}, [-1, 0]);
              } else if (oy < -THRESHOLD) decide("loved", {}, [0, -1]);
              else if (oy > THRESHOLD) setUnseenMode(true);
            }}
            initial={{ scale: 0.96, opacity: 0.5 }}
            animate={{ scale: 1, opacity: 1 }}
          >
            <EntityImage e={e} aspect={cfg?.aspect === "2/3" ? "2/3" : "4/3"} className="h-full" big bare />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/85 to-transparent p-5 pt-24">
              <CardMeta d={d!} card={card!} />
            </div>
            <Stamp o={likeO} text="LIKED" color="var(--like)" className="left-5 top-6 -rotate-12" />
            <Stamp o={nopeO} text="NOPE" color="var(--nope)" className="right-5 top-6 rotate-12" />
            <Stamp o={loveO} text="LOVED" color="var(--love)" className="left-1/2 top-1/3 -translate-x-1/2" />
            <Stamp o={unseenO} text={cfg?.unseen?.toUpperCase() || "SKIP"} color="var(--unseen)" className="left-1/2 top-10 -translate-x-1/2" />
          </motion.div>
        ) : (
          <div className="absolute inset-0 animate-pulse rounded-3xl bg-panel-2" />
        )}
      </div>

      {e && (
        <div className="mt-4 w-full">
          {unseenMode && cfg && !cfg.singleStep ? (
            <div className="grid grid-cols-2 gap-2">
              {cfg.unseenActions.map(([a, l]) => (
                <button key={a} className="rounded-xl border border-unseen/40 bg-panel py-2.5 text-sm text-unseen hover:bg-panel-2" onClick={() => decide(a, {}, [0, 1])}>{l}</button>
              ))}
              <button className="col-span-2 text-xs text-muted" onClick={() => setUnseenMode(false)}>← back</button>
            </div>
          ) : (
            <AnswerPanel key={e.key} e={e} onAnswer={(a, extra) => decide(a, extra, a === "loved" ? [0, -1] : ["disliked", "never"].includes(a) ? [-1, 0] : [1, 0])} />
          )}
        </div>
      )}

      <div className="mt-4 flex w-full items-center justify-between text-xs text-muted">
        <span>{count} this session · ← → ↑ ↓ keys</span>
        <div className="flex gap-3">
          {e && <button onClick={() => setSkip((s) => new Set(s).add(e.key))} className="hover:text-ink">Skip</button>}
          <button onClick={undo} className="hover:text-ink">↶ Undo</button>
          {e && <Link href={detailHref(e.key)} className="hover:text-ink">Details</Link>}
        </div>
      </div>
      {card && (
        <p className="mt-3 w-full text-[11px] leading-relaxed text-muted/70">
          Why this card: uncertainty {card.info.uncertainty}, novelty {card.info.coverage}, likely known {Math.round(card.info.pSeen * 100)}%.
        </p>
      )}
    </div>
  );
}

function CardMeta({ d, card }: { d: DomainData; card: Card }) {
  const e = card.rec.entity;
  const f = e.film;
  if (f && isFilmData(d)) {
    const fd = d as FilmData;
    const names = (ids?: number[], n = 3) => (ids ?? []).slice(0, n).map((i) => fd.people[i]).join(", ");
    const head = [f.k === "tv" ? "Series" : "Film", f.y, f.k === "tv" ? (f.ns ? `${f.ns} seasons` : "") : fmtRuntime(f.rt), f.lang ? `VO ${LANG_NAMES[f.lang] ?? f.lang}` : ""];
    return (
      <>
        <p className="text-[11px] uppercase tracking-[0.18em] text-white/60">{head.filter(Boolean).join(" · ")}</p>
        <h2 className="font-display text-3xl leading-tight text-white">{e.title}</h2>
        <div className="mt-1"><Match p={card.rec.p} stars={card.rec.stars} /></div>
        <p className="mt-1 line-clamp-1 text-xs text-white/70">
          {(f.g ?? []).slice(0, 3).join(" / ")}
          {f.dir?.length ? ` · ${names(f.dir, 1)}` : f.cre?.length ? ` · ${names(f.cre, 1)}` : ""}
        </p>
        {f.cast?.length ? <p className="line-clamp-1 text-xs text-white/60">{names(f.cast, 3)}</p> : null}
        {f.ov && <p className="mt-1 line-clamp-3 text-[13px] text-white/80">{f.ov}</p>}
      </>
    );
  }
  return (
    <>
      <p className="text-[11px] uppercase tracking-[0.18em] text-white/60">{e.subtitle}</p>
      <h2 className="font-display text-3xl leading-tight text-white">{e.title}</h2>
      <div className="mt-1"><Match p={card.rec.p} stars={card.rec.stars} /></div>
      <p className="mt-1 line-clamp-3 text-[13px] text-white/75">{String(e.item?.meta?.description ?? e.tags.slice(0, 5).join(" · "))}</p>
    </>
  );
}

function Stamp({ o, text, color, className }: { o: ReturnType<typeof useTransform<number, number>>; text: string; color: string; className: string }) {
  return (
    <motion.span style={{ opacity: o, color, borderColor: color }} className={`pointer-events-none absolute rounded-lg border-4 px-3 py-1 text-2xl font-black tracking-widest ${className}`}>
      {text}
    </motion.span>
  );
}
