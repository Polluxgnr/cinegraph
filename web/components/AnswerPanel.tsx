"use client";

import { useT } from "@/lib/i18n";

import { useState } from "react";
import { DOMAIN } from "@/lib/domains";
import type { Action } from "@/lib/store";
import type { Entity } from "@/lib/types";

const TONE: Partial<Record<Action, string>> = {
  fav: "text-love border-love bg-love/10",
  dropped: "text-nope/80 border-nope/30",
  asap: "text-accent border-accent bg-accent/10",
  later: "text-muted border-line",
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

const SHORT: Partial<Record<Action, string>> = {
  fav: "★ Favourite", loved: "Loved", liked: "Liked", ok: "OK", disliked: "Nope", dropped: "Dropped", watching: "Watching",
  asap: "Soon!", want: "My list", maybe: "Maybe", later: "Not now", unknown: "No idea", never: "Never",
};

/**
 * Two-step answer: "Seen it?" then how it felt (with reaction chips drawn from what people say
 * about this title), or "Not seen" then whether you'd watch it. Single-step domains skip step 1.
 */
export default function AnswerPanel({
  e,
  onAnswer,
  compact = false,
  dense = false,
}: {
  e: Entity;
  onAnswer: (a: Action, extra: { chips?: string[] }) => void;
  compact?: boolean;
  /** swipe deck: on phones, small buttons with short labels so card + answers fit one screen */
  dense?: boolean;
}) {
  const T = useT();
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
      className={`rounded-xl border bg-panel font-medium transition hover:bg-panel-2 active:scale-95 ${dense ? "px-1.5 py-2 text-[13px] leading-tight md:px-3 md:py-2.5 md:text-sm" : "px-3 py-2.5 text-sm"} ${TONE[a] ?? ""}`}
      title={`Key ${k}`}
    >
      {dense && label.length > 11 ? (
        <>
          <span className="md:hidden">{T(SHORT[a] ?? label)}</span>
          <span className="hidden md:inline">{T(label)}</span>
        </>
      ) : T(label)}
    </button>
  );

  if (!cfg) return null;
  if (step === "ask") {
    return (
      <div className={`grid grid-cols-2 gap-2 ${compact ? "" : "text-base"}`}>
        <button onClick={() => setStep("seen")} className={`rounded-xl border border-like/40 bg-panel font-semibold text-like hover:bg-panel-2 active:scale-95 ${dense ? "py-2.5 md:py-3" : "py-3"}`}>
          {T(cfg.seen)}
        </button>
        <button onClick={() => setStep("unseen")} className={`rounded-xl border border-unseen/40 bg-panel font-semibold text-unseen hover:bg-panel-2 active:scale-95 ${dense ? "py-2.5 md:py-3" : "py-3"}`}>
          {T(cfg.unseen)}
        </button>
      </div>
    );
  }
  const actions = step === "seen" ? cfg.seenActions : cfg.unseenActions;
  return (
    <div className="space-y-2">
      {step === "seen" && reactions.length > 0 && (
        <div className={dense ? "no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1 md:flex-wrap" : "flex flex-wrap gap-1.5"}>
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
      <div className={`grid ${dense ? "gap-1.5 md:gap-2" : "gap-2"} ${actions.length > 4 ? (dense ? "grid-cols-4 md:grid-cols-3" : "grid-cols-3") : actions.length === 4 && dense ? "grid-cols-4 md:grid-cols-2" : "grid-cols-2"}`}>{actions.map(([a, l], i) => btn(a, l, i + 1))}</div>
      {!cfg.singleStep && (
        <button className="text-xs text-muted hover:text-ink" onClick={() => setStep("ask")}>
          {T("← back")}</button>
      )}
    </div>
  );
}
