/**
 * Filters for the swipe deck (films & series): type, decade, length, crowd rating, original language,
 * genres, your streaming services. Stored in settings so they follow you across devices.
 */
import { crowdRating } from "../text";
import type { Entity } from "../types";
import { platformOf } from "../watch";

export interface SwipeFilters {
  kind?: "movie" | "tv";
  decades?: number[]; // 1970 = "before 1980", else the decade's first year
  maxRt?: number; // minutes (episode length for series)
  minRating?: number; // crowd rating out of 10 (IMDb, else TMDB)
  lang?: "en" | "fr" | "other";
  genres?: string[]; // any of these
  mine?: boolean; // on my streaming services (or free)
}

export const DECADES = [1970, 1980, 1990, 2000, 2010, 2020];

export function activeFilters(f?: SwipeFilters): number {
  if (!f) return 0;
  return [f.kind, f.decades?.length, f.maxRt, f.minRating, f.lang, f.genres?.length, f.mine].filter(Boolean).length;
}

/** A predicate for the deck, or undefined when nothing is filtered. Non-film entities always pass. */
export function swipeMatcher(f: SwipeFilters | undefined, platforms: string[]): ((e: Entity) => boolean) | undefined {
  if (!activeFilters(f)) return undefined;
  const F = f!;
  return (e) => {
    const x = e.film;
    if (!x) return true;
    if (F.kind && x.k !== F.kind) return false;
    if (F.decades?.length) {
      if (!x.y) return false;
      const dec = x.y < 1980 ? 1970 : Math.floor(x.y / 10) * 10;
      if (!F.decades.includes(dec)) return false;
    }
    if (F.maxRt && (!x.rt || x.rt > F.maxRt)) return false;
    if (F.minRating && (crowdRating(x)?.v ?? 0) < F.minRating) return false;
    if (F.lang === "other" ? x.lang === "en" || x.lang === "fr" : F.lang && x.lang !== F.lang) return false;
    if (F.genres?.length && !(x.g ?? []).some((g) => F.genres!.includes(g))) return false;
    if (F.mine && !(x.prov ?? []).some((p) => {
      const q = platformOf(p);
      return !!q && (platforms.includes(q) || q === "arte.tv" || q === "france.tv");
    })) return false;
    return true;
  };
}
