/**
 * Loads the static catalogue (JSON + int8 matrices) once per session. GitHub Pages serves the
 * files gzipped and the service worker caches them, so repeat visits work offline.
 */
import type { Collection, Entity, Film, Item, Manifest } from "./types";

export const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
export const asset = (p: string) => `${BASE}${p.startsWith("/") ? p : `/${p}`}`;

/** Row-major int8 matrix with one float scale per row (see export_static.quantize). */
export class QMatrix {
  constructor(
    public readonly q: Int8Array,
    public readonly scale: Float32Array,
    public readonly dim: number,
  ) {}
  get rows() {
    return this.scale.length;
  }
  /** Dequantised row as a unit vector (embeddings) or raw (CF factors). */
  row(i: number, normalise = true): Float32Array {
    const out = new Float32Array(this.dim);
    const s = this.scale[i];
    let n = 0;
    for (let j = 0, o = i * this.dim; j < this.dim; j++) {
      const v = this.q[o + j] * s;
      out[j] = v;
      n += v * v;
    }
    if (normalise && n > 0) {
      const inv = 1 / Math.sqrt(n);
      for (let j = 0; j < this.dim; j++) out[j] *= inv;
    }
    return out;
  }
  /** Dot product of row i with a dense vector, without allocating. */
  dot(i: number, v: Float32Array): number {
    let acc = 0;
    for (let j = 0, o = i * this.dim; j < this.dim; j++) acc += this.q[o + j] * v[j];
    return acc * this.scale[i];
  }
  norm(i: number): number {
    let acc = 0;
    for (let j = 0, o = i * this.dim; j < this.dim; j++) acc += this.q[o + j] * this.q[o + j];
    return Math.sqrt(acc) * this.scale[i];
  }
}

async function json<T>(path: string): Promise<T> {
  const r = await fetch(asset(path));
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return r.json();
}

async function bytes(path: string): Promise<ArrayBuffer | null> {
  const r = await fetch(asset(path));
  return r.ok ? r.arrayBuffer() : null;
}

async function qmatrix(prefix: string): Promise<QMatrix | null> {
  const [q, s] = await Promise.all([bytes(`${prefix}.i8`), bytes(`${prefix}.scale.f32`)]);
  if (!q || !s) return null;
  const scale = new Float32Array(s);
  const qa = new Int8Array(q);
  return new QMatrix(qa, scale, qa.length / scale.length);
}

export interface DomainData {
  name: string;
  label: string;
  entities: Entity[];
  index: Map<string, number>; // entity key -> row
  emb: QMatrix | null;
  norms: Float32Array; // row norms for cosine
}

export interface FilmData extends DomainData {
  films: Film[];
  people: string[];
  collections: Collection[];
  collectionOf: Map<string, Collection>;
  cf: QMatrix | null;
  cfIndex: Map<number, number>; // film id -> cf row
}

function norms(m: QMatrix | null): Float32Array {
  if (!m) return new Float32Array(0);
  const out = new Float32Array(m.rows);
  for (let i = 0; i < m.rows; i++) out[i] = m.norm(i) || 1;
  return out;
}

export function filmEntity(f: Film): Entity {
  const sub = [f.k === "tv" ? "Series" : "Film", f.y, f.g?.slice(0, 2).join(" / ")].filter(Boolean).join(" · ");
  return {
    key: `films:${f.id}`,
    domain: "films",
    title: f.t,
    subtitle: sub,
    image: f.img,
    date: f.d ?? (f.y ? `${f.y}-01-01` : undefined),
    pop: Math.log1p(f.vc ?? 0) + Math.log1p(f.pop ?? 0),
    tags: [...(f.g ?? []), ...(f.kw ?? []).slice(0, 10)],
    film: f,
  };
}

export function itemEntity(domain: string, it: Item): Entity {
  return {
    key: it.id.includes(":") ? it.id : `${domain}:${it.id}`,
    domain,
    title: it.title,
    subtitle: it.subtitle ?? "",
    image: it.image,
    date: it.date,
    pop: Math.log1p(it.pop ?? 0),
    // a video's channel is a taste signal of its own ("you watch a lot of ARTE")
    tags: domain === "youtube" && it.subtitle ? [...(it.tags ?? []), it.subtitle.toLowerCase()] : it.tags ?? [],
    item: it,
  };
}

const cache = new Map<string, Promise<DomainData | FilmData>>();
let manifestP: Promise<Manifest> | null = null;

export function manifest(): Promise<Manifest> {
  manifestP ??= json<Manifest>("/data/manifest.json");
  return manifestP;
}

export function loadFilms(): Promise<FilmData> {
  if (!cache.has("films")) {
    cache.set(
      "films",
      (async () => {
        const [films, people, collections, emb, cf, cfIds] = await Promise.all([
          json<Film[]>("/data/films/catalog.json"),
          json<string[]>("/data/films/people.json"),
          json<Collection[]>("/data/films/collections.json"),
          qmatrix("/data/films/emb"),
          qmatrix("/data/films/cf"),
          json<number[]>("/data/films/cf_ids.json").catch(() => [] as number[]),
        ]);
        const entities = films.map(filmEntity);
        const collectionOf = new Map(collections.map((c) => [c.key, c]));
        return {
          name: "films",
          label: "Films & series",
          entities,
          index: new Map(entities.map((e, i) => [e.key, i])),
          emb,
          norms: norms(emb),
          films,
          people,
          collections,
          collectionOf,
          cf,
          cfIndex: new Map(cfIds.map((id, i) => [id, i])),
        } satisfies FilmData;
      })(),
    );
  }
  return cache.get("films") as Promise<FilmData>;
}

export function loadDomain(name: string): Promise<DomainData> {
  if (name === "films") return loadFilms();
  if (!cache.has(name)) {
    cache.set(
      name,
      (async () => {
        const m = await manifest();
        const [items, emb] = await Promise.all([json<Item[]>(`/data/${name}/items.json`), qmatrix(`/data/${name}/emb`)]);
        const entities = items.map((it) => itemEntity(name, it));
        return {
          name,
          label: m.domains[name]?.label ?? name,
          entities,
          index: new Map(entities.map((e, i) => [e.key, i])),
          emb,
          norms: norms(emb),
        };
      })(),
    );
  }
  return cache.get(name)!;
}

export function isFilmData(d: DomainData): d is FilmData {
  return d.name === "films";
}
