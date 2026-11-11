"use client";
/**
 * Spotify, from a static site: Authorization Code with PKCE (no client secret). You create a free
 * app at developer.spotify.com, add this site's /settings/ URL as redirect URI, paste the Client ID.
 * We read your top artists / tracks and playlists, then feed matching artists into the music model.
 */
import { asset, loadDomain } from "./data";
import { normTitle } from "./text";
import { getState, recordFeedback, update } from "./store";

const SCOPES = "user-top-read playlist-read-private user-library-read";

export function redirectUri(): string {
  return `${window.location.origin}${asset("/import/")}`;
}

function b64url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function startLogin() {
  const clientId = getState().settings.spotifyClientId;
  if (!clientId) throw new Error("Paste your Spotify Client ID first");
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)).buffer);
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  sessionStorage.setItem("spotify_verifier", verifier);
  const p = new URLSearchParams({
    client_id: clientId, response_type: "code", redirect_uri: redirectUri(), scope: SCOPES,
    code_challenge_method: "S256", code_challenge: challenge,
  });
  window.location.href = `https://accounts.spotify.com/authorize?${p}`;
}

/** Called on /settings/ when Spotify redirects back with ?code=. Returns a summary string. */
export async function finishLogin(code: string): Promise<string> {
  const clientId = getState().settings.spotifyClientId!;
  const verifier = sessionStorage.getItem("spotify_verifier") ?? "";
  const r = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, grant_type: "authorization_code", code, redirect_uri: redirectUri(), code_verifier: verifier }),
  });
  if (!r.ok) throw new Error(`Spotify token: ${r.status}`);
  const { access_token: token } = await r.json();
  const get = async (path: string) => {
    const res = await fetch(`https://api.spotify.com/v1${path}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Spotify ${path}: ${res.status}`);
    return res.json();
  };
  type Artist = { name: string; genres: string[]; images?: { url: string }[]; external_urls?: { spotify: string } };
  type Track = { name: string; artists: { name: string }[]; external_urls?: { spotify: string } };
  type Playlist = { name: string; external_urls?: { spotify: string }; images?: { url: string }[]; tracks?: { total: number } };
  // "Liked songs": up to 250, to weigh the artists you save, not only the ones you stream
  const saved: { track: Track }[] = [];
  for (let off = 0; off < 250; off += 50) {
    const page = await get(`/me/tracks?limit=50&offset=${off}`).catch(() => ({ items: [] }));
    saved.push(...page.items);
    if (page.items.length < 50) break;
  }
  const [long, medium, tracks, playlists] = await Promise.all([
    get("/me/top/artists?limit=50&time_range=long_term"),
    get("/me/top/artists?limit=50&time_range=medium_term"),
    get("/me/top/tracks?limit=50&time_range=medium_term"),
    get("/me/playlists?limit=50"),
  ]);
  const artists: Artist[] = [...long.items, ...medium.items].filter(
    (a: Artist, i: number, arr: Artist[]) => arr.findIndex((b) => b.name === a.name) === i,
  );
  // artists that appear 3+ times in your liked songs also count as favourites
  const savedCount = new Map<string, number>();
  for (const it of saved) for (const a of it.track?.artists ?? []) savedCount.set(a.name, (savedCount.get(a.name) ?? 0) + 1);
  for (const [name, n] of savedCount) if (n >= 3 && !artists.some((a) => a.name === name)) artists.push({ name, genres: [] });
  update((s) => {
    s.spotify = {
      connectedAt: Date.now(),
      topArtists: artists.map((a) => ({ name: a.name, genres: a.genres, image: a.images?.[0]?.url, url: a.external_urls?.spotify })),
      topTracks: (tracks.items as Track[]).map((t) => ({ name: t.name, artist: t.artists[0]?.name ?? "", url: t.external_urls?.spotify })),
      playlists: (playlists.items as Playlist[]).filter(Boolean).map((p) => ({ name: p.name, url: p.external_urls?.spotify, image: p.images?.[0]?.url, tracks: p.tracks?.total ?? 0 })),
    };
  });
  // your top artists become "loved"/"liked" answers in the music domain
  const music = await loadDomain("music").catch(() => null);
  let matched = 0;
  if (music) {
    const byName = new Map(music.entities.map((e) => [normTitle(e.title), e]));
    artists.forEach((a, i) => {
      const e = byName.get(normTitle(a.name));
      if (e && !getState().feedback[e.key]) {
        recordFeedback({ key: e.key, domain: "music", action: i < 15 ? "loved" : "liked", source: "spotify" });
        matched++;
      }
    });
  }
  return `${artists.length} favourite artists (top + liked songs), ${saved.length} liked songs, ${tracks.items.length} top tracks, ${playlists.items.length} playlists; ${matched} artists matched to the catalogue.`;
}
