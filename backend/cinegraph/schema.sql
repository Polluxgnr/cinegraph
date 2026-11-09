-- CineGraph schema. Idempotent: safe to run on every start.
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- ---------------------------------------------------------------- catalogue
-- One row per film or series. TMDB movie and TV ids overlap, so the internal
-- id is ours and (kind, tmdb_id) is the natural key.
CREATE TABLE IF NOT EXISTS titles (
    id               serial PRIMARY KEY,
    kind             text NOT NULL CHECK (kind IN ('movie', 'tv')),
    tmdb_id          integer NOT NULL,
    imdb_id          text,
    wikidata_id      text,
    title            text NOT NULL,
    original_title   text,
    norm_title       text NOT NULL DEFAULT '',
    original_language text,
    year             integer,
    release_date     date,
    overview         text,
    tagline          text,
    runtime          integer,           -- minutes (movie) or typical episode length (tv)
    number_of_seasons integer,
    status           text,
    popularity       real,
    vote_average     real,
    vote_count       integer,
    poster_path      text,
    backdrop_path    text,
    genres           text[] NOT NULL DEFAULT '{}',
    keywords         text[] NOT NULL DEFAULT '{}',
    countries        text[] NOT NULL DEFAULT '{}',
    networks         text[] NOT NULL DEFAULT '{}',
    source           text NOT NULL DEFAULT 'tmdb',   -- tmdb | movielens | wikidata
    details_fetched_at  timestamptz,
    wikidata_fetched_at timestamptz,
    tmdb_attempts    integer NOT NULL DEFAULT 0,
    tmdb_error       text,
    extra            jsonb NOT NULL DEFAULT '{}',
    created_at       timestamptz NOT NULL DEFAULT now(),
    UNIQUE (kind, tmdb_id)
);
CREATE INDEX IF NOT EXISTS titles_norm_idx ON titles (norm_title);
CREATE INDEX IF NOT EXISTS titles_norm_trgm ON titles USING gin (norm_title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS titles_wikidata_idx ON titles (wikidata_id);
CREATE INDEX IF NOT EXISTS titles_imdb_idx ON titles (imdb_id);
CREATE INDEX IF NOT EXISTS titles_pending_idx ON titles (details_fetched_at) WHERE details_fetched_at IS NULL;

CREATE TABLE IF NOT EXISTS title_aliases (
    title_id   integer NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
    norm_alias text NOT NULL,
    PRIMARY KEY (title_id, norm_alias)
);
CREATE INDEX IF NOT EXISTS title_aliases_norm_idx ON title_aliases (norm_alias);

CREATE TABLE IF NOT EXISTS people (
    id             serial PRIMARY KEY,
    tmdb_person_id integer UNIQUE,
    wikidata_id    text UNIQUE,
    name           text NOT NULL,
    profile_path   text
);

CREATE TABLE IF NOT EXISTS credits (
    title_id  integer NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
    person_id integer NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    role      text NOT NULL,    -- director | writer | creator | cast | composer | dop | producer
    character text,
    ord       integer NOT NULL DEFAULT 0,
    PRIMARY KEY (title_id, person_id, role)
);
CREATE INDEX IF NOT EXISTS credits_person_idx ON credits (person_id);

CREATE TABLE IF NOT EXISTS providers (
    title_id      integer NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
    region        text NOT NULL,
    provider_id   integer NOT NULL,
    provider_name text NOT NULL,
    offer_type    text NOT NULL,   -- flatrate | free | ads | rent | buy
    logo_path     text,
    PRIMARY KEY (title_id, region, provider_id, offer_type)
);

-- Wikidata facts (awards, based on, influenced by, series, narrative location ...)
CREATE TABLE IF NOT EXISTS wikidata_facts (
    title_id  integer NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
    prop      text NOT NULL,     -- award | nominated | based_on | influenced_by | series | follows | followed_by | narrative_location | main_subject
    object_qid text NOT NULL,
    object_label text,
    PRIMARY KEY (title_id, prop, object_qid)
);

-- TMDB daily-export staging (resumable crawl queue)
CREATE TABLE IF NOT EXISTS tmdb_export (
    kind       text NOT NULL,
    tmdb_id    integer NOT NULL,
    name       text,
    popularity real,
    adult      boolean NOT NULL DEFAULT false,
    export_date date NOT NULL,
    PRIMARY KEY (kind, tmdb_id)
);
CREATE INDEX IF NOT EXISTS tmdb_export_pop_idx ON tmdb_export (kind, popularity DESC);

-- MovieLens <-> TMDB mapping
CREATE TABLE IF NOT EXISTS ml_links (
    movielens_id integer PRIMARY KEY,
    imdb_id      text,
    tmdb_id      integer,
    title_id     integer REFERENCES titles(id) ON DELETE SET NULL,
    n_ratings    integer NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------- user data
CREATE TABLE IF NOT EXISTS user_ratings (
    title_id  integer PRIMARY KEY REFERENCES titles(id) ON DELETE CASCADE,
    rating    real NOT NULL CHECK (rating >= 0.5 AND rating <= 5),
    source    text NOT NULL,      -- letterboxd | rss | app | swipe
    rated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_watched (
    title_id   integer PRIMARY KEY REFERENCES titles(id) ON DELETE CASCADE,
    watched_at timestamptz NOT NULL DEFAULT now(),
    source     text NOT NULL
);

CREATE TABLE IF NOT EXISTS user_likes (
    title_id integer PRIMARY KEY REFERENCES titles(id) ON DELETE CASCADE,
    source   text NOT NULL,
    liked_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS diary (
    id           serial PRIMARY KEY,
    title_id     integer NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
    watched_date date,
    rating       real,
    rewatch      boolean NOT NULL DEFAULT false,
    review       text,
    tags         text,
    source       text NOT NULL,
    external_id  text UNIQUE,     -- letterboxd URI or RSS guid, dedupe key
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS watchlist (
    title_id integer PRIMARY KEY REFERENCES titles(id) ON DELETE CASCADE,
    status   text NOT NULL DEFAULT 'want' CHECK (status IN ('want', 'watching')),
    source   text NOT NULL,
    note     text,
    added_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS swipes (
    id         serial PRIMARY KEY,
    title_id   integer NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
    action     text NOT NULL CHECK (action IN ('like', 'dislike', 'love', 'unseen')),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS swipes_title_idx ON swipes (title_id);

-- Imports we could not match to a title; kept for manual resolution / retry
CREATE TABLE IF NOT EXISTS pending_matches (
    id         serial PRIMARY KEY,
    source     text NOT NULL,
    name       text NOT NULL,
    year       integer,
    kind_hint  text,
    payload    jsonb NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (source, name, year)
);

-- Every recommendation we show, with the features at serve time -> LTR training data
CREATE TABLE IF NOT EXISTS impressions (
    id         bigserial PRIMARY KEY,
    request_id text NOT NULL,
    surface    text NOT NULL,      -- recs | tonight | query
    title_id   integer NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
    position   integer NOT NULL,
    features   jsonb NOT NULL,
    explore    boolean NOT NULL DEFAULT false,
    arm        integer,
    shown_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS impressions_title_idx ON impressions (title_id);

CREATE TABLE IF NOT EXISTS bandit_arms (
    arm   integer PRIMARY KEY,
    alpha real NOT NULL DEFAULT 1,
    beta  real NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS app_settings (
    key   text PRIMARY KEY,
    value jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS job_state (
    job        text PRIMARY KEY,
    state      jsonb NOT NULL DEFAULT '{}',
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- knowledge graph
CREATE TABLE IF NOT EXISTS kg_nodes (
    id     bigserial PRIMARY KEY,
    type   text NOT NULL,   -- title | person | keyword | genre | country | decade | award | work | location | series | subject
    key    text NOT NULL,
    label  text NOT NULL,
    degree integer NOT NULL DEFAULT 0,
    UNIQUE (type, key)
);

CREATE TABLE IF NOT EXISTS kg_edges (
    src    bigint NOT NULL REFERENCES kg_nodes(id) ON DELETE CASCADE,
    dst    bigint NOT NULL REFERENCES kg_nodes(id) ON DELETE CASCADE,
    rel    text NOT NULL,   -- directed_by | written_by | created_by | stars | scored_by | shot_by | has_keyword | has_genre | from_country | in_decade | won | nominated_for | based_on | influenced_by | part_of_series | follows | set_in | about
    weight real NOT NULL DEFAULT 1,
    PRIMARY KEY (src, dst, rel)
);
CREATE INDEX IF NOT EXISTS kg_edges_dst_idx ON kg_edges (dst);

-- ---------------------------------------------------------------- embeddings
CREATE TABLE IF NOT EXISTS title_embeddings (
    title_id  integer PRIMARY KEY REFERENCES titles(id) ON DELETE CASCADE,
    model     text NOT NULL,
    embedding vector(384) NOT NULL,
    text_hash text NOT NULL
);
CREATE INDEX IF NOT EXISTS title_embeddings_hnsw ON title_embeddings USING hnsw (embedding vector_cosine_ops);
