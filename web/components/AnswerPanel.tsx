"use client";

import { useState } from "react";
import { DOMAIN } from "@/lib/domains";
import type { Action } from "@/lib/store";
import type { Entity } from "@/lib/types";

const TONE: Partial<Record<Action, string>> = {
  loved: "text-love border-love/40",
  liked: "text-like border-like/40",
  ok: "text-ink border-line",
  disliked: "text-nope border-nope/40",
  watching: "text-accent border-accent/40",
  want: "text-accent border-accent/40",
  maybe: "text-unseen border-unseen/40",
  unknown: "text-muted border-line",
  never: "text-nope border-nope/40",
};

/**
 * Two-step answer: "Seen it?" then how it felt (with reaction chips drawn from what people say
 * about this title), or "Not seen" then whether you'd watch it. Single-step domains skip step 1.
 */
export default function AnswerPanel({
  e,
  onAnswer,
  compact = false,
}: {
  e: Entity;
  onAnswer: (a: Action, extra: { chips?: string[] }) => void;
  compact?: boolean;
}) {
  const cfg = DOMAIN[e.domain];
  const [step, setStep] = useState<"ask" | "seen" | "unseen">(cfg?.singleStep ? "seen" : "ask");
  const [chips, setChips] = useState<string[]>([]);
  const reactions = e.film?.chips ?? [];

  const btn = (a: Action, label: string, k: number) => (
    <button
      key={a}
      onClick={() => {
        onAnswer(a, { chips: chips.length ? chips : undefined });
        setChips([]);
        setStep(cfg?.singleStep ? "seen" : "ask");
      }}
      className={`rounded-xl border bg-panel px-3 py-2.5 text-sm font-medium transition hover:bg-panel-2 ${TONE[a] ?? ""}`}
      title={`Key ${k}`}
    >
      {label}
    </button>
  );

  if (!cfg) return null;
  if (step === "ask") {
    return (
      <div className={`grid grid-cols-2 gap-2 ${compact ? "" : "text-base"}`}>
        <button onClick={() => setStep("seen")} className="rounded-xl border border-like/40 bg-panel py-3 font-semibold text-like hover:bg-panel-2">
          {cfg.seen}
        </button>
        <button onClick={() => setStep("unseen")} className="rounded-xl border border-unseen/40 bg-panel py-3 font-semibold text-unseen hover:bg-panel-2">
          {cfg.unseen}
        </button>
      </div>
    );
  }
  const actions = step === "seen" ? cfg.seenActions : cfg.unseenActions;
  return (
    <div className="space-y-2">
      {step === "seen" && reactions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {reactions.map((c) => (
            <button
              key={c}
              className="chip text-xs"
              data-on={chips.includes(c)}
              onClick={() => setChips((x) => (x.includes(c) ? x.filter((y) => y !== c) : [...x, c]))}
            >
              {c}
            </button>
          ))}
        </div>
      )}
      <div className={`grid gap-2 ${actions.length > 4 ? "grid-cols-3" : "grid-cols-2"}`}>{actions.map(([a, l], i) => btn(a, l, i + 1))}</div>
      {!cfg.singleStep && (
        <button className="text-xs text-muted hover:text-ink" onClick={() => setStep("ask")}>
          ← back
        </button>
      )}
    </div>
  );
}
