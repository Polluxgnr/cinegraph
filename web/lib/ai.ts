"use client";
/**
 * Optional AI layer (Claude). Runs in your browser with *your* API key, stored only in this
 * browser and never synced. Without a key everything still works with rule-based fallbacks.
 *
 * - parseQuery: free text ("like Fauda but funnier, under 2h, on Netflix") -> structured intent
 * - tastePortrait: a short written portrait of your taste across all domains
 */
import Anthropic from "@anthropic-ai/sdk";
import { getState } from "./store";

const MODEL = "claude-opus-5-5";

export function aiEnabled(): boolean {
  return !!getState().settings.anthropicKey;
}

function client(): Anthropic {
  const key = getState().settings.anthropicKey;
  if (!key) throw new Error("No Anthropic API key in Settings");
  return new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
}

async function json<T>(system: string, user: string, schema: Record<string, unknown>, maxTokens = 4000): Promise<T | null> {
  try {
    const res = await client().beta.messages.create({
      model: getState().settings.anthropicModel || MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
      thinking: { type: "adaptive" },
      output_config: { effort: "low", format: { type: "json_schema", schema } },
      // if a safety classifier declines, the API retries on a fallback model server-side
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    if (res.stop_reason === "refusal" || res.stop_reason === "max_tokens") return null;
    const text = res.content.find((b) => b.type === "text");
    return text && text.type === "text" ? (JSON.parse(text.text) as T) : null;
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new Error("Anthropic rejected the API key");
    if (e instanceof Anthropic.RateLimitError) throw new Error("Anthropic rate limit, try again in a minute");
    if (e instanceof Anthropic.APIError) throw new Error(`Anthropic error ${e.status ?? ""}`);
    throw e;
  }
}

export interface Intent {
  anchors: string[];
  kind: "movie" | "tv" | "any";
  mood: "tense" | "laugh" | "mind" | "horror" | "epic" | null;
  maxRuntime: number | null;
  platforms: string[];
  genres: string[];
  excludeGenres: string[];
  minYear: number | null;
  maxYear: number | null;
  language: string | null; // original language wanted (ISO 639-1)
  vibe: string;
}

const INTENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["anchors", "kind", "mood", "maxRuntime", "platforms", "genres", "excludeGenres", "minYear", "maxYear", "language", "vibe"],
  properties: {
    anchors: { type: "array", items: { type: "string" } },
    kind: { type: "string", enum: ["movie", "tv", "any"] },
    mood: { type: ["string", "null"], enum: ["tense", "laugh", "mind", "horror", "epic", null] },
    maxRuntime: { type: ["integer", "null"] },
    platforms: { type: "array", items: { type: "string", enum: ["Netflix", "Prime Video", "Disney+", "HBO Max", "Canal+", "Apple TV+", "arte.tv", "france.tv"] } },
    genres: { type: "array", items: { type: "string" } },
    excludeGenres: { type: "array", items: { type: "string" } },
    minYear: { type: ["integer", "null"] },
    maxYear: { type: ["integer", "null"] },
    language: { type: ["string", "null"] },
    vibe: { type: "string" },
  },
};

export async function parseQueryAI(q: string): Promise<Intent | null> {
  return json<Intent>(
    `Turn a film/series request into search filters. anchors = titles compared to ("like X").
kind only if restricted. mood one of tense|laugh|mind|horror|epic if implied ("funnier" -> laugh).
maxRuntime in minutes ("under 2h" -> 120; for series it means episode length). Genres use TMDB names.
language = original language if asked ("in Korean" -> "ko"). vibe = one English sentence for semantic search.`,
    q,
    INTENT_SCHEMA,
  );
}

export async function tastePortrait(facts: string): Promise<string | null> {
  const r = await json<{ portrait: string; suggestions: string[] }>(
    "You write a warm, specific, non-flattering portrait of one person's taste from data about their likes " +
      "and dislikes across films, series, videos, music, food, travel, cars and style. 120-180 words, second " +
      "person, in French. Name concrete patterns and tensions; no generic praise. Then 3 short, concrete " +
      "suggestions of things to try that stretch their taste a little.",
    facts,
    {
      type: "object",
      additionalProperties: false,
      required: ["portrait", "suggestions"],
      properties: { portrait: { type: "string" }, suggestions: { type: "array", items: { type: "string" } } },
    },
    6000,
  );
  return r ? `${r.portrait}\n\n${r.suggestions.map((s) => `• ${s}`).join("\n")}` : null;
}
