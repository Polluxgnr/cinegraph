import { effortOf, formatMinutes, timeOf } from "./recipe";
import type { Entity } from "./types";
/** Same normalisation as backend/cinegraph/textnorm.py, so matching behaves identically. */
const ARTICLES = ["the ", "a ", "an ", "le ", "la ", "les ", "l ", "un ", "une ", "el ", "il ", "lo ", "der ", "die ", "das "];
const ROMAN: [string, string][] = [[" ii", " 2"], [" iii", " 3"], [" iv", " 4"], [" v", " 5"]];

export function normTitle(s?: string | null): string {
  if (!s) return "";
  let t = s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  for (const a of ARTICLES) {
    if (t.startsWith(a) && t.length > a.length + 2) {
      t = t.slice(a.length);
      break;
    }
  }
  for (const [k, v] of ROMAN) if (t.endsWith(k)) t = t.slice(0, -k.length) + v;
  return t;
}

export function fmtRuntime(min?: number | null): string {
  if (!min) return "";
  const h = Math.floor(min / 60);
  return h ? `${h}h${String(min % 60).padStart(2, "0")}` : `${min} min`;
}

export const LANG_NAMES: Record<string, string> = {
  en: "English", fr: "Français", ko: "한국어 (Korean)", ja: "日本語 (Japanese)", es: "Español", de: "Deutsch",
  it: "Italiano", he: "עברית (Hebrew)", da: "Dansk", sv: "Svenska", no: "Norsk", zh: "中文 (Chinese)",
  hi: "हिन्दी (Hindi)", pt: "Português", ru: "Русский", tr: "Türkçe", pl: "Polski", nl: "Nederlands",
};

/** 1234567 -> "1.2M", 45200 -> "45k". */
export function compact(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1).replace(/\.0$/, "")}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1e4) return `${Math.round(n / 1e3)}k`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
}

/** Price in euros, "≈ €250k" style for big numbers. */
export function fmtPrice(eur?: number | null, approx = false): string {
  if (!eur) return "";
  const v = eur >= 1e6 ? `€${(eur / 1e6).toFixed(1).replace(/\.0$/, "")}M` : eur >= 1e4 ? `€${Math.round(eur / 1e3)}k` : `€${Math.round(eur).toLocaleString("fr-FR")}`;
  return approx ? `≈ ${v}` : v;
}

const num = (x: unknown) => (typeof x === "number" && x > 0 ? x : 0);

/** Length of anything watchable, in minutes (films, series episodes, videos). */
export function minutesOf(e: { film?: { rt?: number }; item?: { meta?: Record<string, unknown> } }): number {
  return e.film?.rt ?? num(e.item?.meta?.minutes);
}

/** The few numbers people judge a thing by: length, views, likes, comments for videos; price for cars and clothes. */
export function itemFacts(e: { domain: string; item?: { meta?: Record<string, unknown> } }): string[] {
  const m = e.item?.meta ?? {};
  const out: string[] = [];
  if (num(m.minutes)) out.push(fmtRuntime(num(m.minutes)));
  if (num(m.views)) out.push(`${compact(num(m.views))} views`);
  if (num(m.likes)) out.push(`${compact(num(m.likes))} 👍`);
  if (num(m.comments)) out.push(`${compact(num(m.comments))} 💬`);
  if (typeof m.engine === "string") out.push(m.engine.replace(/ (petrol|diesel)$/i, ""));
  if (num(m.hp)) out.push(`${num(m.hp)} hp`);
  if (e.domain === "recipes" && Array.isArray(m.ingredients)) {
    const r = e as unknown as Entity;
    const t = timeOf(r);
    if (t) out.push(`⏱ ${formatMinutes(t)}`);
    out.push(effortOf(r));
  }
  if (num(m.price)) {
    const p = fmtPrice(num(m.price), m.price_approx === true);
    out.push(m.kind === "brand" ? `pieces around ${p}` : m.price_kind === "from" ? `from ${p}` : m.price_kind === "market" ? `${p} (market)` : m.price_kind === "new" ? `${p} new` : p);
  }
  return out;
}

/** Useful places to go next for anything, by space (searches only: no tracking, no affiliate). */
export function exploreLinks(e: { domain: string; title: string; subtitle: string; film?: { y?: number; k?: string } }): Record<string, string> {
  const q = (s: string) => encodeURIComponent(s);
  const t = e.title;
  switch (e.domain) {
    case "films":
      return {
        "Reviews (SensCritique)": `https://www.senscritique.com/search?query=${q(t)}`,
        "Where to watch (JustWatch)": `https://www.justwatch.com/fr/recherche?q=${q(t)}`,
        "Behind the scenes": `https://www.youtube.com/results?search_query=${q(`${t} ${e.film?.y ?? ""} behind the scenes`)}`,
        "Soundtrack": `https://open.spotify.com/search/${q(`${t} soundtrack`)}`,
      };
    case "music":
      return {
        Spotify: `https://open.spotify.com/search/${q(t)}`,
        "YouTube (live)": `https://www.youtube.com/results?search_query=${q(`${t} live`)}`,
        "Concerts near me": `https://www.songkick.com/search?query=${q(t)}`,
        Wikipedia: `https://en.wikipedia.org/wiki/Special:Search?search=${q(`${t} musician`)}`,
        Genius: `https://genius.com/search?q=${q(t)}`,
      };
    case "places":
      return {
        "Flights from Paris": `https://www.google.com/travel/flights?q=${q(`flights from Paris to ${t}`)}`,
        Stays: `https://www.airbnb.fr/s/${q(t)}/homes`,
        "Best time to go": `https://www.google.com/search?q=${q(`best time to visit ${t}`)}`,
        "Videos": `https://www.youtube.com/results?search_query=${q(`${t} travel guide 4k`)}`,
      };
    case "cars":
      return {
        "Video reviews": `https://www.youtube.com/results?search_query=${q(`${t} review`)}`,
        "For sale (La Centrale)": `https://www.lacentrale.fr/listing?makesModelsCommercialNames=&searchText=${q(t)}`,
        "For sale (AutoScout24)": `https://www.autoscout24.fr/lst?search=${q(t)}`,
        "Sound": `https://www.youtube.com/results?search_query=${q(`${t} exhaust sound`)}`,
      };
    case "brands":
      return {
        Instagram: `https://www.instagram.com/explore/search/keyword/?q=${q(t)}`,
        "Lookbook": `https://www.google.com/search?tbm=isch&q=${q(`${t} lookbook`)}`,
        Grailed: `https://www.grailed.com/shop?query=${q(t)}`,
        "Fit pics": `https://www.pinterest.com/search/pins/?q=${q(`${t} outfit`)}`,
      };
    case "recipes":
      return {
        Marmiton: `https://www.marmiton.org/recettes/recherche.aspx?aqt=${q(t)}`,
        "Video": `https://www.youtube.com/results?search_query=${q(`${t} recipe`)}`,
      };
    case "youtube":
      return { [`More from ${e.subtitle}`]: `https://www.youtube.com/results?search_query=${q(e.subtitle)}` };
    default:
      return {};
  }
}

/** The crowd's rating out of 10: IMDb (official dataset, by far the most votes) when it has enough votes, else TMDB. */
export function crowdRating(f?: { ir?: number; ic?: number; va?: number; vc?: number }): { v: number; n: number; src: "IMDb" | "TMDB" } | null {
  if (!f) return null;
  if (f.ir && (f.ic ?? 0) >= 50) return { v: f.ir, n: f.ic!, src: "IMDb" };
  if (f.va && (f.vc ?? 0) >= 20) return { v: f.va, n: f.vc!, src: "TMDB" };
  return null;
}
