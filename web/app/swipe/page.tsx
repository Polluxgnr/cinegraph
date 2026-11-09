"use client";

import { animate, motion, useMotionValue, useTransform } from "motion/react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import Poster from "@/components/Poster";
import { api, kindLabel, runtimeLabel, type Title } from "@/lib/api";

type Action = "like" | "dislike" | "love" | "unseen";

interface Card {
  card: Title;
  why: { uncertainty: number; coverage: number; p_seen: number; predicted: number; n_labels: number };
  progress: { labelled: number; target: number; swipes: number };
}

const ACTIONS: Record<Action, { label: string; color: string; key: string; dx: number; dy: number }> = {
  dislike: { label: "Nope", color: "var(--nope)", key: "←", dx: -1, dy: 0 },
  unseen: { label: "Not seen", color: "var(--unseen)", key: "↓", dx: 0, dy: 1 },
  love: { label: "Loved", color: "var(--love)", key: "↑", dx: 0, dy: -1 },
  like: { label: "Liked", color: "var(--like)", key: "→", dx: 1, dy: 0 },
};
const THRESHOLD = 110;

export default function SwipePage() {
  const [queue, setQueue] = useState<Card[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [last, setLast] = useState<{ c: Card; a: Action } | null>(null);
  const [count, setCount] = useState(0);
  const busy = useRef(false);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotate = useTransform(x, [-300, 300], [-14, 14]);
  const likeO = useTransform(x, [20, THRESHOLD], [0, 1]);
  const nopeO = useTransform(x, [-THRESHOLD, -20], [1, 0]);
  const loveO = useTransform(y, [-THRESHOLD, -20], [1, 0]);
  const unseenO = useTransform(y, [20, THRESHOLD], [0, 1]);

  const fetchCard = useCallback(async (skip: number[]) => {
    const c = await api.get<Card>(`/swipe/next${skip.length ? `?skip=${skip.join(",")}` : ""}`);
    return c;
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const a = await fetchCard([]);
        const b = await fetchCard([a.card.id]).catch(() => null);
        setQueue(b ? [a, b] : [a]);
      } catch (e) {
        setErr((e as Error).message);
      }
    })();
  }, [fetchCard]);

  const decide = useCallback(
    async (a: Action) => {
      const cur = queue[0];
      if (!cur || busy.current) return;
      busy.current = true;
      const s = ACTIONS[a];
      await Promise.all([
        animate(x, s.dx * 600, { duration: 0.28 }),
        animate(y, s.dy * 700, { duration: 0.28 }),
      ]);
      try {
        await api.post("/swipe", { title_id: cur.card.id, action: a });
        setLast({ c: cur, a });
        setCount((n) => n + 1);
        const rest = queue.slice(1);
        x.set(0);
        y.set(0);
        setQueue(rest);
        const next = await fetchCard(rest.map((c) => c.card.id)).catch(() => null);
        setQueue((q) => (next && !q.some((c) => c.card.id === next.card.id) ? [...q, next] : q));
      } catch (e) {
        setErr((e as Error).message);
        x.set(0);
        y.set(0);
      } finally {
        busy.current = false;
      }
    },
    [queue, x, y, fetchCard],
  );

  async function undo() {
    if (!last) return;
    await api.post("/swipe/undo");
    // put the undone title back on top
    setQueue((q) => [last.c, ...q.filter((c) => c.card.id !== last.c.card.id)]);
    setLast(null);
    setCount((n) => Math.max(0, n - 1));
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const m: Record<string, Action> = { ArrowRight: "like", ArrowLeft: "dislike", ArrowUp: "love", ArrowDown: "unseen" };
      if (m[e.key]) {
        e.preventDefault();
        decide(m[e.key]);
      } else if (e.key === "Backspace" || e.key === "z") undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const cur = queue[0];
  const nxt = queue[1];
  const progress = cur ? Math.min(1, cur.progress.labelled / cur.progress.target) : 0;

  return (
    <div className="mx-auto flex max-w-md flex-col items-center">
      <div className="mb-4 w-full">
        <div className="flex items-baseline justify-between">
          <h1 className="font-display text-3xl">Calibrate</h1>
          <span className="text-xs text-muted">
            {cur ? `${cur.progress.labelled} / ${cur.progress.target} taste signals` : ""}
          </span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-panel-2">
          <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${progress * 100}%` }} />
        </div>
        {progress >= 1 && (
          <p className="mt-2 text-xs text-like">
            Profile ready. <Link href="/" className="underline">See your recommendations</Link>, or keep going to sharpen it.
          </p>
        )}
      </div>

      {err && <p className="card w-full p-4 text-sm text-nope">{err}</p>}

      <div className="relative aspect-[2/3] w-full max-w-[360px]" style={{ touchAction: "none" }}>
        {nxt && (
          <div className="absolute inset-0 scale-[0.96] overflow-hidden rounded-3xl border border-line opacity-60">
            <Poster t={nxt.card} big />
          </div>
        )}
        {cur ? (
          <motion.div
            key={cur.card.id}
            data-testid="swipe-card"
            className="absolute inset-0 cursor-grab overflow-hidden rounded-3xl border border-line bg-panel shadow-2xl shadow-black/60 active:cursor-grabbing"
            style={{ x, y, rotate }}
            drag
            dragSnapToOrigin
            dragElastic={0.9}
            onDragEnd={(_, info) => {
              const { x: ox, y: oy } = info.offset;
              if (Math.abs(ox) > Math.abs(oy)) {
                if (ox > THRESHOLD) decide("like");
                else if (ox < -THRESHOLD) decide("dislike");
              } else if (oy < -THRESHOLD) decide("love");
              else if (oy > THRESHOLD) decide("unseen");
            }}
            initial={{ scale: 0.96, opacity: 0.6 }}
            animate={{ scale: 1, opacity: 1 }}
          >
            <Poster t={cur.card} big bare />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/80 to-transparent p-5 pt-16">
              <p className="text-xs uppercase tracking-[0.2em] text-white/60">
                {[kindLabel(cur.card.kind), cur.card.year, runtimeLabel(cur.card)].filter(Boolean).join(" · ")}
              </p>
              <h2 className="font-display text-3xl leading-tight text-white">{cur.card.title}</h2>
              <p className="mt-1 line-clamp-3 text-sm text-white/75">
                {cur.card.overview || cur.card.genres.join(", ")}
              </p>
            </div>
            <Stamp o={likeO} text="LIKED" color="var(--like)" className="left-5 top-6 -rotate-12" />
            <Stamp o={nopeO} text="NOPE" color="var(--nope)" className="right-5 top-6 rotate-12" />
            <Stamp o={loveO} text="LOVED" color="var(--love)" className="left-1/2 top-1/3 -translate-x-1/2" />
            <Stamp o={unseenO} text="NOT SEEN" color="var(--unseen)" className="left-1/2 top-10 -translate-x-1/2" />
          </motion.div>
        ) : (
          !err && <div className="absolute inset-0 animate-pulse rounded-3xl bg-panel-2" />
        )}
      </div>

      <div className="mt-6 grid w-full max-w-[360px] grid-cols-4 gap-2">
        {(Object.keys(ACTIONS) as Action[]).map((a) => (
          <button
            key={a}
            onClick={() => decide(a)}
            disabled={!cur}
            className="flex flex-col items-center gap-1 rounded-2xl border border-line bg-panel py-3 text-xs transition hover:bg-panel-2 disabled:opacity-40"
            style={{ color: ACTIONS[a].color }}
            aria-label={ACTIONS[a].label}
          >
            <span className="text-xl leading-none">{ACTIONS[a].key}</span>
            {ACTIONS[a].label}
          </button>
        ))}
      </div>

      <div className="mt-4 flex w-full max-w-[360px] items-center justify-between text-xs text-muted">
        <span>{count} swiped this session</span>
        <button onClick={undo} disabled={!last} className="hover:text-ink disabled:opacity-40">
          ↶ Undo {last ? `“${last.c.card.title}”` : ""}
        </button>
      </div>
      {cur && (
        <p className="mt-3 w-full max-w-[360px] text-[11px] leading-relaxed text-muted/70">
          Picked to learn the most: uncertainty {cur.why.uncertainty}, novelty {cur.why.coverage}, likely seen{" "}
          {Math.round(cur.why.p_seen * 100)}%.
        </p>
      )}
    </div>
  );
}

function Stamp({
  o,
  text,
  color,
  className,
}: {
  o: ReturnType<typeof useTransform<number, number>>;
  text: string;
  color: string;
  className: string;
}) {
  return (
    <motion.span
      style={{ opacity: o, color, borderColor: color }}
      className={`pointer-events-none absolute rounded-lg border-4 px-3 py-1 text-2xl font-black tracking-widest ${className}`}
    >
      {text}
    </motion.span>
  );
}
