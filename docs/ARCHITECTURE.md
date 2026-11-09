# CineGraph architecture

```
                 ┌──────────────────────────── ingestion (CLI / worker) ───────────────────────────┐
 TMDB daily ID exports ──► tmdb_export ──► titles (stubs) ──► TMDB details crawl (rate-limited,   │
                                                              resumable: details_fetched_at)      │
 MovieLens zip ──► ml_links, stub titles, ratings.npz                                             │
 Wikidata SPARQL ──► wikidata_id, wikidata_facts (awards, based on, influences, series, places)   │
 Letterboxd export ZIP / public RSS ──► user_ratings, diary, user_watched, watchlist, user_likes  │
 docs/seed_watchlist.md ──► watchlist                                                             │
                 └──────────────────────────────────────────────────────────────────────────────────┘
                                     │ Postgres 16 + pgvector
        ┌────────────────────────────┼──────────────────────────────────────┐
        ▼                            ▼                                      ▼
  knowledge graph               content embeddings                   collaborative filtering
  kg_nodes / kg_edges           title_embeddings vector(384)         implicit ALS item factors
  (graph.build)                 (embeddings.build)                   (cf.train → data/models/als.npz)
        └──────────────┬─────────────┴───────────────┬──────────────────────┘
                       ▼                             ▼
              ranking pipeline (recsys/pipeline.py)        swipe deck (recsys/active.py)
              candidates → hard filters → features         Bayesian linear model in PCA space,
              → LightGBM LambdaRank (or default blend)     uncertainty × coverage × p(seen)
              → MMR diversity → bandit exploration
              → explanations → impression log
                       │
             NL query (recsys/nlquery.py): LLM parse → constraints + anchor/vibe boosts → pipeline → LLM rerank
                       │
                 FastAPI (api/main.py)  ◄──── Next.js PWA (web/), proxied under /api
```

## Data sources and the rules we follow

| Source | How | Why this way |
|---|---|---|
| TMDB | Official API with your own key, daily ID export files | Terms allow personal use with attribution |
| Wikidata | Public SPARQL endpoint, ≤1 query/s, User-Agent with contact URL | Wikimedia UA policy |
| MovieLens | GroupLens download (`ml-latest-small` or `ml-32m`) into `data/` | Personal/research licence, never committed or redistributed |
| Letterboxd | Official export ZIP, public RSS feed, CSVs for Letterboxd's own importer | No scraping, no automated login/posting (both break Letterboxd's terms) |

Streaming availability is TMDB's watch-provider data (JustWatch), region FR, legal platforms only.

## Schema (backend/cinegraph/schema.sql)

- `titles`: one row per film or series, natural key `(kind, tmdb_id)` because TMDB movie and TV ids overlap.
  `source` says who created the row (`tmdb`, `movielens`, `wikidata`); a TMDB crawl overwrites stubs.
- `people`, `credits(role)`, `providers(region, offer_type)`, `title_aliases` (normalised alternative titles for matching).
- `wikidata_facts(prop, object_qid, object_label)`.
- User data: `user_ratings`, `diary`, `user_watched`, `user_likes`, `watchlist(status want|watching)`, `swipes`,
  `pending_matches` (imports that couldn't be matched yet).
- Learning: `impressions` (features at serve time), `bandit_arms` (Beta posteriors per cluster), `job_state`.
- Graph: `kg_nodes(type, key, label, degree)`, `kg_edges(src, dst, rel, weight)`.
- `title_embeddings(embedding vector(384))` with an HNSW cosine index.

## Ingestion

- **TMDB** (`ingest/tmdb_ingest.py`): stage the export into `tmdb_export`, insert the top N per kind as stubs
  (or everything with `--full`), then crawl every title with `details_fetched_at IS NULL` in batches using
  `append_to_response=credits,keywords,external_ids,images,watch/providers,alternative_titles`.
  Token bucket (`TMDB_RATE_LIMIT`, default 30/s) + 16 concurrent requests + exponential backoff on 429/5xx.
  Failures are counted per title (`tmdb_attempts`, max 3). Kill it any time; rerun continues.
  Titles referenced by your data (RSS tmdb ids, Letterboxd matches, seed list) are always included.
- **Wikidata** (`ingest/wikidata.py`): QIDs come from TMDB `external_ids`, or are resolved by TMDB id
  (P4947 / P4983). Facts are fetched in batches of 60 QIDs. For titles TMDB hasn't filled yet, the core
  facts (director, writers, cast, creators, genres, countries, year, runtime) are taken from Wikidata too, so
  the app works before you have a TMDB key. `--tv-bootstrap N` seeds the N best-known series.
- **MovieLens** (`ingest/movielens.py`): `links.csv` maps to TMDB; ratings are stored as a compressed numpy
  file for ALS rather than 32M rows in Postgres.

## Matching (userdata/matcher.py)

Title normalisation (accents, punctuation, leading articles, roman numerals) → candidates from the exact
normalised title, aliases and trigram similarity → score = title similarity (exact / rapidfuzz) × year factor
(same 1.0, ±1 0.95, ±2 0.8, else 0.45) × kind factor, threshold 0.72. If nothing matches locally and a TMDB key
is set, TMDB search is tried and the hit is ingested on the spot; otherwise Wikidata's entity search is used
(it knows the TMDB id of most notable titles, so the stub lines up with a later TMDB crawl). A query whose words
are a strict superset or subset of a title ("Lupin III" vs "Lupin") is capped below the threshold, except a short
name equal to the main title before a subtitle ("Big Vape" → "Big Vape: The Rise and Fall of Juul").
Misses land in `pending_matches` and are retried on the next import / seed run.

## Recommender

1. **Profile** (`profile.py`): read fresh per request: explicit stars > latest swipe (love 5, like 4,
   dislike 1.5) > Letterboxd heart (4.5) > watched. "Not for me" on a card is a mild negative (2 stars) that
   hides the title without marking it watched. Weight `w = (stars − 3)/2 ∈ [−1, 1]`.
2. **Candidates**: embedding kNN from the profile vector and from each top anchor, ALS top-250 from the
   folded-in user vector, 2-hop graph neighbours of titles you rated ≥ 4, and a quality fallback per kind.
3. **Hard filters** (`config/hard_filters.yaml`): romance as main genre or rom-com/romantic drama, musicals,
   laugh-track sitcoms (keywords + an editable title list). Never applied to your own watchlist/ratings.
4. **Features** (`features.py`): profile cosine, max cosine to liked / disliked anchors, ALS score (NaN for
   series: MovieLens has no TV), graph path score / path count / negative paths, genre affinity, popularity,
   TMDB vote average and count, year, kind, runtime, on-my-platforms, in-watchlist, mood match.
5. **Graph scoring** (`graph.py`): for each candidate C and anchor A: paths `C → entity ← A` weighted by
   relation (director 1.0, writer 0.9, series 1.2, cast 0.45, keyword 0.35, award 0.25 …) / log(2 + degree) × w(A),
   plus direct title-title edges (based on, sequel). Per-anchor contribution is capped. The best positive path
   is the explanation: *"Same writer (Quentin Tarantino) as Pulp Fiction, which you rated 5"*.
6. **Learning to rank** (`ltr.py`): LightGBM LambdaRank. Training rows = your rated/swiped titles with 5-fold
   leave-out profiles (no leakage) + logged impressions that later got feedback. Needs ≥ 30 labels; until then
   a rank-normalised hand blend (`features.DEFAULT_WEIGHTS`) is used. Retrains every 10 new feedback events
   (background thread) and nightly.
7. **Diversity**: MMR on embeddings (λ = 0.8). Default lists are half films, half series.
8. **Exploration** (`bandit.py`): 24 k-means clusters of the embedding space are Thompson-sampling arms; ~12 %
   of slots go to the best candidate of the sampled arm, marked "Exploring". Any feedback updates the arm.
9. **NL queries** (`nlquery.py`): the LLM turns the request into a JSON intent (anchors, mood, runtime,
   platforms, genres, vibe); a regex parser is the fallback. Anchor + vibe embeddings add boosts and extra
   candidates; the normal pipeline ranks; the LLM reranks the top 30 and writes one line each.
   Provider is pluggable: `LLM_PROVIDER=anthropic|openai_compat|ollama|none`, default Claude (`claude-opus-5-5`)
   with structured JSON output, low effort, and the server-side refusal fallback enabled.

## Swipe deck (active learning, `active.py`)

Pool = the ~3000 most popular allowed titles with embeddings, PCA to 48 dims. Bayesian linear regression
(prior λI) on your labels gives a posterior covariance S. Next card maximises
`p_seen × (√(xᵀSx) + 0.6·coverage + 0.15·|μᵀx|)`, sampled among the top 5. Coverage = 1 − max cosine to
anything already labelled; `p_seen` is a logistic on popularity percentile (within kind) that shifts toward
popular titles as your recent "not seen" rate rises. Films and series alternate. Right = like, left = dislike,
up = love, down = not seen (not a taste signal, but keeps the title eligible for recommendations).

## Learning loop

Every swipe/rating is written immediately and the next request reads the new profile (CF user vector is
folded in on the fly, graph and embedding features use the current anchors). The worker container polls RSS
every 30 min, runs the incremental LTR check every minute and the full retrain (graph, embeddings for new
titles, clusters, ALS, LTR) nightly at `NIGHTLY_RETRAIN_HOUR`.

## Letterboxd round trip

- In: export ZIP (Settings → Data), uploaded in the app or `cinegraph import-letterboxd`. RSS for new diary entries.
- Out: `cinegraph export-letterboxd` or the app's Import/Export page → CSVs with `tmdbID`, `imdbID`, `Title`,
  `Year`, `Directors`, `Rating`, `WatchedDate`, `Rewatch`, `Tags`, `Review`, split under the 1 MB limit. You
  upload them at letterboxd.com/import (diary/ratings/watched) and on your watchlist page (watchlist). Only films:
  Letterboxd doesn't catalogue series. Data that came *from* Letterboxd is not re-exported unless asked.
  Swipe "likes" are exported as watched, not as star ratings.

## Web app (web/)

Next.js App Router + Tailwind, installable PWA (manifest + service worker). `/api/*` is rewritten to the
FastAPI service. Screens: Home (for you + NL search), Swipe, Tonight, Watchlist, Graph, Title detail, Import/Export.
