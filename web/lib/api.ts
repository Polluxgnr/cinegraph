export type Kind = "movie" | "tv";

export interface Title {
  id: number;
  kind: Kind;
  tmdb_id: number;
  title: string;
  year: number | null;
  genres: string[];
  runtime: number | null;
  seasons?: number | null;
  poster_path: string | null;
  backdrop_path?: string | null;
  overview?: string | null;
  vote_average: number | null;
  platforms: string[];
  keywords?: string[];
  user?: { rating: number | null; watchlist: string | null; watched: boolean; swipe: string | null };
}

export interface Rec extends Title {
  score: number;
  why: string;
  explore: boolean;
  position: number;
}

export interface RecsResponse {
  request_id: string;
  model: string;
  profile_size: number;
  candidates: number;
  items: Rec[];
  provider_data?: boolean;
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`/api${path}`, {
    ...init,
    headers: init?.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : undefined,
    cache: "no-store",
  });
  if (!r.ok) {
    let detail = r.statusText;
    try {
      detail = (await r.json()).detail ?? detail;
    } catch {}
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  return r.json() as Promise<T>;
}

export const api = {
  get: <T>(p: string) => req<T>(p),
  post: <T>(p: string, body?: unknown) =>
    req<T>(p, { method: "POST", body: body instanceof FormData ? body : JSON.stringify(body ?? {}) }),
  put: <T>(p: string, body: unknown) => req<T>(p, { method: "PUT", body: JSON.stringify(body) }),
  del: <T>(p: string) => req<T>(p, { method: "DELETE" }),
};

export const poster = (p: string | null | undefined, size = "w500") =>
  p ? `https://image.tmdb.org/t/p/${size}${p}` : null;

export const kindLabel = (k: Kind) => (k === "tv" ? "Series" : "Film");

export function runtimeLabel(t: Pick<Title, "kind" | "runtime" | "seasons">) {
  if (t.kind === "tv") {
    const s = t.seasons ? `${t.seasons} season${t.seasons > 1 ? "s" : ""}` : "";
    const e = t.runtime ? `${t.runtime} min/ep` : "";
    return [s, e].filter(Boolean).join(" · ");
  }
  if (!t.runtime) return "";
  const h = Math.floor(t.runtime / 60);
  return h ? `${h}h${String(t.runtime % 60).padStart(2, "0")}` : `${t.runtime} min`;
}
