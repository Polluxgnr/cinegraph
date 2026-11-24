"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "@/lib/i18n";
import { ALLERGEN_ICON, allergensOf, durationsIn, effortOf, formatMinutes, ingredientsOf, instructionsOf, restOf, scaleLine, stepsOf, timeOf } from "@/lib/recipe";
import type { Entity } from "@/lib/types";

const PORTIONS = [0.5, 1, 2, 3, 4] as const;

/**
 * A recipe you can cook from: portions that rescale every quantity, ingredients to tick (and copy as a shopping
 * list), numbered steps with their timers, and a full-screen cooking mode that keeps the screen awake.
 */
export default function RecipeView({ e }: { e: Entity }) {
  const T = useT();
  const [k, setK] = useState(1);
  const [ticked, setTicked] = useState<Set<number>>(new Set());
  const [cooking, setCooking] = useState(false);
  const [copied, setCopied] = useState(false);
  const lines = ingredientsOf(e);
  const steps = useMemo(() => stepsOf(instructionsOf(e)), [e]);
  const time = timeOf(e);
  const allergens = allergensOf(e);

  const copy = async () => {
    const list = lines.map((l, i) => (ticked.has(i) ? null : `- ${scaleLine(l, k)}`)).filter(Boolean).join("\n");
    try {
      await navigator.clipboard.writeText(`${e.title}\n${list}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard blocked */ }
  };

  return (
    <section className="space-y-4" data-testid="recipe">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {time && <span className="chip">⏱ {formatMinutes(time)}</span>}
        {restOf(e) > 0 && <span className="chip">💤 {T("+ {t} waiting", { t: formatMinutes(restOf(e)) })}</span>}
        <span className="chip">{T(effortOf(e))}</span>
        <span className="chip">{lines.length} {T("ingredients")}</span>
        {steps.length > 0 && <span className="chip">{steps.length} {T("steps")}</span>}
        {allergens.length > 0 && (
          <span className="text-xs text-muted">{T("Contains")}: {allergens.map((a) => `${ALLERGEN_ICON[a]} ${T(a)}`).join(" · ")}</span>
        )}
      </div>

      <div className="grid gap-5 md:grid-cols-[minmax(220px,300px)_1fr]">
        <div className="card space-y-3 p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-display text-xl">{T("Ingredients")}</h3>
            <div className="flex overflow-hidden rounded-full border border-line text-xs" role="group" aria-label={T("Portions")}>
              {PORTIONS.map((p) => (
                <button key={p} onClick={() => setK(p)} className={`px-2 py-1 ${k === p ? "bg-accent text-bg" : "text-muted hover:text-ink"}`} aria-pressed={k === p}>
                  ×{p === 0.5 ? "½" : p}
                </button>
              ))}
            </div>
          </div>
          <ul className="space-y-1.5 text-sm">
            {lines.map((l, i) => (
              <li key={`${l}-${i}`}>
                <label className="flex cursor-pointer items-start gap-2">
                  <input type="checkbox" className="mt-1 accent-[var(--accent)]" checked={ticked.has(i)}
                         onChange={() => setTicked((t) => { const n = new Set(t); if (n.has(i)) n.delete(i); else n.add(i); return n; })} />
                  <span className={ticked.has(i) ? "text-muted line-through" : ""}>{scaleLine(l, k)}</span>
                </label>
              </li>
            ))}
          </ul>
          <button className="btn-ghost w-full px-3 py-1.5 text-xs" onClick={copy}>{copied ? T("Copied ✓") : T("Copy what's left as a shopping list")}</button>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-display text-xl">{T("Method")}</h3>
            {steps.length > 0 && <button className="btn px-3 py-1.5 text-sm" onClick={() => setCooking(true)} data-testid="cook">👩‍🍳 {T("Cook mode")}</button>}
          </div>
          <ol className="space-y-3">
            {steps.map((st, i) => (
              <li key={i} className="flex gap-3">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-panel-2 font-display text-sm tabular-nums">{i + 1}</span>
                <div className="space-y-1.5">
                  <p className="text-sm leading-relaxed text-ink/90">{st}</p>
                  <div className="flex flex-wrap gap-1.5">{durationsIn(st).slice(0, 3).map((m, j) => <Timer key={j} minutes={m} />)}</div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>

      <AnimatePresence>{cooking && <CookMode title={e.title} steps={steps} lines={lines.map((l) => scaleLine(l, k))} onClose={() => setCooking(false)} />}</AnimatePresence>
    </section>
  );
}

/** A countdown chip: tap to start, tap to pause; rings (vibrates) at zero. */
function Timer({ minutes }: { minutes: number }) {
  const T = useT();
  const total = Math.round(minutes * 60);
  const [left, setLeft] = useState(total);
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!on) return;
    const id = setInterval(() => setLeft((l) => {
      if (l <= 1) {
        setOn(false);
        try { navigator.vibrate?.([300, 150, 300]); } catch { /* no vibration */ }
        return 0;
      }
      return l - 1;
    }), 1000);
    return () => clearInterval(id);
  }, [on]);
  if (total < 30) return null;
  const mm = Math.floor(left / 60), ss = left % 60;
  const label = left === total ? `⏲ ${formatMinutes(minutes)}` : left === 0 ? `🔔 ${T("Done")}` : `${on ? "⏸" : "▶"} ${mm}:${String(ss).padStart(2, "0")}`;
  return (
    <button className="chip text-xs tabular-nums" data-on={on} onClick={() => (left === 0 ? setLeft(total) : setOn(!on))}
            style={left > 0 && left < total ? { background: `linear-gradient(90deg, color-mix(in oklab, var(--accent) 30%, transparent) ${100 - (left / total) * 100}%, transparent 0)` } : undefined}>
      {label}
    </button>
  );
}

/** One step at a time, big type, screen kept awake; arrows or swipe to move. */
function CookMode({ title, steps, lines, onClose }: { title: string; steps: string[]; lines: string[]; onClose: () => void }) {
  const T = useT();
  const [i, setI] = useState(0);
  const [showIng, setShowIng] = useState(false);
  const x0 = useRef<number | null>(null);
  useEffect(() => {
    let lock: { release: () => Promise<void> } | undefined;
    (navigator as unknown as { wakeLock?: { request: (t: string) => Promise<typeof lock> } }).wakeLock?.request("screen").then((l) => { lock = l; }).catch(() => {});
    const key = (ev: KeyboardEvent) => {
      if (ev.key === "ArrowRight" || ev.key === " ") setI((v) => Math.min(steps.length - 1, v + 1));
      if (ev.key === "ArrowLeft") setI((v) => Math.max(0, v - 1));
      if (ev.key === "Escape") onClose();
    };
    window.addEventListener("keydown", key);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", key);
      document.body.style.overflow = "";
      lock?.release().catch(() => {});
    };
  }, [steps.length, onClose]);

  return (
    <motion.div className="fixed inset-0 z-[80] flex flex-col bg-bg" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                role="dialog" aria-label={T("Cook mode")} data-testid="cook-mode"
                onPointerDown={(ev) => { x0.current = ev.clientX; }}
                onPointerUp={(ev) => {
                  if (x0.current == null) return;
                  const dx = ev.clientX - x0.current;
                  x0.current = null;
                  if (dx < -60) setI((v) => Math.min(steps.length - 1, v + 1));
                  if (dx > 60) setI((v) => Math.max(0, v - 1));
                }}>
      <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-xs uppercase tracking-[0.16em] text-muted">{title}</p>
          <p className="font-display text-lg tabular-nums">{T("Step {n} of {m}", { n: i + 1, m: steps.length })}</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-ghost px-3 py-1.5 text-sm" onClick={() => setShowIng(!showIng)}>{T("Ingredients")}</button>
          <button className="btn-ghost px-3 py-1.5 text-sm" onClick={onClose} aria-label={T("Close")}>✕</button>
        </div>
      </header>
      <div className="h-1 bg-panel-2"><motion.div className="h-full bg-accent" animate={{ width: `${((i + 1) / steps.length) * 100}%` }} /></div>
      <div className="relative flex-1 overflow-y-auto">
        <AnimatePresence mode="wait">
          <motion.div key={i} className="mx-auto max-w-3xl space-y-6 px-6 py-10"
                      initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -40 }} transition={{ duration: 0.22 }}>
            <p className="font-display text-3xl leading-snug md:text-4xl">{steps[i]}</p>
            <div className="flex flex-wrap gap-2">{durationsIn(steps[i]).slice(0, 3).map((m, j) => <Timer key={`${i}-${j}`} minutes={m} />)}</div>
          </motion.div>
        </AnimatePresence>
        {showIng && (
          <aside className="absolute inset-y-0 right-0 w-full max-w-xs overflow-y-auto border-l border-line bg-panel p-4 text-sm shadow-2xl">
            <ul className="space-y-1.5">{lines.map((l, j) => <li key={j}>• {l}</li>)}</ul>
          </aside>
        )}
      </div>
      <footer className="flex gap-3 border-t border-line p-4">
        <button className="btn-ghost flex-1 py-3" disabled={i === 0} onClick={() => setI(i - 1)}>← {T("Back")}</button>
        {i < steps.length - 1
          ? <button className="btn flex-[2] py-3" onClick={() => setI(i + 1)}>{T("Next")} →</button>
          : <button className="btn flex-[2] py-3" onClick={onClose}>{T("Bon appétit")} ✓</button>}
      </footer>
    </motion.div>
  );
}
