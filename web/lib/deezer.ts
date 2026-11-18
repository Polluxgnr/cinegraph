"use client";
/**
 * Deezer's public API from the browser. It sends no CORS headers but supports JSONP, so we load each
 * answer as a script. No key, no login. Preview URLs (30 s MP3) are signed and expire, so they're
 * fetched when needed instead of being baked into the catalogue.
 */

const API = "https://api.deezer.com";
const cache = new Map<string, Promise<unknown>>();
let seq = 0;

function jsonp<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
  const q = new URLSearchParams({ ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])), output: "jsonp" });
  const url = `${API}${path}?${q}`;
  if (!cache.has(url)) {
    cache.set(url, new Promise<T>((resolve, reject) => {
      const cb = `__dz${Date.now().toString(36)}${seq++}`;
      const s = document.createElement("script");
      const done = () => {
        delete (window as unknown as Record<string, unknown>)[cb];
        s.remove();
      };
      const timer = setTimeout(() => {
        done();
        cache.delete(url);
        reject(new Error("Deezer timed out"));
      }, 10_000);
      (window as unknown as Record<string, unknown>)[cb] = (data: T & { error?: { message?: string } }) => {
        clearTimeout(timer);
        done();
        if (data && typeof data === "object" && "error" in data && data.error) {
          cache.delete(url);
          reject(new Error(data.error.message ?? "Deezer error"));
        } else resolve(data);
      };
      s.src = `${url}&callback=${cb}`;
      s.onerror = () => {
        clearTimeout(timer);
        done();
        cache.delete(url);
        reject(new Error("Deezer unreachable"));
      };
      document.head.appendChild(s);
    }));
  }
  return cache.get(url) as Promise<T>;
}

export interface DzTrack {
  id: number;
  title: string;
  title_short?: string;
  duration: number;
  rank: number; // Deezer popularity (plays-weighted), not a stream count
  preview: string;
  link: string;
  artist: { id: number; name: string };
  album: { id: number; title: string; cover_medium?: string; cover_xl?: string };
}
export interface DzArtist {
  id: number;
  name: string;
  nb_fan: number;
  nb_album: number;
  picture_xl?: string;
  link: string;
}
export interface DzAlbum {
  id: number;
  title: string;
  cover_medium?: string;
  release_date?: string;
  record_type?: string;
  link: string;
  fans?: number;
}

const list = <T,>(p: Promise<{ data?: T[] }>) => p.then((r) => r.data ?? []);

export const dzArtist = (id: string | number) => jsonp<DzArtist>(`/artist/${id}`);
export const dzTop = (id: string | number, limit = 10) => list(jsonp<{ data?: DzTrack[] }>(`/artist/${id}/top`, { limit }));
export const dzAlbums = (id: string | number, limit = 24) => list(jsonp<{ data?: DzAlbum[] }>(`/artist/${id}/albums`, { limit }));
export const dzRelated = (id: string | number, limit = 12) => list(jsonp<{ data?: DzArtist[] }>(`/artist/${id}/related`, { limit }));
export const dzSearchArtist = (q: string) => list(jsonp<{ data?: DzArtist[] }>(`/search/artist`, { q, limit: 5 }));

export interface DzPlaylist {
  id: number;
  title: string;
  picture_medium?: string;
  creator?: { name: string };
  nb_tracks: number;
  link: string;
  tracks: { data: DzTrack[] };
}
export const dzPlaylist = (id: string | number) => jsonp<DzPlaylist>(`/playlist/${id}`);

/** "music:27" -> 27 (catalogue music items are Deezer artists). */
export const deezerArtistId = (key: string) => (/^music:\d+$/.test(key) ? key.slice(6) : null);
