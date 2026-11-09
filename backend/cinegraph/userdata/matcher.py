"""Title + year matcher used by the Letterboxd import, the seed watchlist and NL queries.

Pure scoring (`best_match`) is separated from the DB lookup (`match_local`) so it can
be unit-tested without Postgres.
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass

from rapidfuzz import fuzz

from ..textnorm import norm_title

MIN_SCORE = 0.72


@dataclass
class Candidate:
    id: int
    kind: str
    title: str
    original_title: str | None = None
    year: int | None = None
    popularity: float = 0.0
    aliases: tuple[str, ...] = ()


@dataclass
class Match:
    candidate: Candidate
    score: float
    reason: str


def _title_sim(q: str, cand: Candidate) -> tuple[float, str]:
    raw = [t for t in (cand.title, cand.original_title) if t]
    names = {norm_title(t) for t in raw} | set(cand.aliases)
    names.discard("")
    # "Big Vape: The Rise and Fall of Juul" is also known as "Big Vape"
    mains = {norm_title(re.split(r"\s*[:–—]\s+|\s+-\s+", t)[0]) for t in raw} - names - {""}
    best, how = 0.0, ""
    for n in names:
        if n == q:
            return 1.0, "exact title"
        s = fuzz.ratio(q, n) / 100.0
        qa, na = set(q.split()), set(n.split())
        if min(len(q), len(n)) >= 6:
            s = max(s, 0.92 * fuzz.token_set_ratio(q, n) / 100.0)
        # "Lupin III" is not "Lupin", and a bare word isn't a long title containing it
        if qa != na and (qa < na or na < qa):
            s = min(s, 0.75)
        if s > best:
            best, how = s, "fuzzy title"
    if q in mains and len(q) >= 4:
        return max(best, 0.95), "main title before subtitle"
    return best, how


def _year_factor(year: int | None, cand_year: int | None) -> tuple[float, str]:
    if year is None or cand_year is None:
        return 0.93, "no year"
    diff = abs(year - cand_year)
    if diff == 0:
        return 1.0, "same year"
    if diff == 1:
        return 0.95, "year +-1"  # festival vs. release year
    if diff == 2:
        return 0.80, "year +-2"
    return 0.45, f"year off by {diff}"


def score(query: str, year: int | None, cand: Candidate, kind_hint: str | None = None) -> tuple[float, str]:
    q = norm_title(query)
    ts, how = _title_sim(q, cand)
    yf, yhow = _year_factor(year, cand.year)
    s = ts * yf
    if kind_hint and cand.kind != kind_hint:
        s *= 0.85
    # tiny popularity tie-breaker (never decisive on its own)
    s += min(math.log1p(cand.popularity or 0) / 1000.0, 0.008)
    return s, f"{how}, {yhow}"


def best_match(query: str, year: int | None, candidates: list[Candidate],
               kind_hint: str | None = None, min_score: float = MIN_SCORE) -> Match | None:
    scored = [(score(query, year, c, kind_hint), c) for c in candidates]
    scored = [x for x in scored if x[0][0] >= min_score]
    if not scored:
        return None
    (s, why), c = max(scored, key=lambda x: x[0][0])
    return Match(candidate=c, score=round(min(s, 1.0), 4), reason=why)


def match_local(query: str, year: int | None, kind_hint: str | None = None) -> Match | None:
    """Look candidates up in Postgres (exact normalised title, aliases, then trigram)."""
    from .. import db

    q = norm_title(query)
    if not q:
        return None
    rows = db.fetchall(
        """
        WITH hits AS (
            SELECT id FROM titles WHERE norm_title = %(q)s
            UNION SELECT title_id FROM title_aliases WHERE norm_alias = %(q)s
            UNION (SELECT id FROM titles WHERE norm_title %% %(q)s
                   ORDER BY similarity(norm_title, %(q)s) DESC LIMIT 15)
        )
        SELECT t.id, t.kind, t.title, t.original_title, t.year, COALESCE(t.popularity, 0) AS popularity,
               COALESCE(array_agg(a.norm_alias) FILTER (WHERE a.norm_alias IS NOT NULL), '{}') AS aliases
        FROM titles t JOIN hits h ON h.id = t.id
        LEFT JOIN title_aliases a ON a.title_id = t.id
        GROUP BY t.id
        """,
        {"q": q},
    )
    cands = [Candidate(id=r["id"], kind=r["kind"], title=r["title"], original_title=r["original_title"],
                       year=r["year"], popularity=r["popularity"], aliases=tuple(r["aliases"]))
             for r in rows]
    return best_match(query, year, cands, kind_hint)


def resolve(query: str, year: int | None, kind_hint: str | None = None,
            allow_remote: bool = True) -> Match | None:
    """Local match first; if nothing and a TMDB key is configured, search TMDB and ingest."""
    m = match_local(query, year, kind_hint)
    if m or not allow_remote:
        return m
    from ..config import get_settings

    kinds = [kind_hint] if kind_hint else ["movie", "tv"]
    if get_settings().tmdb_api_key:
        import asyncio

        from ..ingest.tmdb_ingest import search_and_add

        for k in kinds:
            try:
                tid = asyncio.run(search_and_add(k, query, year))
            except Exception:  # noqa: BLE001
                tid = None
            if tid:
                return match_local(query, year, kind_hint) or Match(
                    Candidate(id=tid, kind=k, title=query, year=year), 0.75, "tmdb search")
    # keyless fallback: Wikidata knows the TMDB id of most notable films and series
    from ..ingest.wikidata import lookup_title

    tid = lookup_title(query, year, kind_hint)
    if tid:
        return match_local(query, year, kind_hint) or Match(
            Candidate(id=tid, kind=kind_hint or "movie", title=query, year=year), 0.75, "wikidata search")
    return None
