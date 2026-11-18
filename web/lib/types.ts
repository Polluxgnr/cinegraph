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
  mlr?: number; // MovieLens mean rating /5 (individual ratings)
  mlc?: number; // MovieLens number of ratings
  cast?: number[];
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

export interface Manifest {
  version: number;
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
