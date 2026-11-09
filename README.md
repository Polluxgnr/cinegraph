# CineGraph

A personal film **and** series recommender: a knowledge graph, content embeddings, collaborative
filtering and a learned ranker, with a Tinder-style swipe deck to calibrate your taste, a "Tonight" screen
filtered by mood and by your streaming services, and natural-language search ("like Fauda but funnier,
under 2h, on Netflix"). It reads your Letterboxd data through official routes only and writes CSVs you
upload with Letterboxd's own importer.

How it works: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## What it does and doesn't touch

- TMDB API (your own free key), Wikidata SPARQL, MovieLens (GroupLens, personal/research use).
- Letterboxd: the export ZIP you download, your public RSS feed, and import CSVs you upload yourself.
  It never scrapes letterboxd.com and never logs in or posts as you.
- Streaming availability = TMDB/JustWatch data for France, legal platforms only.

## 1. Get a TMDB key (free, 2 minutes)

1. Create an account at <https://www.themoviedb.org/signup> and confirm the e-mail.
2. Go to <https://www.themoviedb.org/settings/api>, click **Create** → **Developer**, accept the terms,
   and describe the use as "personal, non-commercial recommender".
3. Copy the **API Read Access Token** (the long one starting with `eyJ`). The short "API Key" works too.
4. `cp .env.example .env` and paste it after `TMDB_API_KEY=` in `.env`.

Keep the key in `.env` only (it's git-ignored). Don't paste it into chats or commit it.

Optional: put an Anthropic API key in `ANTHROPIC_API_KEY` for the LLM rerank and one-line explanations of
natural-language queries (default model `claude-opus-5-5`, change with `LLM_MODEL` / `LLM_PROVIDER`).
Without it, queries are parsed by rules and explained by graph paths.

## 2. Run it

```bash
cp .env.example .env          # then edit TMDB_API_KEY
docker compose up -d --build  # db, api :8000, worker, web :3000
```

Ingest a subset (minutes, not days) and build the models:

```bash
docker compose exec api cinegraph ingest movielens                    # MovieLens small: links + CF ratings
docker compose exec api cinegraph ingest tmdb --top-movies 3000 --top-tv 1500
docker compose exec api cinegraph ingest wikidata --tv-bootstrap 1200 # awards, based on, influences ...
docker compose exec api cinegraph build all                           # graph, embeddings, clusters, ALS, LTR
docker compose exec api cinegraph seed-watchlist                      # docs/seed_watchlist.md
```

No TMDB key yet? Skip the `ingest tmdb` line: MovieLens + Wikidata give a working catalogue of ~3.6k films
and ~1.1k series (no posters, no streaming data, so "Tonight" needs "any availability"). Titles that aren't in
the catalogue are looked up on Wikidata by name when you import or seed. Run the TMDB crawl later and then
`cinegraph build all` again, plus `cinegraph seed-watchlist` to retry unmatched titles; the crawl is resumable
(`--limit 500` to do it in chunks, `--full` for the whole TMDB catalogue, which takes days).
For more CF signal: `MOVIELENS_VARIANT=ml-32m` in `.env`, then `cinegraph ingest movielens` and `cinegraph build cf`.

Open <http://localhost:3000>. In Chrome/Edge use "Install app" to get the PWA; on a phone on the same
network, browse to the PC's address (the ports are bound to 127.0.0.1 by default; change that in
`docker-compose.yml` if you want LAN access).

## 3. Letterboxd

- **Import**: letterboxd.com → Settings → Data → *Export your data*. Upload the ZIP on the app's
  *Import* page, or:
  ```bash
  docker compose cp ~/Downloads/letterboxd-polluxgnr-*.zip api:/tmp/lb.zip
  docker compose exec api cinegraph import-letterboxd /tmp/lb.zip
  ```
  Unmatched titles are listed (and kept in `pending_matches`). To try the flow first, there's a small sample
  export with the five films from your brief: `backend/tests/fixtures/sample-letterboxd-export.zip`.
- **New diary entries**: the worker polls `https://letterboxd.com/polluxgnr/rss/` every 30 min
  (`cinegraph sync-rss` to do it now).
- **Back to Letterboxd**: *Import* page → "Download Letterboxd CSVs" (or `cinegraph export-letterboxd`),
  then upload `letterboxd-diary.csv` / `-ratings.csv` / `-watched.csv` at <https://letterboxd.com/import/>
  and `letterboxd-watchlist.csv` with the import button on your watchlist page. Films only.

## 4. Use it

- **Swipe**: right = liked, left = disliked, up = loved, down = not seen (also arrow keys). The deck picks
  the most informative next card; about 50 swipes give a usable profile.
- **Tonight**: pick a mood (tense, laugh, mind-bending, horror, epic) and film/series; only titles streaming
  on your platforms in France (Netflix, Prime Video, Disney+, HBO Max, Canal+, Apple TV+; change in the app).
- **Home**: recommendations with a reason each, plus free-text search.
- **Graph**: explore how your favourites connect (people, awards, adaptations, themes).

Every rating or swipe changes the next recommendations immediately. The ranker retrains after every 10
new feedback events and everything retrains nightly (worker container).

Hard filters (no romance, no musicals, no laugh-track sitcoms) live in
`backend/cinegraph/config/hard_filters.yaml`.

## Commands

```bash
docker compose exec api cinegraph --help
docker compose exec api cinegraph recommend --n 10
docker compose exec api cinegraph query "like Fauda but funnier, under 2h, on Netflix"
docker compose exec api cinegraph train-ltr
```

## Development

```bash
cd backend
uv venv --python 3.12 .venv && uv pip install -e ".[dev]"
.venv/Scripts/python -m pytest          # (Linux/macOS: .venv/bin/python)
docker compose up -d db                  # Postgres on 127.0.0.1:5433 for local runs
cd ../web && npm install && npm run dev  # BACKEND_URL=http://127.0.0.1:8000
```

Data and models live in `./data` (git-ignored). TMDB requires attribution: this product uses the TMDB API
but is not endorsed or certified by TMDB.
