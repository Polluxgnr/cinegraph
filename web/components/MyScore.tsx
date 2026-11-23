"use client";

import Link from "next/link";
import { useState } from "react";
import { detailHref } from "@/components/RecCard";
import { personalScore, type MyScore as Score } from "@/lib/engine/myScore";
import { useFilms } from "@/lib/hooks";
import { useT } from "@/lib/i18n";
import { getState } from "@/lib/store";

/** "How well does it know me?": your own hidden favourites, found again or not. */
export default function MyScore() {
  const T = useT();
  const { data: d } = useFilms();
  const [res, setRes] = useState<Score | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  function run() {
    if (!d) return;
    setBusy(true);
    // a few seconds of maths: let the button repaint first
    setTimeout(() => {
      setRes(personalScore(d, getState()));
      setBusy(false);
    }, 30);
  }

  return (
    <section className="card space-y-3 p-5" data-testid="my-score">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-display text-2xl">{T("How well it knows you")}</h2>
          <p className="max-w-2xl text-xs text-muted">{T("One in five of the films you liked is hidden, your model is rebuilt from everything else in the order you answered, and we look for the hidden ones among your top 50 recommendations.")}</p>
        </div>
        <button className="btn px-3 py-1.5 text-sm" onClick={run} disabled={busy || !d}>{busy ? T("Measuring…") : res ? T("Measure again") : T("Measure")}</button>
      </div>
      {res === null && <p className="text-sm text-muted">{T("Like at least 15 films first: there's nothing to hide yet.")}</p>}
      {res && (
        <div className="space-y-2">
          <p className="text-lg">
            <b className="font-display text-3xl tabular-nums text-accent">{res.found.length}/{res.hidden}</b>{" "}
            {T("hidden favourites came back in your top 50")} <span className="text-sm text-muted">({Math.round(res.recall50 * 100)}%{res.hr10 ? ` · ${T("at least one in the top 10")}` : ""})</span>
          </p>
          <div className="h-2 overflow-hidden rounded-full bg-panel-2"><div className="h-full rounded-full bg-accent transition-all" style={{ width: `${Math.max(2, res.recall50 * 100)}%` }} /></div>
          {res.found.length > 0 && d && (
            <p className="text-xs text-muted">
              {T("Found")}: {res.found.map((x, i) => (
                <span key={x.key}>{i ? ", " : ""}<Link className="hover:text-accent" href={detailHref(x.key)}>{d.entities[d.index.get(x.key)!].title}</Link> (#{x.rank})</span>
              ))}
            </p>
          )}
          <p className="text-[11px] text-muted">{T("Random picks would find about {n} of them.", { n: ((50 / Math.max(1, d?.entities.length ?? 1)) * res.hidden).toFixed(2) })}</p>
        </div>
      )}
    </section>
  );
}
