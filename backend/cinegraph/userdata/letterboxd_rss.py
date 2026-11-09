"""Poll the user's *public* Letterboxd RSS feed (https://letterboxd.com/<user>/rss/).

Each diary item carries letterboxd:filmTitle / filmYear / memberRating / watchedDate /
rewatch and, conveniently, tmdb:movieId, so matching is exact when that tag is present.
This is the feed Letterboxd publishes for readers; we fetch it at most every
RSS_POLL_MINUTES with a conditional GET.
"""
from __future__ import annotations

import logging
import xml.etree.ElementTree as ET
from dataclasses import dataclass

import httpx

from .. import db
from ..config import get_settings
from ..textnorm import norm_title
from .matcher import resolve

log = logging.getLogger(__name__)

NS = {"letterboxd": "https://letterboxd.com", "tmdb": "https://themoviedb.org", "dc": "http://purl.org/dc/elements/1.1/"}


@dataclass
class RssEntry:
    guid: str
    title: str
    year: int | None
    rating: float | None
    watched_date: str | None
    rewatch: bool
    tmdb_movie_id: int | None
    tmdb_tv_id: int | None
    link: str | None


def parse_feed(xml: str | bytes) -> list[RssEntry]:
    root = ET.fromstring(xml)
    out = []
    for item in root.iter("item"):
        guid = (item.findtext("guid") or "").strip()
        title = item.findtext("letterboxd:filmTitle", namespaces=NS)
        if not title or guid.startswith("letterboxd-list"):
            continue  # lists, or anything that isn't a diary/review entry

        def num(tag: str, cast=float):
            v = item.findtext(tag, namespaces=NS)
            try:
                return cast(v) if v not in (None, "") else None
            except ValueError:
                return None

        out.append(RssEntry(
            guid=guid,
            title=title.strip(),
            year=num("letterboxd:filmYear", int),
            rating=num("letterboxd:memberRating"),
            watched_date=item.findtext("letterboxd:watchedDate", namespaces=NS),
            rewatch=(item.findtext("letterboxd:rewatch", namespaces=NS) or "").lower() == "yes",
            tmdb_movie_id=num("tmdb:movieId", int),
            tmdb_tv_id=num("tmdb:tvId", int),
            link=item.findtext("link"),
        ))
    return out


def _title_for(e: RssEntry) -> int | None:
    for kind, tid in (("movie", e.tmdb_movie_id), ("tv", e.tmdb_tv_id)):
        if tid:
            row = db.fetchone("SELECT id FROM titles WHERE kind = %s AND tmdb_id = %s", (kind, tid))
            if row:
                return row["id"]
            # unknown locally: add a stub, the TMDB crawl fills it in
            with db.connect() as conn:
                row = conn.execute(
                    "INSERT INTO titles (kind, tmdb_id, title, norm_title, year, source) "
                    "VALUES (%s, %s, %s, %s, %s, 'tmdb') ON CONFLICT (kind, tmdb_id) DO UPDATE "
                    "SET kind = EXCLUDED.kind RETURNING id", (kind, tid, e.title, norm_title(e.title), e.year)).fetchone()
                conn.commit()
            return row["id"]
    m = resolve(e.title, e.year, kind_hint="movie")
    return m.candidate.id if m else None


def apply_entries(entries: list[RssEntry]) -> int:
    new = 0
    for e in entries:
        if db.fetchone("SELECT 1 FROM diary WHERE external_id = %s", (e.guid,)):
            continue
        tid = _title_for(e)
        if tid is None:
            db.execute("INSERT INTO pending_matches (source, name, year) VALUES ('rss', %s, %s) "
                       "ON CONFLICT DO NOTHING", (e.title, e.year))
            continue
        with db.connect() as conn:
            conn.execute(
                "INSERT INTO diary (title_id, watched_date, rating, rewatch, source, external_id) "
                "VALUES (%s, %s, %s, %s, 'rss', %s) ON CONFLICT (external_id) DO NOTHING",
                (tid, e.watched_date, e.rating, e.rewatch, e.guid))
            conn.execute("INSERT INTO user_watched (title_id, source) VALUES (%s, 'rss') ON CONFLICT DO NOTHING",
                         (tid,))
            if e.rating:
                conn.execute(
                    "INSERT INTO user_ratings (title_id, rating, source) VALUES (%s, %s, 'rss') "
                    "ON CONFLICT (title_id) DO UPDATE SET rating = EXCLUDED.rating, source = 'rss', rated_at = now()",
                    (tid, e.rating))
            conn.execute("DELETE FROM watchlist WHERE title_id = %s AND status = 'want'", (tid,))
            conn.commit()
        new += 1
    return new


def poll(username: str | None = None) -> dict:
    s = get_settings()
    username = username or s.letterboxd_username
    state = db.get_job_state("rss")
    headers = {"User-Agent": "CineGraph/0.1 (personal RSS reader)"}
    if state.get("etag"):
        headers["If-None-Match"] = state["etag"]
    if state.get("last_modified"):
        headers["If-Modified-Since"] = state["last_modified"]
    r = httpx.get(f"https://letterboxd.com/{username}/rss/", headers=headers, timeout=30, follow_redirects=True)
    if r.status_code == 304:
        return {"status": "not modified", "new": 0}
    r.raise_for_status()
    entries = parse_feed(r.content)
    new = apply_entries(entries)
    db.set_job_state("rss", {"etag": r.headers.get("ETag"), "last_modified": r.headers.get("Last-Modified"),
                             "items": len(entries), "new": new})
    log.info("rss: %d items, %d new diary entries", len(entries), new)
    return {"status": "ok", "items": len(entries), "new": new}
