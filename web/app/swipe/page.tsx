"use client";

import { filmOverview, useT, itemDescription } from "@/lib/i18n";

import { animate, motion, useMotionValue, useTransform } from "motion/react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AnswerPanel from "@/components/AnswerPanel";
import MediaPreview from "@/components/MediaPreview";
import EntityImage from "@/components/EntityImage";
import Match from "@/components/Match";
import { detailHref, Progress } from "@/components/RecCard";
import type { DomainData, FilmData } from "@/lib/data";
import { isFilmData } from "@/lib/data";
import { DOMAIN } from "@/lib/domains";
import { calibration, type Card, nextCard } from "@/lib/engine/active";
import { swipeMatcher } from "@/lib/engine/swipeFilter";
import SwipeFiltersBar from "@/components/SwipeFilters";
import { answer } from "@/lib/engine/learn";
import { useDomain, useSpace } from "@/lib/hooks";
import { type Action, getState, setSettings, undoLast, useLoaded, useStore } from "@/lib/store";
import { fmtRuntime, LANG_NAMES } from "@/lib/text";
import { useFilmDetails } from "@/lib/useFilmDetails";

const THRESHOLD = 110;

export default function SwipePage() {
  const space = useSpace();
  const loaded = useLoaded();
  return <div className="mx-auto max-w-md">{loaded && <Deck key={space} domain={space} />}</div>;
}

function Deck({ domain }: { domain: string }) {
  const T = useT();
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

  const swipeFilters = useStore((s) => s.settings.swipeFilters);
  const platforms = useStore((s) => s.settings.platforms);
  const accept = useMemo(() => (d && isFilmData(d) ? swipeMatcher(swipeFilters, platforms, d) : undefined), [d, swipeFilters, platforms]);
  const card: Card | null = useMemo(
    () => (d && loaded ? nextCard(d, getState(), skip, Math.random, accept) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [d, loaded, version, skip, accept],
  );
  const cal = useMemo(() => (d ? calibration(d, getState()) : 0), [d, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const cfg = DOMAIN[domain];

  const decide = useCallback(
    async (a: Action, extra: { chips?: string[] } = {}, fly: [number, number] = [0, 0]) => {
      if (!card || busy.current) return;
      busy.current = true;
      try {
        // short tween on the moving axis only (animating a value to itself never settles),
        // capped so a stalled animation can never block the deck
        const fast = { type: "tween", duration: 0.18, ease: "easeIn" } as const;
        const moves: Promise<unknown>[] = [];
        if (fly[0]) moves.push(Promise.resolve(animate(x, fly[0] * 600, fast)));
        if (fly[1]) moves.push(Promise.resolve(animate(y, fly[1] * 700, fast)));
        await Promise.race([Promise.all(moves), new Promise((r) => setTimeout(r, 300))]);
        await answer(card.rec.entity.key, domain, a, { ...extra, source: "swipe" });
        setCount((n) => n + 1);
        setUnseenMode(false);
      } finally {
        x.set(0);
        y.set(0);
        busy.current = false;
      }
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

  if (error) return <p className="card p-4 text-sm text-nope">{T("Couldn't load")}{" "}{T(cfg?.label ?? "")}: {error}</p>;
  const e = card?.rec.entity;
  return (
    <div className="flex flex-col items-center max-md:h-[calc(100dvh-9.5rem-env(safe-area-inset-bottom))]">
      <div className="relative z-30 mb-2 w-full md:mb-4">
        <div className="flex items-center justify-between gap-2">
          <h1 className="font-display text-xl md:text-3xl">{cfg?.emoji} {T(cfg?.label ?? "")}</h1>
          {d && isFilmData(d) && <SwipeFiltersBar d={d} />}
          <span className="text-xs text-muted">{card ? T(card.info.labels === 1 ? "{n} answer" : "{n} answers", { n: card.info.labels }) : ""}</span>
        </div>
        <Progress className="mt-1.5 md:mt-2" value={cal} />
        <p className="mt-1 hidden text-[11px] text-muted md:block">
          {cal < 0.5 ? T("Learning the basics: cards cover very different things on purpose.") : cal < 1 ? T("Getting sharper: more cards it expects you to like.") : T("Calibrated. Keep going to refine, or check your recommendations.")}
        </p>
      </div>

      {/* the card takes whatever height is left (phones) or 58% of the screen (desktop), keeping its shape */}
      <div className="flex min-h-0 w-full flex-1 items-center justify-center md:flex-none">
      <div
        className="relative mx-auto h-full max-h-full max-w-full md:h-[58dvh]"
        style={{ aspectRatio: cfg?.aspect === "2/3" ? "2/3.05" : "4/4.6", touchAction: "none" }}
      >
        {e && (
          <>
            <div className="deck-ghost" style={{ transform: "translateY(14px) scale(0.92)", opacity: 0.35 }} />
            <div className="deck-ghost" style={{ transform: "translateY(7px) scale(0.96)", opacity: 0.6 }} />
          </>
        )}
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
            initial={{ scale: 0.94, y: 10, opacity: 0.6 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
          >
            <EntityImage e={e} aspect={cfg?.aspect === "2/3" ? "2/3" : "4/3"} className="h-full" big bare />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/85 to-transparent p-4 pt-20 md:p-5 md:pt-24">
              <CardMeta d={d!} card={card!} />
            </div>
            <div className="absolute right-3 top-3 z-10 flex justify-end"><MediaPreview e={e} /></div>
            <Stamp o={likeO} text="LIKED" color="var(--like)" className="left-5 top-6 -rotate-12" />
            <Stamp o={nopeO} text="NOPE" color="var(--nope)" className="right-5 top-6 rotate-12" />
            <Stamp o={loveO} text="LOVED" color="var(--love)" className="left-1/2 top-1/3 -translate-x-1/2" />
            <Stamp o={unseenO} text={cfg?.unseen?.toUpperCase() || "SKIP"} color="var(--unseen)" className="left-1/2 top-10 -translate-x-1/2" />
          </motion.div>
        ) : d && accept ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-3xl border border-line bg-panel p-6 text-center">
            <p className="text-sm text-muted">{T("Nothing matches these filters.")}</p>
            <button className="btn px-3 py-1.5 text-sm" onClick={() => setSettings({ swipeFilters: {} })}>{T("Reset filters")}</button>
          </div>
        ) : (
          <div className="absolute inset-0 animate-pulse rounded-3xl bg-panel-2" />
        )}
      </div>
      </div>

      {e && (
        <div className="mt-2 w-full shrink-0 md:mt-4">
          {unseenMode && cfg && !cfg.singleStep ? (
            <div className="grid grid-cols-3 gap-1.5 md:grid-cols-2 md:gap-2">
              {cfg.unseenActions.map(([a, l]) => (
                <button key={a} className="rounded-xl border border-unseen/40 bg-panel py-2 text-[13px] text-unseen hover:bg-panel-2 md:py-2.5 md:text-sm" onClick={() => decide(a, {}, [0, 1])}>{T(l)}</button>
              ))}
              <button className="col-span-2 text-xs text-muted" onClick={() => setUnseenMode(false)}>{T("← back")}</button>
            </div>
          ) : (
            <AnswerPanel key={e.key} e={e} dense onAnswer={(a, extra) => decide(a, extra, a === "loved" || a === "fav" ? [0, -1] : ["disliked", "dropped", "never"].includes(a) ? [-1, 0] : [1, 0])} />
          )}
        </div>
      )}

      <div className="mt-2 flex w-full shrink-0 items-center justify-between text-xs text-muted md:mt-4">
        <span className="hidden md:inline">{count} {T("this session · ← → ↑ ↓ keys")}</span>
        <span className="md:hidden">{count} {T("this session")}</span>
        <div className="flex gap-3">
          {e && <button onClick={() => setSkip((s) => new Set(s).add(e.key))} className="hover:text-ink">{T("Skip")}</button>}
          <button onClick={undo} className="hover:text-ink">{T("↶ Undo")}</button>
          {e && <Link href={detailHref(e.key)} className="hover:text-ink">{T("Details")}</Link>}
        </div>
      </div>
      {card && (
        <p className="mt-3 hidden w-full text-[11px] leading-relaxed text-muted/70 md:block">
          {T("Why this card: uncertainty")}{" "}{card.info.uncertainty}{T(", novelty")}{" "}{card.info.coverage}{T(", likely known")}{" "}{Math.round(card.info.pSeen * 100)}%.
        </p>
      )}
    </div>
  );
}

function CardMeta({ d, card }: { d: DomainData; card: Card }) {
  const T = useT();
  const e = card.rec.entity;
  const f = e.film;
  useFilmDetails(f);
  if (f && isFilmData(d)) {
    const fd = d as FilmData;
    const names = (ids?: number[], n = 3) => (ids ?? []).slice(0, n).map((i) => fd.people[i]).join(", ");
    const head = [f.k === "tv" ? T("Series") : T("Film"), f.y, f.k === "tv" ? (f.ns ? T(f.ns === 1 ? "{n} season" : "{n} seasons", { n: f.ns }) : "") : fmtRuntime(f.rt), f.lang ? `${T("VO")} ${LANG_NAMES[f.lang] ?? f.lang}` : ""];
    return (
      <>
        <p className="text-[11px] uppercase tracking-[0.18em] text-white/60">{head.filter(Boolean).join(" · ")}</p>
        <h2 className="font-display text-2xl leading-tight text-white md:text-3xl">{e.title}</h2>
        <div className="mt-1"><Match p={card.rec.p} film={card.rec.entity.film} /></div>
        <p className="mt-1 line-clamp-1 text-xs text-white/70">
          {(f.g ?? []).slice(0, 3).map((g) => T(g)).join(" / ")}
          {f.dir?.length ? ` · ${names(f.dir, 1)}` : f.cre?.length ? ` · ${names(f.cre, 1)}` : ""}
        </p>
        {f.cast?.length ? <p className="line-clamp-1 text-xs text-white/60">{names(f.cast, 3)}</p> : null}
        {filmOverview(f) && <p className="mt-1 line-clamp-2 text-[13px] text-white/80 md:line-clamp-3">{filmOverview(f)}</p>}
      </>
    );
  }
  return (
    <>
      <p className="text-[11px] uppercase tracking-[0.18em] text-white/60">{e.subtitle}</p>
      <h2 className="font-display text-2xl leading-tight text-white md:text-3xl">{e.title}</h2>
      <div className="mt-1"><Match p={card.rec.p} film={card.rec.entity.film} /></div>
      <p className="mt-1 line-clamp-3 text-[13px] text-white/75">{itemDescription(e.item?.meta) ?? e.tags.slice(0, 5).join(" · ")}</p>
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
