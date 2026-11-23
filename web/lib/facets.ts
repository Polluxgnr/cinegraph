/**
 * Extra facets for the non-film spaces, computed from the data already shipped:
 * - videos: themes (nature, geopolitics, history, science…) from channel/topic tags, and a viewer score /10;
 * - recipes: cuisine, main ingredient, vegetarian / vegan, ingredient search, variations.
 */
import type { Entity } from "./types";

// ------------------------------------------------------------------ videos
export const VIDEO_THEMES: [string, RegExp][] = [
  ["Nature & animals", /\b(nature|wildlife|animals?|biology|ocean|planet|earth)\b/i],
  ["Geopolitics", /\b(geopolitics|politics|war|international|investigation|news|reportage)\b/i],
  ["History", /\b(history|archaeology|histoire)\b/i],
  ["Science", /\b(science|physics|space|astronomy|maths?|chemistry|medicine|climate)\b/i],
  ["Tech & engineering", /\b(tech|engineering|programming|architecture|energy|ai)\b/i],
  ["Economics & money", /\b(economics|finance|business)\b/i],
  ["Society & culture", /\b(society|culture|explainers|linguistics|interview|travel)\b/i],
  ["Music & concerts", /\b(music|live|concert|underground)\b/i],
];

export function videoThemes(e: Entity): string[] {
  const hay = `${e.tags.join(" ")} ${e.subtitle}`;
  return VIDEO_THEMES.filter(([, re]) => re.test(hay)).map(([n]) => n);
}

/**
 * How much viewers liked it, out of 10: likes per view against the other videos, shrunk towards the median for
 * small audiences (40 likes on 200 views say less than 4,000 on 20,000). Undefined without enough views.
 */
const rateCache = new WeakMap<Entity[], number[]>();
export function videoScore(e: Entity, all: Entity[]): number | undefined {
  const views = Number(e.item?.meta?.views ?? 0);
  const likes = Number(e.item?.meta?.likes ?? 0);
  if (views < 300 || !likes) return undefined;
  let rates = rateCache.get(all);
  if (!rates) {
    rates = all.map((x) => Number(x.item?.meta?.likes ?? 0) / Math.max(1, Number(x.item?.meta?.views ?? 0))).filter((r) => r > 0 && r < 1).sort((a, b) => a - b);
    rateCache.set(all, rates);
  }
  if (!rates.length) return undefined;
  const median = rates[Math.floor(rates.length / 2)];
  const k = 2000; // views worth of prior
  const rate = (likes + median * k) / (views + k);
  let lo = 0;
  let hi = rates.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (rates[m] < rate) lo = m + 1;
    else hi = m;
  }
  // continuous percentile: interpolate between the two neighbouring rates
  const n = rates.length;
  const below = rates[lo - 1] ?? 0;
  const above = rates[lo] ?? rates[n - 1];
  const frac = above > below ? (rate - below) / (above - below) : 0;
  const pct = n > 1 ? Math.min(1, Math.max(0, (lo - 1 + frac) / (n - 1))) : 0.5;
  return Math.round((1 + pct * 9) * 10) / 10;
}

// ------------------------------------------------------------------ recipes
const ingredientsOf = (e: Entity): string[] => (e.item?.meta?.ingredients as string[] | undefined) ?? [];

export function cuisineOf(e: Entity): string | undefined {
  const a = e.item?.meta?.area as string | undefined;
  return a && a !== "Unknown" ? a : e.subtitle.includes(" · ") ? e.subtitle.split(" · ")[0] : undefined;
}

const MEAT = /\b(beef|steak|mince|veal|pork|bacon|ham|sausages?|chorizo|pancetta|prosciutto|salami|lamb|mutton|chicken|turkey|duck|goose|rabbit|venison|goat|liver|kidneys?|oxtail|gelatine)\b/i;
const FISH = /\b(fish|salmon|tuna|cod|haddock|mackerel|sardines?|anchov(y|ies)|prawns?|shrimps?|crab|lobster|mussels|clams|oysters|squid|octopus|scallops?|monkfish|trout|sea bass|fish sauce|oyster sauce)\b/i;
// dairy, eggs, honey; plant milks, creams and butters ("coconut milk", "peanut butter") don't count
const ANIMAL = /\b(?<!(?:coconut|almond|oat|soy|soya|rice|peanut|cashew|cocoa|shea|vegan|plant) )(milk|butter|cream|cheese|parmesan|mozzarella|cheddar|feta|yogurt|yoghurt|eggs?|egg yolks?|honey|ghee|mayonnaise|custard)\b/i;

export type Diet = "vegetarian" | "vegan";
export function dietOf(e: Entity): Diet | undefined {
  const ing = ingredientsOf(e).join(" | ");
  const cat = String(e.item?.meta?.category ?? e.subtitle);
  if (/vegan/i.test(cat) || (ing && !MEAT.test(ing) && !FISH.test(ing) && !ANIMAL.test(ing))) return ing || /vegan/i.test(cat) ? "vegan" : undefined;
  if (/vegetarian/i.test(cat) || (ing && !MEAT.test(ing) && !FISH.test(ing))) return "vegetarian";
  return undefined;
}

export const MAINS: [string, RegExp][] = [
  ["Beef", /\b(beef|steak|mince|veal|oxtail)\b/i],
  ["Chicken", /\bchicken\b/i],
  ["Pork", /\b(pork|bacon|ham|sausages?|chorizo|pancetta)\b/i],
  ["Lamb", /\b(lamb|mutton)\b/i],
  ["Fish & seafood", FISH],
  ["Pasta", /\b(pasta|spaghetti|penne|linguine|tagliatelle|lasagne|macaroni|noodles)\b/i],
  ["Rice", /\b(rice|risotto)\b/i],
  ["Eggs", /\beggs?\b/i],
];

/** The main ingredient families, from the category first, else the ingredient list. */
export function mainsOf(e: Entity): string[] {
  const cat = String(e.item?.meta?.category ?? "");
  const ing = ingredientsOf(e).join(" | ");
  return MAINS.filter(([n, re]) => re.test(cat) || (n !== "Eggs" && re.test(ing)) || (n === "Eggs" && /\b\d*\s*eggs?\b/i.test(ing) && !/yolk|glaze/i.test(ing))).map(([n]) => n);
}

/** Text to search recipes by ingredient ("lentils", "coconut milk"…). */
export const ingredientText = (e: Entity) => ingredientsOf(e).join(" ").toLowerCase();

/** Other takes on the same dish: shared dish words in the title, then shared ingredients (Jaccard). */
export function variations(e: Entity, all: Entity[], n = 10): Entity[] {
  const words = (s: string) => new Set(s.toLowerCase().replace(/[^a-zà-ÿ ]/g, " ").split(/\s+/).filter((w) => w.length > 3 && !STOP.has(w)));
  const tw = words(e.title);
  const ing = new Set(ingredientsOf(e).map(core).filter(Boolean));
  return all
    .filter((x) => x.domain === "recipes" && x.key !== e.key)
    .map((x) => {
      const xt = words(x.title);
      const shared = [...tw].filter((w) => xt.has(w)).length;
      const xi = new Set(ingredientsOf(x).map(core).filter(Boolean));
      const inter = [...ing].filter((i) => xi.has(i)).length;
      const jac = inter / Math.max(1, ing.size + xi.size - inter);
      return { x, s: shared * 0.6 + jac };
    })
    .filter((r) => r.s > 0.25)
    .sort((a, b) => b.s - a.s)
    .slice(0, n)
    .map((r) => r.x);
}
const STOP = new Set(["with", "and", "the", "style", "easy", "quick", "homemade", "classic", "recipe", "sauce", "avec"]);
/** "2 tablespoons chopped Coriander" -> "coriander" */
const core = (s: string) => s.toLowerCase().replace(/[\d/½¼¾.,()-]+/g, " ").replace(/\b(g|kg|ml|l|tbsp|tsp|tablespoons?|teaspoons?|cups?|clove|cloves|pinch|large|small|medium|chopped|sliced|diced|finely|fresh|freshly|ground|grated|minced|to taste|of|for|frying|juice|zest|handful|bunch|can|tin|pieces?|whole|beaten|softened|melted|optional|a|an)\b/g, " ").replace(/\s+/g, " ").trim();

// ------------------------------------------------------------------ dream garage
const num = (e: Entity, k: string) => {
  const v = Number(e.item?.meta?.[k]);
  return Number.isFinite(v) && v > 0 ? v : undefined;
};

export const ENGINES: [string, RegExp][] = [
  ["Electric", /electric/i],
  ["Hybrid", /hybrid/i],
  ["Rotary", /rotor|wankel|rotary/i],
  ["V12+", /\b(V12|W16|V16)\b/i],
  ["V10", /\bV10\b/i],
  ["V8", /\bV8\b/i],
  ["V6", /\bV6\b/i],
  ["Flat-6", /flat-6|boxer/i],
  ["Inline-6", /inline-6|straight-6/i],
  ["4 cylinders or less", /inline-4|inline-5|twin-cylinder|flat-4|inline-3/i],
];
/** Engine families of a car (a hybrid V12 is both "Hybrid" and "V12+"). */
export const engineOf = (e: Entity): string[] => {
  const s = String(e.item?.meta?.engine ?? "");
  return s ? ENGINES.filter(([, re]) => re.test(s)).map(([n]) => n) : [];
};

export const POWER: [string, number, number][] = [["< 300 hp", 0, 300], ["300–500 hp", 300, 500], ["500–700 hp", 500, 700], ["700–1,000 hp", 700, 1000], ["1,000 hp +", 1000, 1e9]];
export const hpOf = (e: Entity) => num(e, "hp");
export const seatsOf = (e: Entity) => num(e, "seats");
export const driveOf = (e: Entity) => (e.item?.meta?.drive as string | undefined) ?? undefined;

/** The spec line shown on a car's card and page. */
export function carSpecs(e: Entity): [string, string][] {
  const m = e.item?.meta ?? {};
  const out: [string, string][] = [];
  if (m.engine) out.push(["Engine", `${m.engine}${m.litres ? ` · ${m.litres} L` : ""}`]);
  if (m.hp) out.push(["Power", `${m.hp} hp${m.nm ? ` · ${m.nm} Nm` : ""}`]);
  if (m.zero100) out.push(["0–100 km/h", `${m.zero100} s`]);
  if (m.vmax) out.push(["Top speed", `${m.vmax} km/h`]);
  if (m.seats) out.push(["Seats", String(m.seats)]);
  if (m.drive) out.push(["Drive", `${m.drive}${m.gearbox ? ` · ${m.gearbox}` : ""}`]);
  if (m.body) out.push(["Body", String(m.body)]);
  return out;
}
