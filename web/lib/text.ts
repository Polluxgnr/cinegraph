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
