"use client";
import { useEffect, useState } from "react";
import type { DomainData } from "./data";
import { recommend, type RecOptions, type Rec } from "./engine/recommend";
import { getState, useLoaded, useStore } from "./store";

/** Results per (domain, query key, memory version): revisiting a page costs nothing. */
const cache = new Map<string, Rec[]>();
const MAX = 40;

/**
 * Recommendations that follow your memory (every answer), computed *after* the page paints so
 * navigation stays instant, and cached until something changes.
 */
export function useRecs(d: DomainData | null, opts: RecOptions, key = ""): Rec[] | null {
  const version = useStore((s) => s.updatedAt);
  const loaded = useLoaded();
  const id = d && loaded ? `${d.name}|${d.entities.length}|${key}|${version}` : null;
  const [state, setState] = useState<{ id: string | null; recs: Rec[] | null }>({ id: null, recs: null });

  useEffect(() => {
    if (!id || !d) return;
    if (cache.has(id)) return; // read from the cache during render, nothing to do
    let live = true;
    const t = setTimeout(() => {
      const recs = recommend(d, getState(), opts);
      cache.set(id, recs);
      if (cache.size > MAX) cache.delete(cache.keys().next().value!);
      if (live) setState({ id, recs });
    }, 0);
    return () => {
      live = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!id) return null;
  if (state.id === id) return state.recs;
  // while recomputing after an answer, keep showing the previous list (no flash)
  return cache.get(id) ?? (state.id?.startsWith(`${d!.name}|${d!.entities.length}|${key}|`) ? state.recs : null);
}
