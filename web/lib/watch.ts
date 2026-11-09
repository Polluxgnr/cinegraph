/** Legal places to watch: your subscriptions (TMDB/JustWatch data), free French broadcasters, search. */
import type { Film } from "./types";

const PLATFORM_SEARCH: Record<string, (q: string) => string> = {
  Netflix: (q) => `https://www.netflix.com/search?q=${q}`,
  "Prime Video": (q) => `https://www.primevideo.com/search/ref=atv_sr_sug?phrase=${q}`,
  "Disney+": (q) => `https://www.disneyplus.com/search?q=${q}`,
  "HBO Max": (q) => `https://play.hbomax.com/search?q=${q}`,
  "Canal+": (q) => `https://www.canalplus.com/recherche/?q=${q}`,
  "Apple TV+": (q) => `https://tv.apple.com/search?term=${q}`,
  "arte.tv": (q) => `https://www.arte.tv/fr/search/?q=${q}`,
  "france.tv": (q) => `https://www.france.tv/recherche/?q=${q}`,
};

/** TMDB provider names -> our platform names. */
export function platformOf(name: string): string | null {
  const n = name.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
  if (n.startsWith("netflix")) return "Netflix";
  if (n.includes("prime video")) return "Prime Video";
  if (n.startsWith("disney")) return "Disney+";
  if (n === "max" || n.includes("hbo max") || n.startsWith("max ")) return "HBO Max";
  if (n.startsWith("canal")) return "Canal+";
  if (n.startsWith("apple tv plus") || n === "apple tv+") return "Apple TV+";
  if (n.startsWith("arte")) return "arte.tv";
  if (n.includes("france.tv") || n.includes("france tv")) return "france.tv";
  return null;
}

export interface WatchOption {
  label: string;
  url: string;
  kind: "mine" | "free" | "other" | "find";
}

export function watchOptions(f: Film, mine: string[]): WatchOption[] {
  const q = encodeURIComponent(f.t);
  const out: WatchOption[] = [];
  const seen = new Set<string>();
  for (const p of f.prov ?? []) {
    const plat = platformOf(p);
    const key = plat ?? p;
    if (seen.has(key)) continue;
    seen.add(key);
    const free = plat === "arte.tv" || plat === "france.tv" || /pluto|tf1|m6|rakuten|ad-supported|free/i.test(p);
    const url = plat && PLATFORM_SEARCH[plat] ? PLATFORM_SEARCH[plat](q) : f.links?.justwatch ?? `https://www.justwatch.com/fr/recherche?q=${q}`;
    out.push({ label: plat ?? p, url, kind: plat && mine.includes(plat) ? "mine" : free ? "free" : "other" });
  }
  out.sort((a, b) => ["mine", "free", "other", "find"].indexOf(a.kind) - ["mine", "free", "other", "find"].indexOf(b.kind));
  out.push({ label: "All legal options (JustWatch)", url: f.links?.justwatch ?? `https://www.justwatch.com/fr/recherche?q=${q}`, kind: "find" });
  if (!(f.prov ?? []).some((p) => platformOf(p) === "arte.tv")) out.push({ label: "Search arte.tv (free)", url: PLATFORM_SEARCH["arte.tv"](q), kind: "find" });
  return out;
}

export function streamsOn(f: Film, mine: string[]): string[] {
  return [...new Set((f.prov ?? []).map(platformOf).filter((p): p is string => !!p && (mine.includes(p) || p === "arte.tv" || p === "france.tv")))];
}
