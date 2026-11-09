"""Import the official Letterboxd export ZIP (Settings -> Data -> Export your data).

Files used: ratings.csv, diary.csv, watched.csv, watchlist.csv, reviews.csv, likes/films.csv.
Letterboxd's export has no TMDB ids, so every row is matched on title + year.
"""
from __future__ import annotations

import csv
import io
import logging
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Iterable

from .. import db
from .matcher import Match, resolve

log = logging.getLogger(__name__)

FILES = ("ratings.csv", "diary.csv", "watched.csv", "watchlist.csv", "reviews.csv", "likes/films.csv")


@dataclass
class ImportReport:
    rows: dict[str, int] = field(default_factory=dict)
    matched: dict[str, int] = field(default_factory=dict)
    unmatched: list[dict] = field(default_factory=list)


def read_zip(path_or_bytes: str | Path | bytes) -> dict[str, list[dict]]:
    """Return {file_name: rows} for the known CSVs (case/folder-insensitive)."""
    src = io.BytesIO(path_or_bytes) if isinstance(path_or_bytes, bytes) else path_or_bytes
    out: dict[str, list[dict]] = {}
    with zipfile.ZipFile(src) as zf:
        names = {n.lower().replace("\\", "/"): n for n in zf.namelist()}
        for f in FILES:
            real = next((names[n] for n in names if n == f or n.endswith("/" + f)), None)
            # don't confuse deleted/ or orphaned/ copies with the live data
            if real is None or "/deleted/" in "/" + real.lower() or "orphaned" in real.lower():
                continue
            with zf.open(real) as fh:
                out[f] = list(csv.DictReader(io.TextIOWrapper(fh, encoding="utf-8-sig")))
    return out


def _year(v: str | None) -> int | None:
    try:
        return int(v) if v else None
    except ValueError:
        return None


def _rating(v: str | None) -> float | None:
    try:
        r = float(v) if v else None
    except ValueError:
        return None
    return r if r and 0.5 <= r <= 5 else None


def import_rows(files: dict[str, list[dict]],
                resolver: Callable[[str, int | None], Match | None] | None = None) -> ImportReport:
    resolver = resolver or (lambda name, year: resolve(name, year, kind_hint="movie"))
    rep = ImportReport()
    cache: dict[tuple[str, int | None], Match | None] = {}

    def match(row: dict) -> int | None:
        key = (row.get("Name", "").strip(), _year(row.get("Year")))
        if key not in cache:
            cache[key] = resolver(*key) if key[0] else None
        m = cache[key]
        return m.candidate.id if m else None

    with db.connect() as conn:
        def each(fname: str) -> Iterable[tuple[dict, int]]:
            rows = files.get(fname, [])
            rep.rows[fname] = len(rows)
            ok = 0
            for r in rows:
                tid = match(r)
                if tid is None:
                    rep.unmatched.append({"file": fname, "name": r.get("Name"), "year": r.get("Year")})
                    conn.execute(
                        "INSERT INTO pending_matches (source, name, year, kind_hint, payload) "
                        "VALUES ('letterboxd', %s, %s, 'movie', '{}') ON CONFLICT DO NOTHING",
                        (r.get("Name"), _year(r.get("Year"))))
                    continue
                ok += 1
                yield r, tid
            rep.matched[fname] = ok

        for r, tid in each("watched.csv"):
            conn.execute("INSERT INTO user_watched (title_id, watched_at, source) VALUES (%s, %s, 'letterboxd') "
                         "ON CONFLICT (title_id) DO NOTHING", (tid, r.get("Date") or None))
        for r, tid in each("ratings.csv"):
            rt = _rating(r.get("Rating"))
            if rt:
                conn.execute(
                    """INSERT INTO user_ratings (title_id, rating, source, rated_at)
                       VALUES (%s, %s, 'letterboxd', COALESCE(%s::timestamptz, now()))
                       ON CONFLICT (title_id) DO UPDATE SET rating = EXCLUDED.rating, rated_at = EXCLUDED.rated_at,
                         source = EXCLUDED.source
                       WHERE user_ratings.rated_at <= EXCLUDED.rated_at""",
                    (tid, rt, r.get("Date") or None))
            conn.execute("INSERT INTO user_watched (title_id, source) VALUES (%s, 'letterboxd') "
                         "ON CONFLICT DO NOTHING", (tid,))
        for fname in ("diary.csv", "reviews.csv"):
            for r, tid in each(fname):
                conn.execute(
                    """INSERT INTO diary (title_id, watched_date, rating, rewatch, review, tags, source, external_id)
                       VALUES (%s, %s, %s, %s, %s, %s, 'letterboxd', %s)
                       ON CONFLICT (external_id) DO UPDATE SET
                         review = COALESCE(EXCLUDED.review, diary.review),
                         rating = COALESCE(EXCLUDED.rating, diary.rating)""",
                    (tid, r.get("Watched Date") or r.get("Date") or None, _rating(r.get("Rating")),
                     (r.get("Rewatch") or "").lower() == "yes", r.get("Review") or None, r.get("Tags") or None,
                     r.get("Letterboxd URI") or f"lb:{fname}:{tid}:{r.get('Watched Date')}"))
                conn.execute("INSERT INTO user_watched (title_id, source) VALUES (%s, 'letterboxd') "
                             "ON CONFLICT DO NOTHING", (tid,))
        for r, tid in each("watchlist.csv"):
            if conn.execute("SELECT 1 FROM user_watched WHERE title_id = %s", (tid,)).fetchone():
                continue
            conn.execute("INSERT INTO watchlist (title_id, source, added_at) VALUES (%s, 'letterboxd', "
                         "COALESCE(%s::timestamptz, now())) ON CONFLICT DO NOTHING", (tid, r.get("Date") or None))
        for r, tid in each("likes/films.csv"):
            conn.execute("INSERT INTO user_likes (title_id, source) VALUES (%s, 'letterboxd') "
                         "ON CONFLICT DO NOTHING", (tid,))
        # anything watched is no longer "want to watch"
        conn.execute("DELETE FROM watchlist w USING user_watched u WHERE u.title_id = w.title_id "
                     "AND w.status = 'want' AND u.source = 'letterboxd'")
        conn.commit()
    log.info("letterboxd import: %s matched of %s rows, %d unmatched", rep.matched, rep.rows, len(rep.unmatched))
    return rep


def import_zip(path_or_bytes, resolver=None) -> ImportReport:
    return import_rows(read_zip(path_or_bytes), resolver)
