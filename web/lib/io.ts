"use client";
/**
 * Import / export, all in the browser:
 * - Letterboxd export ZIP (ratings, diary, watched, watchlist, likes) matched on title + year
 * - JSON backup of your whole memory
 * - Obsidian vault export: one Markdown note per thing you love / saved, with YAML front-matter
 *   and [[wikilinks]] between people, sagas and titles, ready to drop into a second brain
 */
import JSZip from "jszip";
import { loadDomain, loadFilms, manifest } from "./data";
import { DOMAIN } from "./domains";
import { actionLabel } from "./domains";
import { getState, recordFeedback, update, type Action } from "./store";
import { normTitle } from "./text";
import type { Entity } from "./types";

function parseCSV(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const [head, ...body] = rows.filter((r) => r.some((x) => x.trim()));
  return body.map((r) => Object.fromEntries((head ?? []).map((h, i) => [h.replace(/^﻿/, ""), r[i] ?? ""])));
}

export interface ImportReport {
  matched: number;
  total: number;
  unmatched: string[];
}

export async function importLetterboxd(file: File): Promise<ImportReport> {
  const zip = await JSZip.loadAsync(file);
  const d = await loadFilms();
  const byTitle = new Map<string, Entity[]>();
  for (const e of d.entities) {
    for (const t of [e.title, e.film?.ot]) {
      const k = normTitle(t);
      if (k) byTitle.set(k, [...(byTitle.get(k) ?? []), e]);
    }
  }
  const find = (name: string, year: string): Entity | undefined => {
    const c = byTitle.get(normTitle(name)) ?? [];
    const y = +year;
    return c.find((e) => e.film?.y === y) ?? c.find((e) => Math.abs((e.film?.y ?? 0) - y) <= 1) ?? (y ? undefined : c[0]);
  };
  const read = async (name: string) => {
    const f = Object.values(zip.files).find((z) => z.name.toLowerCase().endsWith(name) && !/deleted|orphan/i.test(z.name));
    return f ? parseCSV(await f.async("string")) : [];
  };
  const rep: ImportReport = { matched: 0, total: 0, unmatched: [] };
  const apply = (rows: Record<string, string>[], action: (r: Record<string, string>) => { action: Action; rating?: number }) => {
    for (const r of rows) {
      rep.total++;
      const e = find(r.Name, r.Year);
      if (!e) {
        rep.unmatched.push(`${r.Name} (${r.Year})`);
        continue;
      }
      rep.matched++;
      const a = action(r);
      recordFeedback({ key: e.key, domain: "films", ...a, source: "letterboxd", at: Date.parse(r.Date) || Date.now() });
    }
  };
  apply(await read("watched.csv"), () => ({ action: "liked" }));
  apply(await read("ratings.csv"), (r) => {
    const rating = parseFloat(r.Rating);
    return { action: rating >= 4.5 ? "loved" : rating >= 3.5 ? "liked" : rating >= 2.5 ? "ok" : "disliked", rating };
  });
  apply(await read("likes/films.csv"), () => ({ action: "loved" }));
  apply(await read("watchlist.csv"), () => ({ action: "want" }));
  return rep;
}

export function downloadBlob(name: string, blob: Blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function backupJSON() {
  const s = { ...getState(), settings: { ...getState().settings, gistToken: undefined, anthropicKey: undefined } };
  downloadBlob(`cinegraph-memory-${new Date().toISOString().slice(0, 10)}.json`, new Blob([JSON.stringify(s)], { type: "application/json" }));
}

export async function restoreJSON(file: File) {
  const s = JSON.parse(await file.text());
  const keep = getState().settings;
  update((st) => Object.assign(st, s, { settings: { ...s.settings, gistToken: keep.gistToken, anthropicKey: keep.anthropicKey } }));
}

const slug = (s: string) => s.replace(/[\\/:*?"<>|#^[\]]/g, "").trim().slice(0, 120);

/** Obsidian vault: Taste/<Domain>/<Title>.md + People/ + Sagas/ + Vault/ + an index note. */
export async function exportObsidian() {
  const s = getState();
  const zip = new JSZip();
  const root = zip.folder("CineGraph")!;
  const m = await manifest();
  const index: string[] = ["# CineGraph — my taste", "", `Exported ${new Date().toISOString().slice(0, 10)}.`, ""];
  for (const name of Object.keys(m.domains)) {
    const d = await loadDomain(name).catch(() => null);
    if (!d) continue;
    const answers = Object.values(s.feedback).filter((f) => f.domain === name && f.action !== "unknown" && f.action !== "never");
    if (!answers.length) continue;
    const folder = root.folder(`Taste/${DOMAIN[name]?.label ?? name}`)!;
    index.push(`## ${DOMAIN[name]?.label ?? name}`, "");
    for (const f of answers.sort((a, b) => b.at - a.at)) {
      const row = d.index.get(f.key);
      if (row == null) continue;
      const e = d.entities[row];
      const fm = [
        "---", `type: ${name}`, `status: "${actionLabel(name, f.action)}"`, f.rating ? `rating: ${f.rating}` : "",
        `date: ${new Date(f.at).toISOString().slice(0, 10)}`, `tags: [${e.tags.slice(0, 6).map((t) => JSON.stringify(t)).join(", ")}]`,
        e.image ? `cover: ${e.image}` : "", "---",
      ].filter(Boolean);
      const body = [`# ${e.title}`, "", e.subtitle, ""];
      if (e.image) body.push(`![](${e.image})`, "");
      if (e.film) {
        const fl = e.film;
        const people = (ids?: number[]) => (ids ?? []).map((i) => `[[${slug((d as Awaited<ReturnType<typeof loadFilms>>).people[i])}]]`).join(", ");
        if (fl.ov) body.push(fl.ov, "");
        if (fl.dir?.length) body.push(`**Director**: ${people(fl.dir)}`);
        if (fl.cre?.length) body.push(`**Created by**: ${people(fl.cre)}`);
        if (fl.cast?.length) body.push(`**Cast**: ${people(fl.cast.slice(0, 8))}`);
        if (fl.coll) body.push(`**Saga**: [[${slug((d as Awaited<ReturnType<typeof loadFilms>>).collectionOf.get(fl.coll)?.name ?? fl.coll)}]]`);
        if (f.chips?.length) body.push(`**My notes**: ${f.chips.join(", ")}`);
        for (const [k, v] of Object.entries(fl.links ?? {})) body.push(`- [${k}](${v})`);
      } else if (e.item) {
        if (e.item.url) body.push(`[Open](${e.item.url})`);
        for (const [k, v] of Object.entries(e.item.links ?? {})) body.push(`- [${k}](${v})`);
      }
      folder.file(`${slug(e.title)}.md`, [...fm, "", ...body].join("\n"));
      index.push(`- [[${slug(e.title)}]] — ${actionLabel(name, f.action)}`);
    }
    index.push("");
  }
  if (s.vault.length) {
    const v = root.folder("Vault")!;
    index.push("## Vault", "");
    for (const it of s.vault) {
      v.file(`${slug(it.title)}.md`, ["---", `created: ${new Date(it.created).toISOString().slice(0, 10)}`,
        `tags: [${it.tags.map((t) => JSON.stringify(t)).join(", ")}]`, it.url ? `source: ${it.url}` : "", "---", "",
        `# ${it.title}`, "", it.note ?? "", it.url ? `\n[Source](${it.url})` : ""].filter((x) => x !== "").join("\n"));
      index.push(`- [[${slug(it.title)}]]`);
    }
  }
  root.file("CineGraph index.md", index.join("\n"));
  downloadBlob("cinegraph-obsidian.zip", await zip.generateAsync({ type: "blob" }));
}
