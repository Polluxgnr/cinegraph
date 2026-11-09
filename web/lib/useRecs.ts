"use client";
import { useMemo } from "react";
import type { DomainData } from "./data";
import { recommend, type RecOptions, type Rec } from "./engine/recommend";
import { getState, useLoaded, useStore } from "./store";

/** Recommendations that recompute whenever your memory changes (every answer). */
export function useRecs(d: DomainData | null, opts: RecOptions, key = ""): Rec[] | null {
  const version = useStore((s) => s.updatedAt);
  const loaded = useLoaded();
  return useMemo(() => {
    if (!d || !loaded) return null;
    return recommend(d, getState(), opts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d, loaded, version, key]);
}
