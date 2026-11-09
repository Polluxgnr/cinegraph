/** Human-readable taste summaries: what you like, how sure we are, and how well we predict you. */
import { isFilmData, type DomainData } from "../data";
import { ACTION_VALUE, type State } from "../store";
import { buildProfile } from "./profile";
import { DEFAULT_W, FEATURES, weights } from "./score";

export interface TasteSummary {
  domain: string;
  answers: number;
  loved: number;
  likedTags: [string, number][];
  dislikedTags: [string, number][];
  people: [string, number][];
  languages: [string, number][];
  decades: [string, number][];
  runtime?: number;
  accuracy: number | null; // share of answers where the model guessed the right side
  learnedSignals: [string, number][]; // what the ranker learned to weigh more than default
  axes: { label: [string, string]; value: number }[]; // -1..1 "taste DNA"
}

const AXES: { label: [string, string]; neg: string[]; pos: string[] }[] = [
  { label: ["Light", "Dark"], neg: ["comedy", "family", "animation", "music"], pos: ["thriller", "horror", "crime", "war"] },
  { label: ["Visceral", "Cerebral"], neg: ["action", "adventure", "horror"], pos: ["mystery", "science fiction", "documentary", "history"] },
  { label: ["Grounded", "Escapist"], neg: ["documentary", "history", "drama", "crime"], pos: ["fantasy", "science fiction", "animation", "adventure"] },
];

const LANG: Record<string, string> = {
  en: "English", fr: "French", ko: "Korean", ja: "Japanese", es: "Spanish", de: "German", it: "Italian",
  he: "Hebrew", da: "Danish", sv: "Swedish", no: "Norwegian", zh: "Chinese", hi: "Hindi", pt: "Portuguese",
};

export function summarise(d: DomainData, s: State): TasteSummary {
  const p = buildProfile(d, s);
  const tags = [...p.tagAff.entries()].filter(([t]) => t.length > 2);
  const likedTags = tags.filter(([, v]) => v > 0.1).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const dislikedTags = tags.filter(([, v]) => v < -0.1).sort((a, b) => a[1] - b[1]).slice(0, 6);

  const fbs = Object.values(s.feedback).filter((f) => f.domain === d.name);
  const judged = fbs.filter((f) => f.predicted != null && ACTION_VALUE[f.action] != null && f.action !== "ok");
  const right = judged.filter((f) => (f.predicted! > 0.5) === ((ACTION_VALUE[f.action] ?? 0) > 0)).length;

  const w = weights(s.learned.ranker[d.name]);
  const learnedSignals = FEATURES.map((f, i) => [f, w[i] - DEFAULT_W[i]] as [string, number])
    .filter(([f, v]) => f !== "bias" && Math.abs(v) > 0.05)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, 5);

  const axes = AXES.map((ax) => {
    let v = 0;
    for (const t of ax.pos) v += p.tagAff.get(t) ?? 0;
    for (const t of ax.neg) v -= p.tagAff.get(t) ?? 0;
    return { label: ax.label, value: Math.max(-1, Math.min(1, v * 1.5)) };
  });

  const out: TasteSummary = {
    domain: d.name,
    answers: fbs.length,
    loved: fbs.filter((f) => f.action === "loved").length,
    likedTags,
    dislikedTags,
    people: [],
    languages: [],
    decades: [],
    accuracy: judged.length >= 5 ? right / judged.length : null,
    learnedSignals,
    axes,
  };
  if (isFilmData(d)) {
    out.people = [...(p.people ?? new Map()).entries()]
      .filter(([, v]) => v > 0.2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([pid, v]) => [d.people[pid], v]);
    out.languages = [...(p.lang ?? new Map()).entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([l, v]) => [LANG[l] ?? l, v]);
    out.decades = [...(p.decade ?? new Map()).entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([dec, v]) => [`${dec}s`, v]);
    out.runtime = p.runtimePref?.mean;
  }
  return out;
}

export function summaryText(t: TasteSummary): string {
  const parts: string[] = [];
  if (t.likedTags.length) parts.push(`You lean towards ${t.likedTags.slice(0, 4).map(([x]) => x).join(", ")}`);
  if (t.dislikedTags.length) parts.push(`and away from ${t.dislikedTags.slice(0, 3).map(([x]) => x).join(", ")}`);
  let s = parts.join(" ") + (parts.length ? "." : "");
  if (t.people.length) s += ` Names that keep coming back: ${t.people.slice(0, 3).map(([x]) => x).join(", ")}.`;
  if (t.languages.length > 1) s += ` In original version you favour ${t.languages[0][0]}.`;
  if (t.runtime) s += ` Your sweet spot is around ${Math.round(t.runtime)} minutes.`;
  return s || "Answer a few cards and your taste profile will appear here.";
}
