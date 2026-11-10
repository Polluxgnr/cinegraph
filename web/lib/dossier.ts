"use client";
/**
 * The taste dossier: everything CineGraph knows about your taste, as one Markdown document
 * written for an AI assistant (or for you). Paste it into a chat to get advice that knows you.
 */
import { loadSpace } from "./custom";
import { manifest } from "./data";
import { actionLabel, DOMAIN, DOMAINS } from "./domains";
import { summarise, summaryText } from "./engine/summary";
import { getState } from "./store";

export async function buildDossier(): Promise<string> {
  const s = getState();
  const m = await manifest();
  const out: string[] = [
    "# My taste profile (CineGraph)",
    "",
    `Generated ${new Date().toISOString().slice(0, 10)}. Answers are mine (loved / liked / ok / not my thing / want / never).`,
    "Use this to recommend things I'll like, explain why, and avoid what I dislike.",
    "",
  ];
  for (const cfg of DOMAINS) {
    if (cfg.name !== "films" && !m.domains[cfg.name]?.count) continue;
    const d = await loadSpace(cfg.name).catch(() => null);
    if (!d) continue;
    const fbs = Object.values(s.feedback).filter((f) => f.domain === cfg.name && f.action !== "unknown");
    if (!fbs.length) continue;
    const sum = summarise(d, s);
    out.push(`## ${cfg.label}`, "", summaryText(sum), "");
    if (sum.likedTags.length) out.push(`- Likes: ${sum.likedTags.map(([t]) => t).join(", ")}`);
    if (sum.dislikedTags.length) out.push(`- Dislikes: ${sum.dislikedTags.map(([t]) => t).join(", ")}`);
    if (sum.people.length) out.push(`- People: ${sum.people.map(([p]) => p).join(", ")}`);
    if (sum.languages.length) out.push(`- Original languages: ${sum.languages.map(([l]) => l).join(", ")}`);
    out.push("");
    const name = (key: string) => {
      const row = d.index.get(key);
      if (row == null) return null;
      const e = d.entities[row];
      const yr = e.film?.y ? ` (${e.film.y})` : "";
      return `${e.title}${yr}`;
    };
    const group = (title: string, actions: string[], n = 40) => {
      const items = fbs.filter((f) => actions.includes(f.action)).sort((a, b) => b.at - a.at).slice(0, n);
      const lines = items.map((f) => {
        const t = name(f.key);
        if (!t) return null;
        const extra = [f.rating ? `${f.rating}/5` : "", f.chips?.join(", ") ?? ""].filter(Boolean).join("; ");
        return `- ${t}${extra ? ` — ${extra}` : ""}`;
      }).filter(Boolean);
      if (lines.length) out.push(`### ${title}`, ...(lines as string[]), "");
    };
    group("Loved", ["loved"]);
    group("Liked", ["liked", "watching"]);
    group("Not for me", ["disliked", "never"], 25);
    group("Want to try", ["want", "maybe"], 30);
    const mine = s.custom.filter((c) => c.domain === cfg.name && c.note);
    if (mine.length) out.push("### My own notes", ...mine.map((c) => `- ${c.title}: ${c.note}${c.url ? ` (${c.url})` : ""}`), "");
  }
  const imp = Object.entries(s.imports);
  if (imp.length) out.push("## Imported history", ...imp.map(([k, v]) => `- ${k}: ${v.summary}`), "");
  if (s.imports.youtube?.channels?.length) out.push(`YouTube channels I watch most: ${s.imports.youtube.channels.slice(0, 20).map((c) => c.name).join(", ")}`, "");
  if (s.spotify?.topArtists?.length) out.push(`Spotify top artists: ${s.spotify.topArtists.slice(0, 30).map((a) => a.name).join(", ")}`, "");
  if (s.vault.length) {
    out.push("## Second brain (saved links & ideas)");
    for (const v of s.vault.slice(0, 80)) out.push(`- ${v.title}${v.url ? ` <${v.url}>` : ""}${v.note ? ` — ${v.note.replace(/\n/g, " ")}` : ""}${v.tags.length ? ` #${v.tags.join(" #")}` : ""}`);
    out.push("");
  }
  return out.join("\n");
}

export const domainLabel = (d: string) => DOMAIN[d]?.label ?? d;
export { actionLabel };
