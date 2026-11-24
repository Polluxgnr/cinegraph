/**
 * The cars you're comparing, kept in this browser (up to four). Pages listen for "cinegraph:compare".
 */
import { useSyncExternalStore } from "react";

const KEY = "cinegraph:compare";
export const MAX_COMPARE = 4;

export function getCompare(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, MAX_COMPARE) : [];
  } catch {
    return [];
  }
}

export function setCompare(keys: string[]) {
  const v = [...new Set(keys)].slice(-MAX_COMPARE);
  try {
    localStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    /* private mode: the list lives for this page only */
  }
  window.dispatchEvent(new CustomEvent("cinegraph:compare", { detail: v }));
}

export function toggleCompare(key: string) {
  const cur = getCompare();
  setCompare(cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]);
}

let cache: { raw: string | null; v: string[] } = { raw: "", v: [] };
function snapshot(): string[] {
  let raw: string | null = null;
  try { raw = localStorage.getItem(KEY); } catch { /* private mode */ }
  if (raw !== cache.raw) cache = { raw, v: getCompare() };
  return cache.v;
}
const EMPTY: string[] = [];
function subscribe(cb: () => void) {
  window.addEventListener("cinegraph:compare", cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener("cinegraph:compare", cb);
    window.removeEventListener("storage", cb);
  };
}

export function useCompare(): string[] {
  return useSyncExternalStore(subscribe, snapshot, () => EMPTY);
}

/** Numbers to compare and which way is better. */
export const COMPARE_ROWS: { key: string; label: string; unit: string; better: "high" | "low" }[] = [
  { key: "hp", label: "Power", unit: "hp", better: "high" },
  { key: "nm", label: "Torque", unit: "Nm", better: "high" },
  { key: "zero100", label: "0–100 km/h", unit: "s", better: "low" },
  { key: "vmax", label: "Top speed", unit: "km/h", better: "high" },
  { key: "litres", label: "Displacement", unit: "L", better: "high" },
  { key: "cyl", label: "Cylinders", unit: "", better: "high" },
  { key: "seats", label: "Seats", unit: "", better: "high" },
  { key: "price", label: "Price", unit: "€", better: "low" },
];
