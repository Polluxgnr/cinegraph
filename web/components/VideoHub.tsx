"use client";

import { useMemo, useState } from "react";
import RecCard, { Row } from "@/components/RecCard";
import type { DomainData } from "@/lib/data";
import { VIDEO_THEMES, videoThemes } from "@/lib/facets";
import { useT } from "@/lib/i18n";
import { getState, setSettings, useStore } from "@/lib/store";
import type { Entity } from "@/lib/types";
import { useRecs } from "@/lib/useRecs";

export const channelOf = (e: Entity) => (typeof e.item?.meta?.channel === "string" ? (e.item.meta.channel as string) : e.subtitle);

/** Channels you subscribed to here, plus your YouTube account's subscriptions when it is connected. */
export function useSubs(): Set<string> {
  const mine = useStore((s) => s.settings.ytSubs);
  const imported = useStore((s) => s.imports["youtube-live"]?.channels ?? s.imports.youtube?.channels);
  return useMemo(() => new Set([...(mine ?? []), ...(imported ?? []).map((c) => c.name)].map((n) => n.toLowerCase())), [mine, imported]);
}

export function toggleSub(name: string) {
  const cur = getState().settings.ytSubs ?? [];
  setSettings({ ytSubs: cur.includes(name) ? cur.filter((x) => x !== name) : [...cur, name] });
}

/** Newest videos from the channels you follow, newest first. */
export function SubscriptionsRow({ d }: { d: DomainData }) {
  const T = useT();
  const subs = useSubs();
  const recs = useRecs(d, { n: 40, explore: 0, includeListed: true, noCaps: true, filter: (e) => subs.has(channelOf(e).toLowerCase()) }, `subs|${[...subs].join(",")}`);
  if (!subs.size) return null;
  const list = [...(recs ?? [])].sort((a, b) => (b.entity.date ?? "").localeCompare(a.entity.date ?? "")).slice(0, 16);
  if (!list.length) return null;
  return <Row title={T("From your subscriptions")} hint={T("newest first")}>{list.map((r) => <RecCard key={r.entity.key} r={r} showWhy={false} />)}</Row>;
}

/** Browse by category: documentaries, science, AI, gaming, entertainment... best match first. */
export function VideoCategories({ d }: { d: DomainData }) {
  const T = useT();
  const counts = useMemo(() => {
    const c = new Map<string, number>();
    for (const e of d.entities) for (const t of videoThemes(e)) c.set(t, (c.get(t) ?? 0) + 1);
    return c;
  }, [d]);
  const cats = VIDEO_THEMES.map(([n]) => n).filter((n) => counts.get(n));
  const [cat, setCat] = useState<string>(cats[0] ?? "");
  const recs = useRecs(d, { n: 18, explore: 0.05, includeListed: true, filter: (e) => videoThemes(e).includes(cat) }, `cat|${cat}`);
  if (!cats.length) return null;
  return (
    <section data-testid="video-categories">
      <h2 className="mb-3 font-display text-3xl">{T("Categories")}</h2>
      <div className="no-scrollbar -mx-4 mb-3 flex gap-1.5 overflow-x-auto px-4">
        {cats.map((n) => <button key={n} className="chip shrink-0" data-on={cat === n} onClick={() => setCat(n)}>{T(n)} <span className="text-muted">{counts.get(n)}</span></button>)}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">{(recs ?? []).map((r) => <RecCard key={r.entity.key} r={r} showWhy={false} />)}</div>
    </section>
  );
}

/** Every channel in the catalogue, by category, with a subscribe button. */
export function Channels({ d }: { d: DomainData }) {
  const T = useT();
  const subs = useSubs();
  const mine = useStore((s) => s.settings.ytSubs ?? []);
  const [open, setOpen] = useState(false);
  const [cat, setCat] = useState<string | null>(null);
  const channels = useMemo(() => {
    const m = new Map<string, { name: string; n: number; cats: Set<string>; latest?: string; image?: string }>();
    for (const e of d.entities) {
      const name = channelOf(e);
      if (!name) continue;
      const c = m.get(name) ?? { name, n: 0, cats: new Set<string>() };
      c.n++;
      videoThemes(e).forEach((t) => c.cats.add(t));
      if (!c.latest || (e.date ?? "") > c.latest) { c.latest = e.date; c.image = e.image; }
      m.set(name, c);
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [d]);
  const shown = channels.filter((c) => !cat || c.cats.has(cat));
  return (
    <section data-testid="channels">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-3xl">{T("Channels")}</h2>
        <button className="btn-ghost px-3 py-1.5 text-sm" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? T("Close") : T("Manage subscriptions ({n})", { n: subs.size })}
        </button>
      </div>
      {open && (
        <>
          <div className="no-scrollbar -mx-4 mb-3 flex gap-1.5 overflow-x-auto px-4">
            <button className="chip shrink-0 text-xs" data-on={!cat} onClick={() => setCat(null)}>{T("All")} <span className="text-muted">{channels.length}</span></button>
            {VIDEO_THEMES.map(([n]) => n).filter((n) => channels.some((c) => c.cats.has(n))).map((n) => (
              <button key={n} className="chip shrink-0 text-xs" data-on={cat === n} onClick={() => setCat(cat === n ? null : n)}>{T(n)}</button>
            ))}
          </div>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((c) => {
              const on = subs.has(c.name.toLowerCase());
              const fromAccount = on && !mine.includes(c.name);
              return (
                <li key={c.name} className="card flex min-w-0 items-center gap-3 p-2.5">
                  {/* eslint-disable-next-line @next/next/no-img-element -- latest video thumbnail */}
                  {c.image ? <img src={c.image} alt="" className="h-10 w-16 shrink-0 rounded object-cover" loading="lazy" /> : <span className="h-10 w-16 shrink-0 rounded bg-panel-2" />}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{c.name}</span>
                    <span className="block truncate text-[11px] text-muted">{c.n} {T("videos")} · {[...c.cats].slice(0, 2).map((x) => T(x)).join(", ")}</span>
                  </span>
                  <button className={`shrink-0 ${on ? "btn px-3 py-1 text-xs" : "btn-ghost px-3 py-1 text-xs"}`} disabled={fromAccount} title={fromAccount ? T("Subscribed on your YouTube account") : undefined}
                          onClick={() => toggleSub(c.name)} data-testid="subscribe">
                    {on ? `✓ ${T("Subscribed")}` : T("Subscribe")}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
