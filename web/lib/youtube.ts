"use client";
/**
 * Connect YouTube, from a static site: Google Identity Services gives a short-lived read-only token
 * (scope youtube.readonly) for a Google OAuth client *you* create, like the Spotify connection.
 * We read your liked videos, subscriptions and playlists. YouTube's API does not expose watch history
 * or Watch later any more: those still come from Google Takeout.
 */
import { loadSpace } from "./custom";
import { addCustom, getState, recordFeedback, update } from "./store";

const SCOPE = "https://www.googleapis.com/auth/youtube.readonly";
const API = "https://www.googleapis.com/youtube/v3";

interface TokenClient { requestAccessToken: (o?: { prompt?: string }) => void }
declare global {
  interface Window {
    google?: { accounts: { oauth2: { initTokenClient: (c: { client_id: string; scope: string; callback: (r: { access_token?: string; error?: string }) => void }) => TokenClient } } };
  }
}

function loadGis(): Promise<void> {
  if (window.google?.accounts) return Promise.resolve();
  return new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.onload = () => res();
    s.onerror = () => rej(new Error("Could not load Google sign-in"));
    document.head.appendChild(s);
  });
}

async function token(): Promise<string> {
  const clientId = getState().settings.googleClientId;
  if (!clientId) throw new Error("Paste your Google OAuth Client ID first");
  await loadGis();
  return new Promise((res, rej) => {
    const c = window.google!.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: (r) => (r.access_token ? res(r.access_token) : rej(new Error(r.error ?? "Google sign-in cancelled"))),
    });
    c.requestAccessToken({ prompt: "" });
  });
}

const minutes = (iso?: string) => {
  const m = iso?.match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return undefined;
  const [d, h, mi, s] = m.slice(1).map((x) => Number(x ?? 0));
  return Math.max(1, Math.round(d * 1440 + h * 60 + mi + s / 60));
};

interface Video {
  id: string;
  snippet: { title: string; channelTitle: string; publishedAt: string; thumbnails?: Record<string, { url: string }>; tags?: string[] };
  contentDetails?: { duration?: string };
  statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
}

/** Pull liked videos, subscriptions and playlists; returns a one-line summary. */
export async function connectYouTube(): Promise<string> {
  const t = await token();
  const get = async (path: string, params: Record<string, string>) => {
    const r = await fetch(`${API}/${path}?${new URLSearchParams(params)}`, { headers: { Authorization: `Bearer ${t}` } });
    if (!r.ok) throw new Error(`YouTube ${path}: ${r.status}`);
    return r.json();
  };
  const pages = async <T,>(path: string, params: Record<string, string>, max: number): Promise<T[]> => {
    const out: T[] = [];
    let pageToken = "";
    while (out.length < max) {
      const j = await get(path, { ...params, maxResults: "50", ...(pageToken ? { pageToken } : {}) });
      out.push(...j.items);
      pageToken = j.nextPageToken;
      if (!pageToken) break;
    }
    return out;
  };
  const [liked, subs, playlists] = await Promise.all([
    pages<Video>("videos", { part: "snippet,contentDetails,statistics", myRating: "like" }, 300),
    pages<{ snippet: { title: string; resourceId: { channelId: string } } }>("subscriptions", { part: "snippet", mine: "true", order: "relevance" }, 300),
    pages<{ snippet: { title: string }; contentDetails: { itemCount: number } }>("playlists", { part: "snippet,contentDetails", mine: "true" }, 100),
  ]);

  // liked videos: known ones get a "liked", the rest become your own items with their numbers
  const yt = await loadSpace("youtube");
  const fresh = liked.filter((v) => {
    const key = `youtube:${v.id}`;
    if (yt.index.get(key) == null) return true;
    if (!getState().feedback[key]) recordFeedback({ key, domain: "youtube", action: "liked", source: "youtube-api" });
    return false;
  });
  const ids = addCustom(fresh.map((v) => ({
    domain: "youtube", title: v.snippet.title, subtitle: v.snippet.channelTitle, url: `https://www.youtube.com/watch?v=${v.id}`,
    image: v.snippet.thumbnails?.high?.url ?? `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`,
    tags: [v.snippet.channelTitle.toLowerCase(), ...(v.snippet.tags ?? []).slice(0, 6).map((x) => x.toLowerCase())],
    meta: { embed: v.id, minutes: minutes(v.contentDetails?.duration), views: Number(v.statistics?.viewCount ?? 0), likes: Number(v.statistics?.likeCount ?? 0), comments: Number(v.statistics?.commentCount ?? 0) },
    source: "youtube-api",
  })));
  ids.forEach((id) => !getState().feedback[id] && recordFeedback({ key: id, domain: "youtube", action: "liked", source: "youtube-api" }));

  const channels = subs.map((s) => ({ name: s.snippet.title, url: `https://www.youtube.com/channel/${s.snippet.resourceId.channelId}`, count: 0 }));
  const summary = `Connected: ${liked.length} liked videos, ${subs.length} subscriptions, ${playlists.length} playlists.`;
  update((s) => {
    const prev = s.imports.youtube?.channels ?? [];
    const known = new Set(prev.map((c) => c.name));
    s.imports["youtube-live"] = { at: Date.now(), summary, channels: [...prev, ...channels.filter((c) => !known.has(c.name))].slice(0, 300) };
  });
  return summary;
}
