/** Shapes of the static data produced by `cinegraph export-static` (see backend/cinegraph/export_static.py). */

export type Kind = "movie" | "tv";

export interface Film {
  id: number;
  k: Kind;
  t: string;
  ot?: string;
  y?: number;
  d?: string;
  rt?: number;
  ns?: number;
  ne?: number;
  lang?: string;
  ov?: string;
  g?: string[];
  kw?: string[];
  c?: string[];
  pop?: number;
  va?: number;
  vc?: number;
  img?: string;
  bd?: string;
  tr?: string; // YouTube trailer key
  tf?: string; // French title (TMDB fr-FR)
  ovf?: string; // French synopsis (details)
  mlr?: number; // MovieLens mean rating /5 (individual ratings)
  mlc?: number; // MovieLens number of ratings
  ir?: number; // IMDb rating /10 (official dataset)
  ic?: number; // IMDb votes
  cast?: number[];
  chr?: string[]; // character per cast member (details)
  dir?: number[];
  wri?: number[];
  cre?: number[];
  mus?: number[];
  coll?: string;
  aw?: string[];
  nom?: string[];
  src?: string[];
  inf?: string[];
  loc?: string[];
  sub?: string[];
  prov?: string[];
  rent?: string[];
  links?: Record<string, string>;
  /** compact link ids (format 3), expanded into `links` by the loader */
  x?: { tm?: number; im?: string; wd?: string; ac?: string | number; sc?: string | number; lb?: string; wp?: string };
  jw?: string; // JustWatch link (details)
  /** details (synopsis, full keywords & cast, rent, nominations) have been merged in */
  full?: boolean;
  chips?: string[];
  blk?: string;
}

export interface Collection {
  key: string;
  name: string;
  items: number[];
}

/** Every non-film domain (YouTube, recipes, music, places, cars, brands). */
export interface Item {
  id: string;
  title: string;
  subtitle?: string;
  image?: string;
  url?: string;
  tags?: string[];
  text?: string;
  date?: string;
  pop?: number;
  links?: Record<string, string>;
  meta?: Record<string, unknown>;
  related?: string[];
}

export interface EvalScores { hr10: number; ndcg10: number; recall20: number }
export interface Manifest {
  version: number;
  /** offline evaluation on hidden MovieLens favourites (backend/cinegraph/recsys/evaluate.py) */
  eval?: { users: number; items: number; protocol: string; hybrid_weights: Record<string, number>;
    /** the in-browser engine itself on 300 held-out users, before / after the last tuning round */
    app?: { before: { users: number; hr10: number; ndcg10: number }; after: { users: number; hr10: number; ndcg10: number } } }
    & Partial<Record<"popular" | "content" | "als" | "hybrid", EvalScores>>;
  built_at: string;
  embed_model: string;
  domains: Record<string, { label: string; count: number; images?: number; collections?: number; cf_items?: number; people?: number; detail_shards?: number; extras?: Record<string, number> }>;
}

/** A common view of any recommendable thing, so one engine and one card serve every domain. */
export interface Entity {
  key: string; // "films:123" | "recipes:52772" ...
  domain: string;
  title: string;
  subtitle: string;
  image?: string;
  date?: string;
  pop: number;
  tags: string[];
  film?: Film;
  item?: Item;
}
