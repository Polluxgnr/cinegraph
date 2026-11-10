"use client";
/**
 * Importing your own history, from the official exports each service gives you:
 *  - YouTube: Google Takeout (watch history JSON, subscriptions CSV, playlists CSV incl. Watch later)
 *  - Spotify: "Download your data" (StreamingHistory*.json, YourLibrary.json, Playlist*.json)
 *  - Netflix: Account → Viewing activity → "Download all" (NetflixViewingHistory.csv)
 * Everything is parsed in the browser; nothing is uploaded anywhere.
 */
import JSZip from "jszip";
import { loadSpace } from "./custom";
import { loadFilms } from "./data";
import { type Action, addCustom, getState, recordFeedback, update } from "./store";
import { normTitle } from "./text";
import type { Entity } from "./types";

export interface Report {
  summary: string;
  matched: number;
  added: number;
}

// ------------------------------------------------------------------ helpers
async function filesOf(input: File): Promise<{ name: string; text: () => Promise<string> }[]> {
  if (/\.zip$/i.test(input.name)) {
    const zip = await JSZip.loadAsync(input);
    return Object.values(zip.files).filter((f) => !f.dir).map((f) => ({ name: f.name, text: () => f.async("string") }));
  }
  return [{ name: input.name, text: () => input.text() }];
}

export function parseCSV(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.some((x) => x.trim()));
  return body.map((r) => Object.fromEntries((head ?? []).map((h, i) => [h.replace(/^﻿/, "").trim(), (r[i] ?? "").trim()])));
}

function saveImport(key: string, summary: string, extra: Partial<ReturnType<typeof getState>["imports"][string]> = {}) {
  update((s) => {
    s.imports[key] = { at: Date.now(), summary, ...extra };
  });
}

const youtubeId = (url?: string) => url?.match(/(?:v=|youtu\.be\/|shorts\/)([\w-]{11})/)?.[1];

// ------------------------------------------------------------------ YouTube (Google Takeout)
interface WatchEntry { title?: string; titleUrl?: string; subtitles?: { name: string; url?: string }[]; time?: string }

export async function importYouTube(file: File): Promise<Report> {
  const files = await filesOf(file);
  const yt = await loadSpace("youtube");
  const history: WatchEntry[] = [];
  const watchLater: string[] = [];
  const subs: { name: string; url?: string }[] = [];
  for (const f of files) {
    const n = f.name.toLowerCase();
    if (n.endsWith("watch-history.json")) history.push(...(JSON.parse(await f.text()) as WatchEntry[]));
    else if (n.endsWith("watch-history.html")) {
      // Takeout's HTML flavour: pull links + channel names out of the markup
      const html = await f.text();
      for (const m of html.matchAll(/<a href="(https:\/\/www\.youtube\.com\/watch\?v=[^"]+)">([^<]*)<\/a><br><a href="([^"]+)">([^<]*)<\/a>/g)) {
        history.push({ title: m[2], titleUrl: m[1], subtitles: [{ name: m[4], url: m[3] }] });
      }
    } else if (n.includes("subscriptions") && n.endsWith(".csv")) {
      for (const r of parseCSV(await f.text())) subs.push({ name: r["Channel Title"] ?? r["Titre de la chaîne"] ?? Object.values(r)[2], url: r["Channel Url"] ?? Object.values(r)[1] });
    } else if (/watch later|à regarder plus tard/i.test(n) && n.endsWith(".csv")) {
      for (const r of parseCSV(await f.text())) {
        const id = r["Video ID"] ?? r["ID de la vidéo"] ?? Object.values(r)[0];
        if (id && id.length === 11) watchLater.push(id);
      }
    }
  }
  const watched = history.filter((h) => youtubeId(h.titleUrl) && !/^(Visited|A consulté)/.test(h.title ?? ""));
  // channel frequency = the real taste signal ("you watch a lot of ARTE")
  const channelCount = new Map<string, { url?: string; count: number }>();
  for (const h of watched) {
    const c = h.subtitles?.[0];
    if (!c?.name) continue;
    const cur = channelCount.get(c.name) ?? { url: c.url, count: 0 };
    cur.count++;
    channelCount.set(c.name, cur);
  }
  const channels = [...channelCount.entries()].sort((a, b) => b[1].count - a[1].count).map(([name, v]) => ({ name, url: v.url, count: v.count }));
  for (const s of subs) if (!channelCount.has(s.name)) channels.push({ name: s.name, url: s.url, count: 0 });

  // one item per video (most recent 600), action from how much you watch that channel
  const seen = new Set<string>();
  const items: { id: string; title: string; channel: string; at: number }[] = [];
  for (const h of watched) {
    const id = youtubeId(h.titleUrl)!;
    if (seen.has(id)) continue;
    seen.add(id);
    items.push({ id, title: (h.title ?? "").replace(/^(Watched|Vous avez regardé)\s+/, ""), channel: h.subtitles?.[0]?.name ?? "", at: Date.parse(h.time ?? "") || Date.now() });
    if (items.length >= 600) break;
  }
  let matched = 0;
  const toAdd = items.filter((it) => {
    const row = yt.index.get(`youtube:${it.id}`);
    if (row == null) return true;
    const n = channelCount.get(it.channel)?.count ?? 0;
    recordFeedback({ key: `youtube:${it.id}`, domain: "youtube", action: n >= 3 ? "liked" : "ok", source: "youtube-takeout", at: it.at });
    matched++;
    return false;
  });
  const ids = addCustom(toAdd.map((it) => ({
    domain: "youtube", title: it.title, subtitle: it.channel, url: `https://www.youtube.com/watch?v=${it.id}`,
    image: `https://i.ytimg.com/vi/${it.id}/hqdefault.jpg`, tags: [it.channel.toLowerCase(), "watched"], source: "youtube-takeout",
  })));
  ids.forEach((id, i) => {
    const n = channelCount.get(toAdd[i].channel)?.count ?? 0;
    recordFeedback({ key: id, domain: "youtube", action: n >= 3 ? "liked" : "ok", source: "youtube-takeout", at: toAdd[i].at });
  });
  // watch later -> your list
  const wl = addCustom(watchLater.slice(0, 300).map((id) => ({
    domain: "youtube", title: `YouTube video ${id}`, url: `https://www.youtube.com/watch?v=${id}`,
    image: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, tags: ["watch later"], source: "youtube-takeout",
  })));
  wl.forEach((id) => recordFeedback({ key: id, domain: "youtube", action: "want", source: "youtube-takeout" }));
  backfillTitles(wl);
  const summary = `${watched.length} videos watched across ${channelCount.size} channels, ${subs.length} subscriptions, ${watchLater.length} in Watch later.`;
  saveImport("youtube", summary, { channels: channels.slice(0, 200) });
  return { summary, matched, added: ids.length + wl.length };
}

/** Watch-later CSVs only carry video ids: fetch titles in the background (oEmbed via noembed). */
async function backfillTitles(ids: string[]) {
  for (const id of ids.slice(0, 120)) {
    const c = getState().custom.find((x) => x.id === id);
    if (!c?.url || !c.title.startsWith("YouTube video")) continue;
    try {
      const j = await (await fetch(`https://noembed.com/embed?url=${encodeURIComponent(c.url)}`)).json();
      if (j.title) update((s) => {
        const it = s.custom.find((x) => x.id === id);
        if (it) Object.assign(it, { title: j.title, subtitle: j.author_name, tags: [...it.tags, String(j.author_name ?? "").toLowerCase()].filter(Boolean) });
      });
    } catch {
      /* keep the placeholder */
    }
  }
}

// ------------------------------------------------------------------ Spotify ("Download your data")
export async function importSpotify(file: File): Promise<Report> {
  const files = await filesOf(file);
  const music = await loadSpace("music");
  const msByArtist = new Map<string, number>();
  const playlists: { name: string; tracks: number }[] = [];
  const liked = new Set<string>();
  for (const f of files) {
    const n = f.name.toLowerCase();
    if (!n.endsWith(".json")) continue;
    if (n.includes("streaminghistory") || n.includes("streaming_history")) {
      const rows = JSON.parse(await f.text()) as Record<string, unknown>[];
      for (const r of rows) {
        const artist = (r.artistName ?? r.master_metadata_album_artist_name) as string | undefined;
        const ms = Number(r.msPlayed ?? r.ms_played ?? 0);
        if (artist) msByArtist.set(artist, (msByArtist.get(artist) ?? 0) + ms);
      }
    } else if (n.endsWith("yourlibrary.json")) {
      const lib = JSON.parse(await f.text()) as { tracks?: { artist: string }[]; artists?: { name: string }[] };
      for (const t of lib.tracks ?? []) liked.add(t.artist);
      for (const a of lib.artists ?? []) liked.add(a.name);
    } else if (/playlist\d*\.json$/.test(n)) {
      const pl = JSON.parse(await f.text()) as { playlists?: { name: string; items?: unknown[] }[] };
      for (const p of pl.playlists ?? []) playlists.push({ name: p.name, tracks: p.items?.length ?? 0 });
    }
  }
  for (const a of liked) msByArtist.set(a, (msByArtist.get(a) ?? 0) + 30 * 60_000); // a saved track ≈ 30 min of listening
  const ranked = [...msByArtist.entries()].filter(([, ms]) => ms > 10 * 60_000).sort((a, b) => b[1] - a[1]).slice(0, 400);
  const byName = new Map(music.entities.map((e) => [normTitle(e.title), e]));
  let matched = 0;
  const toAdd: { name: string; action: Action }[] = [];
  ranked.forEach(([name], i) => {
    const action: Action = i < 40 ? "loved" : "liked";
    const e = byName.get(normTitle(name));
    if (e) {
      recordFeedback({ key: e.key, domain: "music", action, source: "spotify-export" });
      matched++;
    } else toAdd.push({ name, action });
  });
  const ids = addCustom(toAdd.map((a) => ({ domain: "music", title: a.name, subtitle: "from your Spotify", tags: ["spotify"],
    url: `https://open.spotify.com/search/${encodeURIComponent(a.name)}`, source: "spotify-export" })));
  ids.forEach((id, i) => recordFeedback({ key: id, domain: "music", action: toAdd[i].action, source: "spotify-export" }));
  const hours = Math.round([...msByArtist.values()].reduce((a, b) => a + b, 0) / 3.6e6);
  const summary = `${hours} h of listening, ${ranked.length} artists you really play (${matched} matched to the catalogue), ${playlists.length} playlists.`;
  update((s) => {
    s.spotify = { ...(s.spotify ?? { topTracks: [] }), connectedAt: Date.now(), topArtists: ranked.slice(0, 50).map(([name]) => ({ name, genres: [] })),
      playlists: playlists.map((p) => ({ ...p, url: undefined })), topTracks: s.spotify?.topTracks ?? [] };
  });
  saveImport("spotify", summary);
  return { summary, matched, added: ids.length };
}

// ------------------------------------------------------------------ Netflix (viewing activity CSV)
const EPISODE = /:\s*(season|saison|temporada|staffel|limited series|mini-?série|partie|part|volume|chapter|chapitre|episode|épisode)\b/i;

export async function importNetflix(file: File): Promise<Report> {
  const rows = parseCSV(await file.text());
  const films = await loadFilms();
  const byTitle = new Map<string, Entity[]>();
  for (const e of films.entities) for (const t of [e.title, e.film?.ot]) {
    const k = normTitle(t);
    if (k) byTitle.set(k, [...(byTitle.get(k) ?? []), e]);
  }
  const shows = new Map<string, { episodes: number; last: number }>();
  const movies = new Map<string, number>();
  for (const r of rows) {
    const title = r.Title ?? r.Titre ?? Object.values(r)[0] ?? "";
    const at = Date.parse((r.Date ?? Object.values(r)[1] ?? "").split("/").reverse().join("-")) || Date.now();
    if (EPISODE.test(title) || (title.match(/:/g)?.length ?? 0) >= 2) {
      const name = title.split(":")[0].trim();
      const cur = shows.get(name) ?? { episodes: 0, last: 0 };
      cur.episodes++;
      cur.last = Math.max(cur.last, at);
      shows.set(name, cur);
    } else movies.set(title.trim(), at);
  }
  let matched = 0;
  const missing: string[] = [];
  for (const [name, v] of shows) {
    const e = (byTitle.get(normTitle(name)) ?? []).sort((a, b) => (b.film?.k === "tv" ? 1 : 0) - (a.film?.k === "tv" ? 1 : 0))[0];
    if (!e) { missing.push(name); continue; }
    recordFeedback({ key: e.key, domain: "films", action: v.episodes >= 4 ? "liked" : "ok", source: "netflix", at: v.last });
    matched++;
  }
  for (const [name, at] of movies) {
    const e = (byTitle.get(normTitle(name)) ?? []).sort((a, b) => (b.film?.k === "movie" ? 1 : 0) - (a.film?.k === "movie" ? 1 : 0))[0];
    if (!e) { missing.push(name); continue; }
    recordFeedback({ key: e.key, domain: "films", action: "ok", source: "netflix", at });
    matched++;
  }
  const summary = `${shows.size} series and ${movies.size} films in your Netflix history; ${matched} matched (series with 4+ episodes count as liked, the rest as seen; rate them to refine).`;
  saveImport("netflix", summary);
  return { summary: missing.length ? `${summary} Not in the catalogue yet: ${missing.slice(0, 8).join(", ")}${missing.length > 8 ? "…" : ""}` : summary, matched, added: 0 };
}
