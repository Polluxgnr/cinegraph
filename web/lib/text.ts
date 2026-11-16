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
  if (num(m.price)) {
    const p = fmtPrice(num(m.price), m.price_approx === true);
    out.push(m.price_kind === "from" ? `from ${p}` : m.price_kind === "market" ? `${p} (market)` : m.price_kind === "new" ? `${p} new` : p);
  }
  return out;
}
