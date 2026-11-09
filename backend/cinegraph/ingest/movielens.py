"""MovieLens import (GroupLens; personal / research use only, never redistributed).

- links.csv  -> ml_links (movieId -> tmdbId / imdbId)
- movies.csv -> stub titles for movies that TMDB hasn't given us yet (title, year, genres)
- tags.csv   -> keyword hints for those stubs
- ratings.csv-> data/movielens/<variant>/ratings.npz (user, title_id, rating) for ALS
"""
from __future__ import annotations

import array
import csv
import io
import logging
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

import httpx
import numpy as np

from .. import db
from ..config import get_settings
from ..textnorm import movielens_title, norm_title, split_title_year

log = logging.getLogger(__name__)

URLS = {
    "ml-latest-small": "https://files.grouplens.org/datasets/movielens/ml-latest-small.zip",
    "ml-32m": "https://files.grouplens.org/datasets/movielens/ml-32m.zip",
}
GENRE_MAP = {"Sci-Fi": "Science Fiction", "Children": "Family", "Musical": "Music", "Film-Noir": "Crime",
             "IMAX": None, "(no genres listed)": None}


def ml_dir(variant: str) -> Path:
    p = get_settings().data_dir / "movielens" / variant
    p.mkdir(parents=True, exist_ok=True)
    return p


def download(variant: str) -> Path:
    dest = ml_dir(variant) / f"{variant}.zip"
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    log.info("downloading %s", URLS[variant])
    tmp = dest.with_suffix(".part")
    with httpx.stream("GET", URLS[variant], timeout=600, follow_redirects=True) as r:
        r.raise_for_status()
        with open(tmp, "wb") as fh:
            for chunk in r.iter_bytes(1 << 20):
                fh.write(chunk)
    tmp.replace(dest)
    return dest


def _open_csv(zf: zipfile.ZipFile, name: str):
    member = next(n for n in zf.namelist() if n.endswith("/" + name))
    return csv.DictReader(io.TextIOWrapper(zf.open(member), encoding="utf-8"))


def import_movielens(variant: str | None = None, min_ratings: int = 5) -> dict:
    variant = variant or get_settings().movielens_variant
    zpath = download(variant)
    with zipfile.ZipFile(zpath) as zf:
        links = {int(r["movieId"]): (r["imdbId"], int(r["tmdbId"]) if r["tmdbId"] else None)
                 for r in _open_csv(zf, "links.csv")}
        movies = {int(r["movieId"]): r for r in _open_csv(zf, "movies.csv")}
        tags: dict[int, Counter] = defaultdict(Counter)
        try:
            for r in _open_csv(zf, "tags.csv"):
                t = r["tag"].strip().lower()
                if 2 < len(t) < 40:
                    tags[int(r["movieId"])][t] += 1
        except StopIteration:
            pass

        # ratings: stream into numpy arrays (32M rows fits in ~400 MB as int32/float32)
        users, items, vals = array.array("i"), array.array("i"), array.array("f")
        counts: Counter = Counter()
        member = next(n for n in zf.namelist() if n.endswith("/ratings.csv"))
        with io.TextIOWrapper(zf.open(member), encoding="utf-8") as fh:
            next(fh)  # header: userId,movieId,rating,timestamp
            for line in fh:
                a, b, c, _ = line.split(",", 3)
                m = int(b)
                users.append(int(a))
                items.append(m)
                vals.append(float(c))
        counts.update(items)

    with db.connect() as conn:
        created = 0
        for mid, (imdb, tmdb) in links.items():
            if not tmdb or counts[mid] < min_ratings:
                continue
            mv = movies.get(mid)
            raw_title, year = split_title_year(mv["title"]) if mv else ("?", None)
            title = movielens_title(raw_title)
            genres = [g2 for g in (mv["genres"].split("|") if mv else [])
                      if (g2 := GENRE_MAP.get(g, g))]
            kw = [t for t, c in tags[mid].most_common(15) if c >= 1]
            cur = conn.execute(
                """
                INSERT INTO titles (kind, tmdb_id, imdb_id, title, norm_title, year, genres, keywords,
                                    popularity, vote_count, source)
                VALUES ('movie', %s, %s, %s, %s, %s, %s, %s, %s, %s, 'movielens')
                ON CONFLICT (kind, tmdb_id) DO UPDATE SET
                    imdb_id = COALESCE(titles.imdb_id, EXCLUDED.imdb_id),
                    genres = CASE WHEN titles.source = 'movielens' THEN EXCLUDED.genres ELSE titles.genres END,
                    keywords = CASE WHEN titles.source = 'movielens' THEN EXCLUDED.keywords ELSE titles.keywords END
                RETURNING id, (xmax = 0) AS inserted
                """,
                (tmdb, f"tt{imdb}" if imdb else None, title, norm_title(title), year, genres, kw,
                 # popularity proxy until TMDB fills the real value
                 float(np.log1p(counts[mid]) * 3), counts[mid]),
            ).fetchone()
            created += int(cur["inserted"])
            conn.execute(
                """
                INSERT INTO ml_links (movielens_id, imdb_id, tmdb_id, title_id, n_ratings)
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT (movielens_id) DO UPDATE SET title_id = EXCLUDED.title_id, n_ratings = EXCLUDED.n_ratings
                """,
                (mid, imdb, tmdb, cur["id"], counts[mid]),
            )
            if title.lower() != raw_title.lower():
                conn.execute("INSERT INTO title_aliases VALUES (%s, %s) ON CONFLICT DO NOTHING",
                             (cur["id"], norm_title(raw_title)))
        conn.commit()
        mapping = {r["movielens_id"]: r["title_id"] for r in
                   conn.execute("SELECT movielens_id, title_id FROM ml_links WHERE title_id IS NOT NULL")}

    u = np.frombuffer(users, dtype=np.int32)
    i_ml = np.frombuffer(items, dtype=np.int32)
    v = np.frombuffer(vals, dtype=np.float32)
    lut = np.full(int(i_ml.max()) + 1 if len(i_ml) else 1, -1, dtype=np.int32)
    for mid, tid in mapping.items():
        if mid < len(lut):
            lut[mid] = tid
    title_ids = lut[i_ml]
    keep = title_ids >= 0
    out = ml_dir(variant) / "ratings.npz"
    np.savez_compressed(out, user=u[keep], title_id=title_ids[keep], rating=v[keep])
    db.set_job_state("movielens", {"variant": variant, "ratings": int(keep.sum())})
    log.info("movielens %s: %d links, %d new stub titles, %d ratings kept", variant, len(mapping), created,
             int(keep.sum()))
    return {"links": len(mapping), "new_titles": created, "ratings": int(keep.sum())}
