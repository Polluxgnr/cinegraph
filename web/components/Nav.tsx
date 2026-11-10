"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { BASE } from "@/lib/data";
import { DOMAIN, DOMAINS } from "@/lib/domains";
import { useManifest } from "@/lib/hooks";
import { ACTION_VALUE, setSpace, useStore } from "@/lib/store";

/** Tabs inside the current space; some spaces have extra tools. */
export function spaceTabs(space: string): { href: string; label: string }[] {
  const base = [
    { href: "/", label: "Home" },
    { href: "/swipe/", label: "Swipe" },
    { href: "/discover/", label: "Discover" },
    { href: "/lists/", label: "My list" },
    { href: "/me/", label: "Taste" },
  ];
  if (space === "films") return [...base, { href: "/tonight/", label: "Tonight" }, { href: "/sagas/", label: "Sagas" }, { href: "/graph/", label: "Graph" }];
  return [...base, { href: "/add/", label: "+ Add" }];
}

const GLOBAL = [
  { href: "/vault/", label: "Second brain", icon: "M9 3a3 3 0 00-3 3v.5A3.5 3.5 0 004 13a3 3 0 002 5.2V18a3 3 0 006 0V5a2 2 0 00-3-2zm6 0a3 3 0 013 3v.5a3.5 3.5 0 012 6.5 3 3 0 01-2 5.2V18a3 3 0 01-6 0" },
  { href: "/import/", label: "Import & connect", icon: "M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" },
  { href: "/settings/", label: "Settings", icon: "M12 15a3 3 0 100-6 3 3 0 000 6zm7.4-3a7.4 7.4 0 00-.1-1.2l2-1.6-2-3.4-2.4 1a7.5 7.5 0 00-2-1.2L14.5 3h-5l-.4 2.6a7.5 7.5 0 00-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 000 2.4l-2 1.6 2 3.4 2.4-1a7.5 7.5 0 002 1.2l.4 2.6h5l.4-2.6a7.5 7.5 0 002-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z" },
];

function useCounts() {
  return useStore((s) => {
    const c: Record<string, number> = {};
    for (const f of Object.values(s.feedback)) if (ACTION_VALUE[f.action] != null) c[f.domain] = (c[f.domain] ?? 0) + 1;
    return c;
  });
}

export default function Nav() {
  const raw = usePathname();
  const path = raw.startsWith(BASE) ? raw.slice(BASE.length) || "/" : raw;
  const space = useStore((s) => s.settings.space);
  const m = useManifest().data;
  const counts = useCounts();
  const [sheet, setSheet] = useState(false);
  const spaces = DOMAINS.filter((d) => !m || d.name === "films" || m.domains[d.name]?.count);
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href.replace(/\/$/, "")));
  const cfg = DOMAIN[space] ?? DOMAINS[0];

  // each space has its own accent colour
  useEffect(() => {
    document.documentElement.dataset.space = space;
  }, [space]);

  return (
    <>
      {/* desktop: left sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-line/60 bg-bg/95 px-3 py-5 backdrop-blur md:flex">
        <Link href="/" className="mb-6 px-3 font-display text-3xl tracking-wide">
          Cine<span className="text-accent">Graph</span>
        </Link>
        <p className="mb-2 px-3 text-[11px] uppercase tracking-[0.18em] text-muted">Spaces</p>
        <SpaceList spaces={spaces} space={space} counts={counts} path={path} />
        <div className="mt-auto space-y-0.5 border-t border-line/60 pt-3">
          {GLOBAL.map((g) => (
            <Link key={g.href} href={g.href} className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm ${active(g.href) ? "bg-panel-2 text-ink" : "text-muted hover:text-ink"}`}>
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={g.icon} /></svg>
              {g.label}
            </Link>
          ))}
        </div>
      </aside>

      {/* desktop: tabs of the current space */}
      <header className="fixed left-64 right-0 top-0 z-20 hidden h-14 items-center gap-1 border-b border-line/60 bg-bg/85 px-6 backdrop-blur md:flex">
        <span className="mr-3 text-sm text-muted">{cfg.emoji} {cfg.label}</span>
        {spaceTabs(space).map((t) => (
          <Link key={t.href} href={t.href} className={`rounded-lg px-3 py-1.5 text-sm transition ${active(t.href) ? "bg-panel-2 text-ink" : "text-muted hover:text-ink"}`}>
            {t.label}
          </Link>
        ))}
      </header>

      {/* mobile: space switcher on top */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-line/60 bg-bg/90 px-4 py-2.5 backdrop-blur md:hidden">
        <Link href="/" className="font-display text-2xl">Cine<span className="text-accent">Graph</span></Link>
        <button onClick={() => setSheet(true)} className="flex items-center gap-2 rounded-full border border-line bg-panel px-3 py-1.5 text-sm">
          {cfg.emoji} {cfg.short} <span className="text-muted">▾</span>
        </button>
      </header>
      {sheet && (
        <div className="fixed inset-0 z-50 bg-black/60 md:hidden" onClick={() => setSheet(false)}>
          <div className="absolute inset-x-0 bottom-0 max-h-[80dvh] overflow-y-auto rounded-t-3xl border-t border-line bg-bg p-4" onClick={(e) => e.stopPropagation()}>
            <p className="mb-2 px-3 text-[11px] uppercase tracking-[0.18em] text-muted">Spaces</p>
            <SpaceList spaces={spaces} space={space} counts={counts} path={path} onPick={() => setSheet(false)} />
            <div className="mt-3 grid grid-cols-3 gap-2 border-t border-line pt-3">
              {GLOBAL.map((g) => <Link key={g.href} href={g.href} onClick={() => setSheet(false)} className="rounded-xl bg-panel p-3 text-center text-xs">{g.label}</Link>)}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {spaceTabs(space).slice(5).map((t) => <Link key={t.href} href={t.href} onClick={() => setSheet(false)} className="chip">{t.label}</Link>)}
            </div>
          </div>
        </div>
      )}

      {/* mobile: bottom tabs of the current space */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg/95 backdrop-blur md:hidden" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        <div className="grid grid-cols-5">
          {spaceTabs(space).slice(0, 5).map((t, i) => (
            <Link key={t.href} href={t.href} className={`flex flex-col items-center gap-1 py-2.5 text-[11px] ${active(t.href) ? "text-accent" : "text-muted"}`}>
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d={MOBILE_ICONS[i]} />
              </svg>
              {t.label}
            </Link>
          ))}
        </div>
      </nav>
    </>
  );
}

function SpaceList({ spaces, space, counts, path, onPick }: {
  spaces: typeof DOMAINS; space: string; counts: Record<string, number>; path: string; onPick?: () => void;
}) {
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href.replace(/\/$/, "")));
  // stay on the same tab when switching space (Swipe stays Swipe), else go to the space home
  const target = (name: string) => {
    const t = spaceTabs(name).find((x) => x.href !== "/" && active(x.href));
    return t ? t.href : "/";
  };
  return (
    <ul className="space-y-0.5">
      {spaces.map((d) => {
        const n = counts[d.name] ?? 0;
        return (
          <li key={d.name}>
            <Link
              href={target(d.name)}
              onClick={() => {
                setSpace(d.name);
                onPick?.();
              }}
              data-space={d.name}
              className={`group flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition ${d.name === space ? "bg-panel-2 text-ink" : "text-muted hover:bg-panel hover:text-ink"}`}
            >
              <span className="text-lg">{d.emoji}</span>
              <span className="flex-1">
                <span className="block leading-tight">{d.label}</span>
                <span className="mt-1 block h-1 overflow-hidden rounded-full bg-line/60">
                  <span className="block h-full rounded-full bg-[var(--space-accent)]" style={{ width: `${Math.min(100, Math.sqrt(n / 60) * 100)}%` }} />
                </span>
              </span>
              <span className="text-[11px] tabular-nums text-muted">{n || ""}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

const MOBILE_ICONS = [
  "M3 11l9-8 9 8v9a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1z",
  "M7 4h10a2 2 0 012 2v12a2 2 0 01-2 2H7a2 2 0 01-2-2V6a2 2 0 012-2zm-3 3v10M20 7v10",
  "M12 3a9 9 0 100 18 9 9 0 000-18zm3.5 5.5l-2 5-5 2 2-5z",
  "M6 3h12v18l-6-4-6 4z",
  "M12 12a4 4 0 100-8 4 4 0 000 8zm-7 9a7 7 0 0114 0",
];
