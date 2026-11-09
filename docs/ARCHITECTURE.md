# CineGraph architecture

Two halves with a hard boundary: an **offline pipeline** (Python, CI) that turns open data into compact
static assets, and an **on-device engine** (TypeScript, browser) that personalises, learns and remembers.

## 1. Offline pipeline (`backend/`, GitHub Actions weekly)

| Stage | Module | Notes |
|---|---|---|
| TMDB crawl | `ingest/tmdb_ingest.py`, `tmdb_client.py` | Daily ID exports → top-N stubs → details with `append_to_response` (credits, keywords, external ids, images, FR watch providers, alternative titles, collection). Async token bucket (30 req/s) + 16 concurrent + backoff on 429/5xx. State in the DB (`details_fetched_at`, `tmdb_attempts`): resumable. |
| Wikidata | `ingest/wikidata.py` | QIDs from TMDB ids (P4947/P4983); awards, nominations, based on, influenced by, series (sagas), follows, narrative location, main subject; core facts for titles TMDB hasn't filled. Batched SPARQL, ≤1 req/s, retries on truncated responses. |
| Links & images | `ingest/links.py` | AlloCiné (P1265/P1267), SensCritique (P10100), Letterboxd (P6127), IMDb, Wikipedia sitelinks; Wikipedia `pageimages` as poster fallback (50 titles/request). |
| MovieLens | `ingest/movielens.py` | `links.csv` → TMDB ids; ratings as a numpy file (not 32M rows in Postgres). |
| Knowledge graph | `recsys/graph.py` | `kg_nodes`/`kg_edges` in Postgres (typed edges: directed_by, written_by, stars, part_of_series, won, based_on…). |
| Embeddings | `recsys/embeddings.py` | `BAAI/bge-small-en-v1.5` via fastembed (ONNX, 384-d) on title + genres + keywords + people + overview; pgvector HNSW. LSA fallback offline. |
| CF | `recsys/cf.py` | Implicit ALS (Hu, Koren & Volinsky) on MovieLens; item factors exported. |
| Other domains | `domains/*.py` | YouTube RSS, TheMealDB, Deezer (+ related artists), Wikidata places / cars / brands. One `Item` shape for all. |
| Export | `export_static.py` | `catalog.json` with compact keys (documented in `manifest.film_keys`), people index, sagas, embeddings and CF factors as **int8 + per-row float32 scale** (384 B/title, cosine error < 1 %), reaction chips per title. |

The DB is carried between CI runs as a `pg_dump` release asset, so each weekly run is incremental. If a source
times out, that domain keeps last week's export.

## 2. On-device engine (`web/lib/engine/`)

### Profile (`profile.ts`)
Rebuilt from your answers on demand. Each answer has a taste value in [-1, 1] (loved 1, liked .6, ok 0,
not my thing -1, want .45, maybe .15, never -.6; "no idea" carries none; a star rating overrides).
Derived: weighted mean embedding (dislikes push at half strength), shrunk-mean affinities per tag, person,
original language and decade, runtime sweet spot (mean ± sd of liked films), reaction-chip counts
("Too long" → runtime penalty), and an **ALS user vector folded in** from item factors:
x = (YᵀY + Yᵤᵀ(Cᵤ−I)Yᵤ + λI)⁻¹ Yᵤᵀ Cᵤ p, solved with a Cholesky in the browser.

### Ranking (`score.ts`, `recommend.ts`)
Two stages, like production recommenders:
1. **Candidate generation** over the whole catalogue with a cheap score (profile cosine + tag affinity +
   graph score + popularity); top ~600 kept.
2. **Ranking** with 16 features: profile cosine, closest liked / disliked item, tag affinity, knowledge-graph
   score, CF score, people, VO language, decade, runtime fit, community rating, popularity, recency,
   next-in-saga, listed. A **logistic ranker** turns them into a match probability (shown as % and as
   predicted stars = 0.5 + 4.5p).

**Online learning** (`learn.ts`): each answer takes one SGD step on the features the item had *when you
answered* (no leakage), with an L2 pull towards the default weights so a few answers can't wreck it. The full
history is kept, so `relearn` replays it after a model change. The UI shows which signals your ranker
up- or down-weighted, and its running accuracy.

**Knowledge-graph paths**: candidate and liked titles share entities (director, writer, creator, cast,
composer, saga, award, source work, location, subject). Contribution = relation weight × idf(entity) ×
taste weight, capped per anchor; the strongest positive path is the explanation.

**Diversity**: MMR on embeddings (λ = 0.8). **Exploration**: ~12 % of slots; tags are Thompson-sampling arms
(Beta posteriors updated by every answer), the best-drawn tags get a slot, labelled "Exploring".

### Swipe deck: active learning (`active.ts`)
Bayesian linear regression of your taste on a fixed 32-d Gaussian random projection z of each embedding.
Posterior covariance S = (λI + ZᵀZ/σ²)⁻¹. Next card maximises

  p_seen · ( √(zᵀSz) + v·coverage + x·match )

- uncertainty √(zᵀSz): where an answer teaches most;
- coverage: distance to everything already answered (visit every corner early);
- match: ranker probability, with weight x growing with the number of answers, so cards drift from
  "informative" to "informative *and* likely to please" as the profile firms up;
- p_seen: logistic on popularity percentile (within films / series), shifted towards well-known items when
  your recent "not seen / no idea" rate is high.
Films and series alternate. Sampling among the top 5 avoids a mechanical deck.

### Memory (`store.ts`, `sync.ts`)
One JSON document in IndexedDB: append-only `history` (source of truth), latest `feedback` per item, lists,
series progress, vault, learned weights and bandit arms, settings. Optional sync to a **private GitHub Gist**
(your token, kept locally): newest document wins, histories merged by timestamp. Secrets (Gist token,
Anthropic key) are never uploaded.

### AI (`ai.ts`, optional)
With your Anthropic key (browser-only): Claude parses free-text requests into a JSON intent (structured
outputs) and writes a taste portrait. Without it, a regex parser handles "like X but funnier, under 2h,
on Netflix" and summaries are template-based.

## 3. Web app (`web/`)
Next.js App Router, `output: "export"` (pure static), Tailwind, `motion` for gestures, `react-force-graph-2d`
for the graph. Query-string routes (`/item/?k=films:123`) keep the export small. PWA: manifest with a share
target (share a link from any app into the Vault), service worker caching the shell (network-first), the
catalogue (stale-while-revalidate) and images (cache-first).

## 4. Quality
- Python: pytest (unit + a Postgres end-to-end ranking test) in CI with a pgvector service container.
- TypeScript: ESLint, `tsc --noEmit`, Vitest on the engine.
- Hard filters (romance / musicals / laugh-track sitcoms) computed in the pipeline (`config/hard_filters.yaml`),
  switchable in Settings.

## 5. Legacy server mode
`backend/cinegraph/api` (FastAPI) and the Postgres-side ranker (`recsys/pipeline.py`, LightGBM LambdaRank)
are the v1 server implementation. They still run (`docker compose --profile server up`) and their tests still
pass; the static app reimplements the online parts in the browser.
