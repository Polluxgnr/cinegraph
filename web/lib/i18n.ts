"use client";
/**
 * English / French interface. Strings are written in English in the code and looked up in the French
 * dictionary (lib/i18n.fr.ts) when the interface language is French; a missing entry falls back to English, so
 * nothing ever renders blank. "{name}" placeholders are filled from `vars`.
 * Language: Settings → Appearance, else the browser language (fr* → French).
 */
import { FR } from "./i18n.fr";
import { useSyncExternalStore } from "react";
import { getState, useStore } from "./store";

export type Lang = "en" | "fr";

export function browserLang(): Lang {
  if (typeof navigator === "undefined") return "en";
  return (navigator.languages?.[0] ?? navigator.language ?? "en").toLowerCase().startsWith("fr") ? "fr" : "en";
}

export function currentLang(): Lang {
  return getState().settings.uiLang ?? browserLang();
}

export function translate(lang: Lang, en: string, vars?: Record<string, string | number>): string {
  let s = lang === "fr" ? FR[en] ?? en : en;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

/** Outside React (engine explanations, exports). */
export const t = (en: string, vars?: Record<string, string | number>) => translate(currentLang(), en, vars);

const noop = () => () => {};
/** False while React hydrates the pre-rendered (English) HTML, true right after. */
function useHydrated(): boolean {
  return useSyncExternalStore(noop, () => true, () => false);
}

/**
 * In components: re-renders when the language changes. The static pages are pre-rendered in English, so the
 * first (hydration) render stays English and the interface language applies on the next one: no mismatch.
 */
export function useT() {
  const chosen = useStore((s) => s.settings.uiLang);
  const hydrated = useHydrated();
  const lang: Lang = hydrated ? (chosen ?? browserLang()) : "en";
  return Object.assign((en: string, vars?: Record<string, string | number>) => translate(lang, en, vars), { lang });
}

/** Synopsis in the interface language (TMDB French synopsis when there is one). */
export function filmOverview(f: { ov?: string; ovf?: string }, lang: Lang = currentLang()): string | undefined {
  return lang === "fr" && f.ovf ? f.ovf : f.ov;
}

/** Title in the interface language (TMDB French title when there is one). */
export function filmTitle(f: { t: string; tf?: string }, lang: Lang = currentLang()): string {
  return lang === "fr" && f.tf ? f.tf : f.t;
}

/** An item's description in the interface language (places carry a French one from Wikidata). */
export function itemDescription(meta: Record<string, unknown> | undefined, lang: Lang = currentLang()): string | undefined {
  const fr = meta?.description_fr;
  const d = lang === "fr" && typeof fr === "string" ? fr : meta?.description;
  return typeof d === "string" ? d : undefined;
}
