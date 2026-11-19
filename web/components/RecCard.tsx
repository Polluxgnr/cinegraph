"use client";

import Link from "next/link";
import { useState } from "react";
import EntityImage from "@/components/EntityImage";
import Match from "@/components/Match";
import { DOMAIN } from "@/lib/domains";
import { answer } from "@/lib/engine/learn";
import type { Rec } from "@/lib/engine/recommend";
import { type Action, setList, useStore } from "@/lib/store";
import { fmtRuntime, itemFacts } from "@/lib/text";
import { tilt } from "@/lib/tilt";
import { streamsOn } from "@/lib/watch";

export function detailHref(key: string) {
  return `/item/?k=${encodeURIComponent(key)}`;
}

export default function RecCard({ r, showWhy = true }: { r: Rec; showWhy?: boolean }) {
  const e = r.entity;
  const cfg = DOMAIN[e.domain];
  const listed = useStore((s) => s.lists[e.key]?.status);
  const [why, setWhy] = useState(false);
  const answered = useStore((s) => s.feedback[e.key]?.action);
  const platforms = useStore((s) => s.settings.platforms);
  const f = e.film;
  const meta = f
    ? [f.k === "tv" ? "Series" : "Film", f.y, f.k === "tv" ? (f.ns ? `${f.ns} season${f.ns === 1 ? "" : "s"}` : "") : fmtRuntime(f.rt), f.lang?.toUpperCase()]
    : [e.subtitle, ...itemFacts(e)];
  const streams = f ? streamsOn(f, platforms) : [];

  if (answered === "never" || answered === "disliked" || answered === "dropped") return null;
  return (
    <article className="group card flex flex-col overflow-hidden">
      <Link href={detailHref(e.key)} className="tilt relative block overflow-hidden" {...tilt}>
        <EntityImage e={e} aspect={cfg?.aspect ?? "2/3"} className="transition duration-500 group-hover:scale-[1.03]" />
        {r.explore && <span className="absolute left-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-[10px] uppercase tracking-wider text-unseen">exploring</span>}
        {streams.length > 0 && (
          <span className="absolute bottom-2 left-2 rounded-full bg-black/75 px-2 py-0.5 text-[11px] text-ink">{streams.join(" · ")}</span>
        )}
      </Link>
      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <Link href={detailHref(e.key)} className="line-clamp-2 font-semibold leading-snug hover:text-accent">
          {e.title}
        </Link>
        <p className="line-clamp-2 text-xs text-muted">{meta.filter(Boolean).join(" · ")}</p>
        <Match p={r.p} stars={r.stars} compact />
        {showWhy && <p className="line-clamp-3 text-[13px] leading-snug text-ink/85">{r.why}</p>}
        <div className="mt-auto flex gap-2 pt-1">
          <button
            onClick={() => (listed ? setList(e.key, e.domain, null) : answer(e.key, e.domain, "want", { source: "card" }))}
            className="btn-ghost flex-1 whitespace-nowrap px-2 py-1.5 text-xs"
            title={listed ? "Remove from my list" : "Add to my list"}
          >
            {listed ? "✓ Listed" : "+ List"}
          </button>
          <button onClick={() => setWhy(!why)} className="btn-ghost px-2 py-1.5 text-xs text-muted" title="Not for me" aria-expanded={why}>
            ✕
          </button>
        </div>
        {why && <NotForMe onPick={(a, chip) => answer(e.key, e.domain, a, { source: "card", chips: chip ? [chip] : undefined })} film={!!f} />}
      </div>
    </article>
  );
}

/** "Not for me because…": one tap, and the reason teaches the model something specific. */
export const NOT_FOR_ME: [string, Action, string | undefined][] = [
  ["Not my genre", "never", "Not my genre"],
  ["Too long", "never", "Too long"],
  ["Seen it, didn't like it", "disliked", undefined],
  ["Not in the mood", "later", undefined],
  ["Just not for me", "never", undefined],
];

function NotForMe({ onPick, film }: { onPick: (a: Action, chip?: string) => void; film: boolean }) {
  return (
    <div className="mt-1 flex flex-wrap gap-1" role="group" aria-label="Why not?">
      {NOT_FOR_ME.filter(([l]) => film || l !== "Too long").map(([label, a, chip]) => (
        <button key={label} className="chip text-[11px]" onClick={() => onPick(a, chip)}>{label}</button>
      ))}
    </div>
  );
}

export function Progress({ value, label, className = "" }: { value: number; label?: string; className?: string }) {
  return (
    <div className={className}>
      {label && <div className="mb-1 flex justify-between text-xs text-muted"><span>{label}</span><span>{Math.round(value * 100)}%</span></div>}
      <div className="h-1.5 overflow-hidden rounded-full bg-panel-2">
        <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${Math.max(2, value * 100)}%` }} />
      </div>
    </div>
  );
}

export function Row({ title, href, children, hint }: { title: string; href?: string; children: React.ReactNode; hint?: string }) {
  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl md:text-3xl">{title}</h2>
          {hint && <p className="text-xs text-muted">{hint}</p>}
        </div>
        {href && <Link href={href} className="shrink-0 text-sm text-accent">See all →</Link>}
      </div>
      <div className="stagger no-scrollbar -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 [&>*]:w-40 [&>*]:shrink-0 [&>*]:snap-start sm:[&>*]:w-48">{children}</div>
    </section>
  );
}
