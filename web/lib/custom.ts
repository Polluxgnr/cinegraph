/**
 * Your own items (links you add, imported history) inside a domain's catalogue.
 *
 * There's no embedding model in the browser, so a custom item gets a *borrowed* embedding: the
 * idf-weighted mean of the catalogue items sharing the most words with its title, tags and note.
 * Good enough for "a deep-house track" to land near deep-house artists, which is all the
 * profile needs; the item keeps its own tags for tag affinity.
 */
import { type DomainData, loadDomain, QMatrix } from "./data";
import { getState } from "./store";
import type { CustomItem } from "./store";
import type { Entity } from "./types";

const STOP = new Set(["the", "and", "les", "des", "une", "with", "for", "from", "that", "this", "film", "video", "official", "de", "la", "le", "du", "et", "en", "a", "of", "in", "on"]);

export function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 2 && !STOP.has(t));
}

const tokenIndexes = new WeakMap<DomainData, { idx: Map<string, number[]>; n: number }>();
function tokenIndex(d: DomainData) {
  let ti = tokenIndexes.get(d);
  if (ti) return ti;
  const idx = new Map<string, number[]>();
  d.entities.forEach((e, row) => {
    for (const t of new Set(tokens(`${e.title} ${e.subtitle} ${e.tags.join(" ")}`))) {
      const l = idx.get(t);
      if (l) l.push(row);
      else idx.set(t, [row]);
    }
  });
  ti = { idx, n: d.entities.length };
  tokenIndexes.set(d, ti);
  return ti;
}

/** Rows of the catalogue most similar in words to a text (also used to match imports). */
export function wordNeighbours(d: DomainData, text: string, k = 8): { row: number; score: number }[] {
  const { idx, n } = tokenIndex(d);
  const score = new Map<number, number>();
  for (const t of new Set(tokens(text))) {
    const rows = idx.get(t);
    if (!rows || rows.length > n / 4) continue; // too common to be informative
    const idf = Math.log(n / rows.length);
    for (const r of rows) score.set(r, (score.get(r) ?? 0) + idf);
  }
  return [...score.entries()].sort((a, b) => b[1] - a[1]).slice(0, k).map(([row, s]) => ({ row, score: s }));
}

export function customEntity(c: CustomItem): Entity {
  return {
    key: c.id,
    domain: c.domain,
    title: c.title,
    subtitle: c.subtitle ?? (c.url ? hostOf(c.url) : "added by you"),
    image: c.image,
    pop: 0,
    tags: c.tags,
    item: { id: c.id, title: c.title, subtitle: c.subtitle, image: c.image, url: c.url, tags: c.tags, text: c.note, meta: { custom: true, note: c.note, source: c.source } },
  };
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

const merged = new WeakMap<DomainData, { sig: string; d: DomainData }>();

/** The domain's catalogue plus your custom items (cached until your custom items change). */
export function withCustom(d: DomainData, all: CustomItem[]): DomainData {
  // films are matched to the catalogue instead (their features need TMDB/Wikidata data)
  const mine = d.name === "films" ? [] : all.filter((c) => c.domain === d.name);
  const sig = mine.map((c) => c.id + c.tags.length).join("|");
  const hit = merged.get(d);
  if (hit && hit.sig === sig) return hit.d;
  if (!mine.length || !d.emb) {
    merged.set(d, { sig, d });
    return d;
  }
  const dim = d.emb.dim;
  const q = new Int8Array(d.emb.q.length + mine.length * dim);
  q.set(d.emb.q);
  const scale = new Float32Array(d.emb.rows + mine.length);
  scale.set(d.emb.scale);
  const norms = new Float32Array(scale.length);
  norms.set(d.norms);
  mine.forEach((c, i) => {
    const nb = wordNeighbours(d, `${c.title} ${c.tags.join(" ")} ${c.note ?? ""}`);
    const v = new Float32Array(dim);
    let tot = 0;
    for (const { row, score } of nb) {
      const r = d.emb!.row(row);
      for (let j = 0; j < dim; j++) v[j] += score * r[j];
      tot += score;
    }
    const row = d.emb!.rows + i;
    if (!tot) {
      // nothing in common with the catalogue: a tiny neutral vector (tags still count)
      scale[row] = 1e-6;
      norms[row] = 1;
      return;
    }
    let mx = 0;
    for (let j = 0; j < dim; j++) mx = Math.max(mx, Math.abs(v[j]));
    scale[row] = mx / 127;
    let n2 = 0;
    for (let j = 0; j < dim; j++) {
      q[row * dim + j] = Math.round(v[j] / scale[row]);
      n2 += (q[row * dim + j] * scale[row]) ** 2;
    }
    norms[row] = Math.sqrt(n2) || 1;
  });
  const entities = [...d.entities, ...mine.map(customEntity)];
  const out: DomainData = {
    ...d,
    entities,
    index: new Map(entities.map((e, i) => [e.key, i])),
    emb: new QMatrix(q, scale, dim),
    norms,
  };
  merged.set(d, { sig, d: out });
  return out;
}

/** Engine-facing loader: catalogue + your custom items. */
export async function loadSpace(name: string): Promise<DomainData> {
  return withCustom(await loadDomain(name), getState().custom);
}
