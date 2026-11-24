/**
 * Reading a recipe's free text: allergens, effort and time, steps, and quantities you can scale.
 * TheMealDB gives ingredient lines ("800g Black Eyed Peas", "1/2 tsp Salt") and one block of instructions.
 */
import type { Entity } from "./types";

export const ingredientsOf = (e: Entity): string[] => (e.item?.meta?.ingredients as string[] | undefined) ?? [];
export const instructionsOf = (e: Entity): string => String(e.item?.meta?.instructions ?? "");

// ------------------------------------------------------------------ allergens
export const ALLERGENS = ["gluten", "dairy", "eggs", "nuts", "peanuts", "fish", "shellfish", "sesame", "soy"] as const;
export type Allergen = (typeof ALLERGENS)[number];

const A: Record<Allergen, RegExp> = {
  gluten: /\b(?<!(?:gluten[- ]free|rice|corn|almond|chickpea|gram|buckwheat|coconut|tapioca|potato) )(flour|bread|breadcrumbs|panko|pasta|spaghetti|penne|linguine|tagliatelle|lasagne|macaroni|fettuccine|noodles|couscous|bulgur|semolina|barley|rye|wheat|pastry|tortillas?|pitta|pita|naan|brioche|biscuits?|digestives?|crackers|baguette|ciabatta|croissants?|soy sauce|beer|seitan)\b/i,
  dairy: /\b(?<!(?:coconut|almond|oat|soy|soya|rice|peanut|cashew|cocoa|shea|vegan|plant) )(milk|butter|cream|cheese|parmesan|mozzarella|cheddar|feta|ricotta|mascarpone|gruy[eè]re|brie|camembert|halloumi|paneer|yogh?urt|ghee|cr[eè]me fra[iî]che|custard|condensed milk)\b/i,
  eggs: /\b(eggs?|egg yolks?|egg whites?|mayonnaise|meringue)\b/i,
  nuts: /\b(almonds?|walnuts?|cashews?|pistachios?|hazelnuts?|pecans?|pine nuts|macadamia|brazil nuts?|praline|marzipan|frangipane|nutella)\b/i,
  peanuts: /\b(peanuts?|peanut butter|satay)\b/i,
  fish: /\b(fish|salmon|tuna|cod|haddock|mackerel|sardines?|anchov(y|ies)|trout|sea bass|monkfish|halibut|plaice|sole|pollock|fish sauce|worcestershire)\b/i,
  shellfish: /\b(prawns?|shrimps?|crab|lobster|mussels|clams|oysters?|scallops?|squid|octopus|crayfish|langoustines?|oyster sauce)\b/i,
  sesame: /\b(sesame|tahini|halva)\b/i,
  soy: /\b(soy|soya|tofu|tempeh|edamame|miso|tamari)\b/i,
};

export function allergensOf(e: Entity): Allergen[] {
  const ing = ingredientsOf(e).join(" | ");
  return ALLERGENS.filter((a) => A[a].test(ing));
}

export const ALLERGEN_ICON: Record<Allergen, string> = { gluten: "🌾", dairy: "🥛", eggs: "🥚", nuts: "🌰", peanuts: "🥜", fish: "🐟", shellfish: "🦐", sesame: "⚪", soy: "🫘" };

// ------------------------------------------------------------------ steps and time
/** Steps: numbered "step 1" blocks, else paragraphs, else sentences grouped in twos. */
export function stepsOf(text: string): string[] {
  const t = text.replace(/\r/g, "").trim();
  if (!t) return [];
  const byLabel = t.split(/\n?\s*(?:step\s*\d+|STEP\s*\d+)[:.)]?\s*\n?/i).map((s) => s.trim()).filter((s) => s.length > 2);
  if (byLabel.length > 1) return byLabel;
  const numbered = t.split(/\n\s*\d{1,2}[.)]\s+/).map((s) => s.replace(/^\d{1,2}[.)]\s+/, "").trim()).filter(Boolean);
  if (numbered.length > 1) return numbered;
  const paras = t.split(/\n+/).map((s) => s.trim()).filter((s) => s.length > 2);
  if (paras.length > 1) return paras;
  const sentences = t.match(/[^.!?]+[.!?]+/g) ?? [t];
  const out: string[] = [];
  for (let i = 0; i < sentences.length; i += 2) out.push(sentences.slice(i, i + 2).join(" ").trim());
  return out;
}

/** Durations written in a step, in minutes ("10 minutes", "1-2 hours", "1 hr 30 mins", "45 secs"). */
export function durationsIn(step: string): number[] {
  const out: number[] = [];
  const re = /(\d+(?:[.,]\d+)?)(?:\s*(?:-|–|to)\s*(\d+(?:[.,]\d+)?))?\s*(hours?|hrs?|h\b|minutes?|mins?|seconds?|secs?)/gi;
  for (const m of step.matchAll(re)) {
    const v = parseFloat((m[2] ?? m[1]).replace(",", "."));
    const u = m[3].toLowerCase();
    out.push(u.startsWith("h") ? v * 60 : u.startsWith("s") ? v / 60 : v);
  }
  return out;
}

const PASSIVE = /\b(marinat\w*|overnight|chill\w*|refrigerat\w*|fridge|freez\w*|soak\w*|rest(?:ing)?|prove|proof\w*|rise|set aside|cool\w*|leave)\b/i;

/** Waiting time you don't spend at the stove (marinating, chilling, proving), in minutes. */
export function restOf(e: Entity): number {
  return stepsOf(instructionsOf(e)).reduce((s, st) => s + (PASSIVE.test(st) ? Math.max(0, ...durationsIn(st).filter((m) => m >= 30)) : 0), 0);
}

/** Rough hands-on time: the largest duration of each step (steps often repeat one), long waits left out, plus prep per ingredient. */
export function timeOf(e: Entity): number | undefined {
  const steps = stepsOf(instructionsOf(e));
  if (!steps.length) return undefined;
  const cook = steps.reduce((s, st) => {
    const ds = durationsIn(st).filter((m) => !(PASSIVE.test(st) && m >= 30));
    return s + Math.max(0, ...ds);
  }, 0);
  const prep = Math.min(30, 2 * ingredientsOf(e).length);
  return Math.round((cook + prep) / 5) * 5 || undefined;
}

export type Effort = "Easy" | "Medium" | "Involved";
export function effortOf(e: Entity): Effort {
  const n = ingredientsOf(e).length;
  const s = stepsOf(instructionsOf(e)).length;
  const t = timeOf(e) ?? 0;
  const score = n / 8 + s / 6 + t / 90;
  return score < 2.2 ? "Easy" : score < 3.6 ? "Medium" : "Involved";
}

export function formatMinutes(m: number): string {
  if (m < 60) return `${Math.round(m)} min`;
  const h = Math.floor(m / 60), r = Math.round(m % 60);
  return r ? `${h} h ${String(r).padStart(2, "0")}` : `${h} h`;
}

// ------------------------------------------------------------------ quantities
const FRACTIONS: Record<string, number> = { "½": 0.5, "¼": 0.25, "¾": 0.75, "⅓": 1 / 3, "⅔": 2 / 3, "⅛": 0.125 };

function parseAmount(s: string): number | undefined {
  s = s.trim();
  const uni = s.match(/^(\d+)?\s*([½¼¾⅓⅔⅛])$/);
  if (uni) return (uni[1] ? +uni[1] : 0) + FRACTIONS[uni[2]];
  const mixed = s.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return +mixed[1] + +mixed[2] / +mixed[3];
  const frac = s.match(/^(\d+)\/(\d+)$/);
  if (frac) return +frac[1] / +frac[2];
  const n = parseFloat(s.replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
}

function formatAmount(v: number): string {
  if (v >= 10) return String(Math.round(v));
  const whole = Math.floor(v), rest = v - whole;
  const near = [[0, ""], [0.125, "⅛"], [0.25, "¼"], [1 / 3, "⅓"], [0.5, "½"], [2 / 3, "⅔"], [0.75, "¾"], [1, ""]] as const;
  let best: (typeof near)[number] = near[0];
  for (const x of near) if (Math.abs(rest - x[0]) < Math.abs(rest - best[0])) best = x;
  if (Math.abs(rest - best[0]) > 0.07) return String(Math.round(v * 10) / 10);
  const w = whole + (best[0] === 1 ? 1 : 0);
  return best[1] ? `${w || ""}${best[1]}` : String(w);
}

/** "800g Black Eyed Peas" x2 -> "1600g Black Eyed Peas"; lines without a leading amount stay as they are. */
export function scaleLine(line: string, k: number): string {
  if (k === 1) return line;
  const m = line.match(/^\s*((?:\d+\s+)?\d+\/\d+|\d+(?:[.,]\d+)?(?:\s*[½¼¾⅓⅔⅛])?|[½¼¾⅓⅔⅛])(\s*(?:-|–|to)\s*(\d+(?:[.,]\d+)?))?/);
  if (!m) return line;
  const a = parseAmount(m[1]);
  if (a == null) return line;
  const hi = m[3] ? parseAmount(m[3]) : undefined;
  const scaled = formatAmount(a * k) + (hi != null ? `-${formatAmount(hi * k)}` : "");
  // keep grams and millilitres readable: 1500g -> 1.5kg
  const rest = line.slice(m[0].length);
  const g = rest.match(/^\s*(g|ml)\b/i);
  if (g && a * k >= 1000 && hi == null) return `${Math.round((a * k) / 10) / 100}${g[1].toLowerCase() === "g" ? "kg" : "l"}${rest.slice(g[0].length)}`;
  return scaled + rest;
}

// ------------------------------------------------------------------ fridge
const PLURAL = (w: string) => w.replace(/(ies)$/, "y").replace(/(oes|ses|shes|ches)$/, (x) => x.slice(0, -2)).replace(/s$/, "");

/** "chicken, lemon + rice" -> ["chicken", "lemon", "rice"] */
export const fridgeTerms = (q: string) => q.split(/[,+;&]| and | et /i).map((s) => s.trim().toLowerCase()).filter((s) => s.length > 1);

/** Which of your ingredients a recipe uses, and how many of its own it needs beyond those (staples left out). */
export function fridgeMatch(e: Entity, terms: string[]): { have: string[]; missing: string[] } {
  const lines = ingredientsOf(e).map((l) => l.toLowerCase());
  const have = terms.filter((t) => lines.some((l) => l.includes(t) || l.includes(PLURAL(t))));
  const STAPLE = /\b(salt|pepper|water|oil|olive oil|vegetable oil|sugar|butter|flour)\b/;
  const missing = ingredientsOf(e).filter((l) => !STAPLE.test(l.toLowerCase()) && !terms.some((t) => l.toLowerCase().includes(t) || l.toLowerCase().includes(PLURAL(t))));
  return { have, missing };
}
