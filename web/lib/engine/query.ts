/** Natural-language search over films & series: AI parse when a key is set, regex parse otherwise. */
import type { FilmData } from "../data";
import { aiEnabled, type Intent, parseQueryAI } from "../ai";
import { normTitle } from "../text";
import type { State } from "../store";
import type { Entity } from "../types";
import { platformOf } from "../watch";
import { recommend, type Rec } from "./recommend";

export const MOODS: Record<string, { label: string; genres: string[]; keywords: string[] }> = {
  tense: { label: "Tense", genres: ["Thriller", "Crime", "War", "Mystery", "Action & Adventure"], keywords: ["suspense", "conspiracy", "heist", "spy", "survival", "serial killer", "investigation", "hostage"] },
  laugh: { label: "Laugh", genres: ["Comedy"], keywords: ["dark comedy", "black comedy", "satire", "parody", "absurd", "mockumentary"] },
  mind: { label: "Mind-bending", genres: ["Science Fiction", "Mystery", "Sci-Fi & Fantasy"], keywords: ["time travel", "twist ending", "plot twist", "nonlinear timeline", "dream", "parallel universe", "simulation", "psychological", "thought-provoking"] },
  horror: { label: "Horror", genres: ["Horror"], keywords: ["supernatural", "haunted house", "ghost", "slasher"] },
  epic: { label: "Epic", genres: ["War", "History", "Adventure", "Fantasy", "Western"], keywords: ["epic", "battle", "empire", "saga", "space opera", "quest"] },
};

export function moodMatch(e: Entity, mood: string): number {
  const m = MOODS[mood];
  const f = e.film;
  if (!m || !f) return 0;
  const g = (f.g ?? []).some((x) => m.genres.includes(x));
  const k = (f.kw ?? []).filter((x) => m.keywords.includes(x.toLowerCase())).length;
  if ((mood === "laugh" || mood === "horror") && !g) return 0;
  return (g ? 0.6 : 0) + Math.min(k, 3) * 0.2;
}

const MOOD_WORDS: Record<string, string[]> = {
  laugh: ["funnier", "funny", "comedy", "drôle", "drole", "marrant", "humour", "rire", "laugh"],
  horror: ["horror", "scary", "horreur", "peur", "flippant"],
  tense: ["tense", "thriller", "suspense", "gripping", "haletant", "tendu"],
  mind: ["mind", "twist", "cerebral", "trippy", "retourne", "cerveau"],
  epic: ["epic", "épique", "epique", "saga"],
};

export function ruleParse(q: string): Intent {
  const low = q.toLowerCase();
  const it: Intent = { anchors: [], kind: "any", mood: null, maxRuntime: null, platforms: [], genres: [], excludeGenres: [], minYear: null, maxYear: null, language: null, vibe: q };
  const m = q.match(/(?:like|comme|similar to|à la|a la|genre|style)\s+(.+?)(?=\s+(?:but|mais|with|avec|under|moins|on|sur|in|en|from|des|that|qui)\b|[,;.!?]|$)/i);
  if (m) it.anchors.push(m[1].trim().replace(/^["'«»]|["'«»]$/g, ""));
  const r = low.match(/(?:under|less than|moins de|max|<)\s*(\d+(?:[.,]\d+)?)\s*(h|hours?|heures?|min|minutes?|mn)?/);
  if (r) {
    const v = parseFloat(r[1].replace(",", "."));
    const unit = r[2] ?? (v <= 5 ? "h" : "min");
    it.maxRuntime = unit.startsWith("h") ? Math.round(v * 60) : Math.round(v);
  }
  if (/\b(series|série|séries|serie|show|tv)\b/.test(low)) it.kind = "tv";
  else if (/\b(film|movie|films|movies)\b/.test(low)) it.kind = "movie";
  for (const [mood, words] of Object.entries(MOOD_WORDS)) if (words.some((w) => low.includes(w))) {
    it.mood = mood as Intent["mood"];
    break;
  }
  for (const [name, re] of [["Netflix", /netflix/], ["Prime Video", /prime|amazon/], ["Disney+", /disney/], ["HBO Max", /\bhbo\b|\bmax\b/], ["Canal+", /canal/], ["Apple TV+", /apple/], ["arte.tv", /\barte\b/], ["france.tv", /france\.?tv/]] as const) {
    if (re.test(low)) it.platforms.push(name);
  }
  const after = low.match(/\b(?:after|après|since|depuis)\s+(\d{4})/);
  if (after) it.minYear = +after[1];
  const before = low.match(/\b(?:before|avant)\s+(\d{4})/);
  if (before) it.maxYear = +before[1];
  for (const [l, re] of [["ko", /kor[eé]|cor[eé]en/], ["ja", /japan|japon/], ["fr", /fran[cç]ais|french/], ["es", /spanish|espagnol/], ["it", /italian|italien/], ["de", /german|allemand/]] as const) {
    if (re.test(low)) it.language = l;
  }
  return it;
}

export interface QueryResult {
  intent: Intent;
  parser: "ai" | "rules";
  anchors: Entity[];
  items: Rec[];
  notes: string[];
}

export async function runQuery(d: FilmData, s: State, q: string, n = 12): Promise<QueryResult> {
  let intent: Intent | null = null;
  let parser: "ai" | "rules" = "rules";
  if (aiEnabled()) {
    try {
      intent = await parseQueryAI(q);
      if (intent) parser = "ai";
    } catch {
      intent = null;
    }
  }
  intent ??= ruleParse(q);
  const notes: string[] = [];
  const anchors = intent.anchors
    .map((a) => d.entities.find((e) => normTitle(e.title) === normTitle(a) || normTitle(e.film?.ot) === normTitle(a)))
    .filter((e): e is Entity => !!e);
  let kind = intent.kind;
  if (kind === "any" && anchors[0]?.film) kind = anchors[0].film.k;
  const hasProviders = d.films.some((f) => f.prov?.length);
  let platforms = intent.platforms;
  if (platforms.length && !hasProviders) {
    platforms = [];
    notes.push("No streaming data yet (needs the TMDB crawl), so the platform filter was ignored.");
  }
  const boost = new Map<string, number>();
  if (anchors.length && d.emb) {
    const rows = anchors.map((a) => d.index.get(a.key)!);
    for (let i = 0; i < d.entities.length; i++) {
      let s2 = 0;
      for (const r of rows) {
        const v = d.emb.row(r);
        s2 += d.emb.dot(i, v) / d.norms[i];
      }
      boost.set(d.entities[i].key, 2.5 * (s2 / rows.length));
    }
  }
  const vibeWords = intent.vibe.toLowerCase().split(/\W+/).filter((w) => w.length > 4);
  const items = recommend(d, s, {
    n,
    explore: 0,
    includeListed: true,
    boost,
    filter: (e) => {
      const f = e.film!;
      if (anchors.some((a) => a.key === e.key)) return false;
      if (kind !== "any" && f.k !== kind) return false;
      if (intent!.maxRuntime && f.rt && f.rt > intent!.maxRuntime) return false;
      if (intent!.minYear && (f.y ?? 0) < intent!.minYear) return false;
      if (intent!.maxYear && (f.y ?? 9999) > intent!.maxYear) return false;
      if (intent!.language && f.lang !== intent!.language) return false;
      if (intent!.genres.length && !(f.g ?? []).some((g) => intent!.genres.includes(g))) return false;
      if ((f.g ?? []).some((g) => intent!.excludeGenres.includes(g))) return false;
      if (intent!.mood && moodMatch(e, intent!.mood) <= 0) return false;
      if (platforms.length && !(f.prov ?? []).some((p) => platforms.includes(platformOf(p) ?? ""))) return false;
      if (!anchors.length && !intent!.mood && vibeWords.length) {
        const text = `${f.ov ?? ""} ${(f.kw ?? []).join(" ")}`.toLowerCase();
        return vibeWords.some((w) => text.includes(w));
      }
      return true;
    },
  });
  if (anchors.length) for (const it of items) it.why = `Close to ${anchors[0].title} · ${it.why}`;
  return { intent, parser, anchors, items, notes };
}
