"""Export ratings / diary / watched / watchlist as CSVs for Letterboxd's own importer
(https://letterboxd.com/import/ and the watchlist page's "Import" button).

Importer columns: LetterboxdURI, tmdbID, imdbID, Title, Year, Directors, WatchedDate,
Rating (0.5-5 in half steps), Rating10, Rewatch, Tags, Review. We always send tmdbID and
imdbID so Letterboxd matches exactly. Letterboxd catalogues films, so series are left out.
Files are split to stay under the importer's 1 MB limit.
"""
from __future__ import annotations

import csv
import io
from pathlib import Path

from .. import db

COLUMNS = {
    "ratings": ["tmdbID", "imdbID", "Title", "Year", "Directors", "Rating"],
    "diary": ["tmdbID", "imdbID", "Title", "Year", "Directors", "WatchedDate", "Rating", "Rewatch", "Tags", "Review"],
    "watched": ["tmdbID", "imdbID", "Title", "Year", "Directors"],
    "watchlist": ["tmdbID", "imdbID", "Title", "Year", "Directors"],
}
MAX_BYTES = 900_000


def lb_rating(r: float | None) -> str:
    """Letterboxd accepts 0.5..5 in half-star steps."""
    if r is None:
        return ""
    r = min(5.0, max(0.5, round(float(r) * 2) / 2))
    return f"{r:g}"


def to_row(kind: str, rec: dict) -> dict:
    row = {
        "tmdbID": rec.get("tmdb_id") or "",
        "imdbID": rec.get("imdb_id") or "",
        "Title": rec.get("title") or "",
        "Year": rec.get("year") or "",
        "Directors": ", ".join(rec.get("directors") or []),
    }
    if kind in ("ratings", "diary"):
        row["Rating"] = lb_rating(rec.get("rating"))
    if kind == "diary":
        wd = rec.get("watched_date")
        row["WatchedDate"] = wd.isoformat() if hasattr(wd, "isoformat") else (wd or "")
        row["Rewatch"] = "Yes" if rec.get("rewatch") else ""
        row["Tags"] = rec.get("tags") or ""
        row["Review"] = rec.get("review") or ""
    return {c: row.get(c, "") for c in COLUMNS[kind]}


def render_csv(kind: str, records: list[dict]) -> list[str]:
    """Return one or more CSV documents (split under MAX_BYTES)."""
    docs: list[str] = []
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=COLUMNS[kind], lineterminator="\n")
    w.writeheader()
    header_len = buf.tell()
    for rec in records:
        if rec.get("kind", "movie") != "movie":
            continue
        line = io.StringIO()
        csv.DictWriter(line, fieldnames=COLUMNS[kind], lineterminator="\n").writerow(to_row(kind, rec))
        if buf.tell() + len(line.getvalue().encode()) > MAX_BYTES and buf.tell() > header_len:
            docs.append(buf.getvalue())
            buf = io.StringIO()
            w = csv.DictWriter(buf, fieldnames=COLUMNS[kind], lineterminator="\n")
            w.writeheader()
        buf.write(line.getvalue())
    docs.append(buf.getvalue())
    return docs


_BASE = """
    SELECT t.kind, t.tmdb_id, t.imdb_id, t.title, t.year,
           ARRAY(SELECT p.name FROM credits c JOIN people p ON p.id = c.person_id
                 WHERE c.title_id = t.id AND c.role = 'director' ORDER BY p.name) AS directors
"""


def fetch_records(kind: str, include_letterboxd: bool = False) -> list[dict]:
    """By default only data created in CineGraph (not what came from Letterboxd) is exported,
    so re-importing never duplicates diary entries."""
    src = "" if include_letterboxd else "AND x.source NOT IN ('letterboxd', 'rss')"
    if kind == "ratings":
        sql = f"{_BASE}, x.rating FROM user_ratings x JOIN titles t ON t.id = x.title_id WHERE x.source <> 'swipe' {src}"
    elif kind == "diary":
        sql = (f"{_BASE}, x.rating, x.watched_date, x.rewatch, x.tags, x.review FROM diary x "
               f"JOIN titles t ON t.id = x.title_id WHERE true {src} ORDER BY x.watched_date")
    elif kind == "watched":
        sql = f"{_BASE} FROM user_watched x JOIN titles t ON t.id = x.title_id WHERE true {src}"
    elif kind == "watchlist":
        sql = f"{_BASE} FROM watchlist x JOIN titles t ON t.id = x.title_id WHERE x.status = 'want' {src}"
    else:
        raise ValueError(kind)
    return db.fetchall(sql)


def export_all(out_dir: Path, include_letterboxd: bool = False) -> dict[str, list[str]]:
    out_dir.mkdir(parents=True, exist_ok=True)
    written: dict[str, list[str]] = {}
    for kind in COLUMNS:
        docs = render_csv(kind, fetch_records(kind, include_letterboxd))
        names = []
        for i, doc in enumerate(docs):
            name = f"letterboxd-{kind}{'' if len(docs) == 1 else f'-{i + 1}'}.csv"
            (out_dir / name).write_text(doc, encoding="utf-8")
            names.append(name)
        written[kind] = names
    return written
