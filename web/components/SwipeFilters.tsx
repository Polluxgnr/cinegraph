"use client";

import { AnimatePresence, motion } from "motion/react";
import { type ReactNode, useMemo, useState } from "react";
import type { FilmData } from "@/lib/data";
import { activeFilters, DECADES, type SwipeFilters } from "@/lib/engine/swipeFilter";
import { useT } from "@/lib/i18n";
import { setSettings, useStore } from "@/lib/store";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] uppercase tracking-[0.14em] text-muted">{label}</p>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return <button className="chip text-xs" data-on={on} onClick={onClick}>{children}</button>;
}

/** "Filters" button + panel above the films & series deck. Changes apply to the next card. */
export default function SwipeFiltersBar({ d }: { d: FilmData }) {
  const T = useT();
  const stored = useStore((s) => s.settings.swipeFilters);
  const f: SwipeFilters = stored ?? {};
  const [open, setOpen] = useState(false);
  const n = activeFilters(f);
  const genres = useMemo(() => {
    const c = new Map<string, number>();
    for (const e of d.entities) for (const g of e.film?.g ?? []) c.set(g, (c.get(g) ?? 0) + 1);
    return [...c].sort((a, b) => b[1] - a[1]).slice(0, 16).map(([g]) => g);
  }, [d]);
  const set = (patch: Partial<SwipeFilters>) => setSettings({ swipeFilters: { ...f, ...patch } });
  const toggleDecade = (y: number) => {
    const cur = f.decades ?? [];
    set({ decades: cur.includes(y) ? cur.filter((x) => x !== y) : [...cur, y] });
  };
  const toggleGenre = (g: string) => {
    const cur = f.genres ?? [];
    set({ genres: cur.includes(g) ? cur.filter((x) => x !== g) : [...cur, g] });
  };
  const lengths: [number | undefined, string][] = [[undefined, T("Any length")], [100, "≤ 1h40"], [120, "≤ 2h"], [150, "≤ 2h30"]];
  const ratings: [number | undefined, string][] = [[undefined, T("Any")], [6, "6+"], [7, "7+"], [7.5, "7.5+"], [8, "8+"]];
  const langs: [SwipeFilters["lang"], string][] = [[undefined, T("Any")], ["en", "English"], ["fr", "Français"], ["other", T("Other languages")]];

  return (
    <div>
      <div className="flex items-center gap-2">
        <button className="chip text-xs" data-on={n > 0} onClick={() => setOpen(!open)} aria-expanded={open} data-testid="swipe-filters">
          ⚙ {T("Filters")}{n ? ` · ${n}` : ""}
        </button>
        {n > 0 && <button className="text-xs text-muted hover:text-ink" onClick={() => setSettings({ swipeFilters: {} })}>{T("Reset")}</button>}
      </div>
      <AnimatePresence initial={false}>
        {open && (
          // opens over the card (positioned against the deck header) so the answer buttons never move
          <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }}
                      className="absolute inset-x-0 top-full mt-2">
            <div className="card max-h-[60dvh] space-y-3 overflow-y-auto p-3 shadow-2xl shadow-black/50">
              <div className="flex justify-end"><button className="text-xs text-muted hover:text-ink" onClick={() => setOpen(false)}>{T("Done")}</button></div>
              <Row label={T("Type")}>
                <Chip on={!f.kind} onClick={() => set({ kind: undefined })}>{T("All")}</Chip>
                <Chip on={f.kind === "movie"} onClick={() => set({ kind: "movie" })}>{T("Films")}</Chip>
                <Chip on={f.kind === "tv"} onClick={() => set({ kind: "tv" })}>{T("Series")}</Chip>
              </Row>
              <Row label={T("Decades")}>
                {DECADES.map((y) => (
                  <Chip key={y} on={!!f.decades?.includes(y)} onClick={() => toggleDecade(y)}>{y === 1970 ? T("Before 1980") : `${String(y).slice(2)}s`}</Chip>
                ))}
              </Row>
              <Row label={T("Length")}>
                {lengths.map(([v, l]) => <Chip key={String(v)} on={f.maxRt === v} onClick={() => set({ maxRt: v })}>{l}</Chip>)}
              </Row>
              <Row label={T("Rating (IMDb, out of 10)")}>
                {ratings.map(([v, l]) => <Chip key={String(v)} on={f.minRating === v} onClick={() => set({ minRating: v })}>{l}</Chip>)}
              </Row>
              <Row label={T("Original language")}>
                {langs.map(([v, l]) => <Chip key={String(v)} on={f.lang === v} onClick={() => set({ lang: v })}>{l}</Chip>)}
              </Row>
              <Row label={T("Genres (any of)")}>
                {genres.map((g) => <Chip key={g} on={!!f.genres?.includes(g)} onClick={() => toggleGenre(g)}>{T(g)}</Chip>)}
              </Row>
              <Row label={T("Where")}>
                <Chip on={!f.mine} onClick={() => set({ mine: undefined })}>{T("Anywhere")}</Chip>
                <Chip on={!!f.mine} onClick={() => set({ mine: true })}>{T("My platforms only")}</Chip>
              </Row>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
