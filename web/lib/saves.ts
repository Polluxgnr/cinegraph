/**
 * Your Instagram saves, analysed by the insta-saved project (Documents/insta-saved): each post has a category,
 * a short title, a summary of what it shows ("what"), the tools it mentions, its author, date and place.
 * The library is personal: it lives in your memory (and your private Gist when sync is on), never in the repo.
 */
export interface SavedPost {
  i: number;
  cat: string;
  title: string;
  what: string;
  tools: string[];
  user: string;
  url: string;
  posted?: string;
  video: boolean;
  place?: { name: string; lat?: number; lng?: number };
  lang?: string;
  isNew: boolean;
  order: number;
}
export interface SaveCat { id: string; name: string; group: string; n: number }
export interface Playbook { title: string; what: string; posts: { title: string; url: string }[] }
export interface SavesLibrary { at: number; cats: SaveCat[]; posts: SavedPost[]; recs: Playbook[]; toolUrls: Record<string, string> }

/** Python-ish list strings ("['a', \"b\"]") from the library, or real arrays. */
function list(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  const s = String(v ?? "").trim();
  if (!s || s === "[]" || s === "None") return [];
  return [...s.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g)].map((m) => (m[1] ?? m[2]).replace(/\\'/g, "'"));
}
const str = (v: unknown) => (v == null || v === "None" ? "" : String(v));
function placeOf(v: unknown): SavedPost["place"] {
  if (v && typeof v === "object" && "name" in v) {
    const o = v as { name: string; lat?: number; lng?: number };
    return o.name ? { name: o.name, lat: Number(o.lat) || undefined, lng: Number(o.lng) || undefined } : undefined;
  }
  return undefined;
}
const bool = (v: unknown) => v === true || v === "True" || v === "true";

/** Parse insta-saved's data.json ({cats, posts, recs, tool_urls}). Captions and transcripts are dropped. */
export function parseSaves(raw: unknown): SavesLibrary {
  const d = raw as { cats?: SaveCat[]; posts?: Record<string, unknown>[]; recs?: Playbook[]; tool_urls?: Record<string, string> };
  if (!Array.isArray(d?.posts) || !Array.isArray(d?.cats)) throw new Error("Not an insta-saved library (expected cats and posts).");
  const posts: SavedPost[] = d.posts.map((p) => ({
    i: Number(p.i),
    cat: str(p.cat),
    title: str(p.title),
    what: str(p.what),
    tools: list(p.tools),
    user: str(p.user),
    url: str(p.url),
    posted: str(p.posted) || undefined,
    video: bool(p.video),
    place: placeOf(p.place) ?? (str(p.where) ? { name: str(p.where) } : undefined),
    lang: str(p.lang) || undefined,
    isNew: bool(p.new),
    order: Number(p.order ?? p.i),
  }));
  return { at: Date.now(), cats: d.cats, posts, recs: Array.isArray(d.recs) ? d.recs : [], toolUrls: d.tool_urls ?? {} };
}

export const GROUP_LABEL: Record<string, string> = { ai: "AI & code", tools: "Tools & design", life: "Life", fun: "Fun" };
