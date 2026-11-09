"""Wikidata enrichment through the public SPARQL endpoint.

- resolve: titles without a Wikidata id get one via their TMDB id (P4947 / P4983) or IMDb id (P345)
- facts:   awards, nominations, based on, influenced by, part of series, follows / followed by,
           narrative location, main subject. For titles that TMDB hasn't filled (MovieLens /
           Wikidata stubs, i.e. when no TMDB key is configured) we also take the core facts:
           director, writers, cast, creators, composer, genres, countries, year, runtime.
- bootstrap_tv: seed the catalogue with the best-known TV series (by sitelink count) so the
  app has series even before a TMDB crawl.
"""
from __future__ import annotations

import logging
import time
from collections import defaultdict

import httpx

from .. import db
from ..config import get_settings
from ..textnorm import norm_title

log = logging.getLogger(__name__)

ENDPOINT = "https://query.wikidata.org/sparql"

ENRICH_PROPS = {
    "award": "P166", "nominated": "P1411", "based_on": "P144", "influenced_by": "P737",
    "series": "P179", "follows": "P155", "followed_by": "P156", "narrative_location": "P840",
    "main_subject": "P921",
}
CORE_PROPS = {
    "director": "P57", "writer": "P58", "cast": "P161", "composer": "P86", "dop": "P344",
    "creator": "P170", "genre": "P136", "country": "P495", "language": "P364",
    "duration": "P2047", "pubdate": "P577", "start": "P580", "seasons": "P2437",
}
PERSON_ROLES = {"director", "writer", "cast", "composer", "dop", "creator"}

GENRE_RULES = [
    ("science fiction", "Science Fiction"), ("sci-fi", "Science Fiction"), ("thriller", "Thriller"),
    ("crime", "Crime"), ("heist", "Crime"), ("comedy", "Comedy"), ("sitcom", "Comedy"), ("satir", "Comedy"),
    ("parody", "Comedy"), ("drama", "Drama"), ("horror", "Horror"), ("action", "Action"), ("war", "War"),
    ("anim", "Animation"), ("anime", "Animation"), ("documentary", "Documentary"), ("fantasy", "Fantasy"),
    ("mystery", "Mystery"), ("detective", "Mystery"), ("romanc", "Romance"), ("romantic", "Romance"),
    ("musical", "Music"), ("western", "Western"), ("adventure", "Adventure"), ("histor", "History"),
    ("family", "Family"), ("children", "Family"), ("spy", "Thriller"), ("superhero", "Action"),
]


class Sparql:
    def __init__(self, min_interval: float = 1.0):
        # Wikimedia's User-Agent policy rejects UAs without a contact URL or e-mail (HTTP 403)
        s = get_settings()
        contact = s.wikidata_contact or f"https://letterboxd.com/{s.letterboxd_username}/"
        self.client = httpx.Client(headers={"User-Agent": f"CineGraph/0.1 ({contact}; personal recommender)", "Accept": "application/sparql-results+json"},
                                   timeout=90)
        self.min_interval = min_interval
        self._last = 0.0

    def query(self, q: str, retries: int = 4) -> list[dict]:
        delay = 2.0
        for attempt in range(retries + 1):
            wait = self.min_interval - (time.monotonic() - self._last)
            if wait > 0:
                time.sleep(wait)
            self._last = time.monotonic()
            try:
                r = self.client.post(ENDPOINT, data={"query": q, "format": "json"})
            except httpx.HTTPError as e:
                if attempt == retries:
                    raise
                log.warning("sparql error %s, retry in %.0fs", e, delay)
                time.sleep(delay)
                delay *= 2
                continue
            if r.status_code in (429, 500, 502, 503, 504):
                if attempt == retries:
                    r.raise_for_status()
                time.sleep(float(r.headers.get("Retry-After", delay)))
                delay *= 2
                continue
            r.raise_for_status()
            try:
                return r.json()["results"]["bindings"]
            except ValueError:
                # the endpoint sometimes cuts a response short when a query nears its timeout
                if attempt == retries:
                    raise
                log.warning("truncated SPARQL response, retry in %.0fs", delay)
                time.sleep(delay)
                delay *= 2
        return []


def _val(b: dict, k: str) -> str | None:
    return b[k]["value"] if k in b else None


def _qid(uri: str | None) -> str | None:
    return uri.rsplit("/", 1)[-1] if uri and "/entity/" in uri else None


def map_genres(labels: list[str]) -> tuple[list[str], list[str]]:
    genres, kws = [], []
    for lab in labels:
        low = lab.lower()
        for needle, g in GENRE_RULES:
            if needle in low and g not in genres:
                genres.append(g)
        if "musical" in low:
            kws.append("musical")
        if "sitcom" in low:
            kws.append("sitcom")
        if "black comedy" in low or "dark comedy" in low:
            kws.append("dark comedy")
        kws.append(low.replace(" film", "").replace(" television series", "").strip())
    return genres, kws


# ----------------------------------------------------------------- resolve
def resolve_qids(batch: int = 300, sp: Sparql | None = None) -> int:
    sp = sp or Sparql()
    resolved = 0
    for kind, prop in (("movie", "P4947"), ("tv", "P4983")):
        rows = db.fetchall(
            "SELECT id, tmdb_id FROM titles WHERE kind = %s AND wikidata_id IS NULL "
            "AND (extra->>'wd_resolve_tried') IS NULL ORDER BY popularity DESC NULLS LAST", (kind,))
        for i in range(0, len(rows), batch):
            chunk = rows[i:i + batch]
            values = " ".join(f'"{r["tmdb_id"]}"' for r in chunk)
            res = sp.query(f"SELECT ?item ?t WHERE {{ VALUES ?t {{ {values} }} ?item wdt:{prop} ?t . }}")
            by_tmdb = {int(_val(b, "t")): _qid(_val(b, "item")) for b in res}
            with db.connect() as conn:
                for r in chunk:
                    q = by_tmdb.get(r["tmdb_id"])
                    if q:
                        conn.execute("UPDATE titles SET wikidata_id = %s WHERE id = %s", (q, r["id"]))
                        resolved += 1
                    else:
                        conn.execute("UPDATE titles SET extra = extra || '{\"wd_resolve_tried\": true}' "
                                     "WHERE id = %s", (r["id"],))
                conn.commit()
            log.info("wikidata resolve %s: %d/%d", kind, min(i + batch, len(rows)), len(rows))
    return resolved


# ----------------------------------------------------------------- facts
def _facts_query(qids: list[str], core: bool) -> str:
    props = dict(ENRICH_PROPS)
    if core:
        props.update(CORE_PROPS)
    pairs = " ".join(f'("{k}" wdt:{v})' for k, v in props.items())
    desc = ' ("description" schema:description)' if core else ""
    values = " ".join(f"wd:{q}" for q in qids)
    return f"""
    SELECT ?item ?prop ?o ?oLabel WHERE {{
      VALUES ?item {{ {values} }}
      VALUES (?prop ?p) {{ {pairs}{desc} }}
      ?item ?p ?o .
      FILTER(!isLiteral(?o) || lang(?o) = "" || lang(?o) = "en")
      SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en,fr,mul". }}
    }}"""


def parse_facts(bindings: list[dict]) -> dict[str, dict[str, list[tuple[str, str]]]]:
    """-> {qid: {prop: [(object_qid_or_literal, label)]}}"""
    out: dict[str, dict[str, list[tuple[str, str]]]] = defaultdict(lambda: defaultdict(list))
    for b in bindings:
        item = _qid(_val(b, "item"))
        prop = _val(b, "prop")
        o = _val(b, "o")
        lab = _val(b, "oLabel") or o
        oq = _qid(o) or o
        if item and prop and oq and (oq, lab) not in out[item][prop]:
            out[item][prop].append((oq, lab))
    return out


def _apply_core(conn, title_id: int, facts: dict[str, list[tuple[str, str]]]) -> None:
    genre_labels = [lab for _, lab in facts.get("genre", [])]
    genres, kws = map_genres(genre_labels)
    subjects = [lab.lower() for _, lab in facts.get("main_subject", [])]
    year = None
    for p in ("pubdate", "start"):
        for v, _ in facts.get(p, []):
            if v[:4].isdigit():
                y = int(v[:4])
                year = y if year is None else min(year, y)
    runtime = None
    for v, _ in facts.get("duration", []):
        try:
            runtime = int(float(v))
        except ValueError:
            pass
    seasons = None
    for v, _ in facts.get("seasons", []):
        try:
            seasons = max(seasons or 0, int(float(v)))
        except ValueError:
            pass
    desc = next((lab for _, lab in facts.get("description", [])), None)
    countries = [lab for _, lab in facts.get("country", [])]
    conn.execute(
        """
        UPDATE titles SET genres = CASE WHEN cardinality(genres) = 0 THEN %(g)s ELSE genres END,
            keywords = COALESCE((SELECT array_agg(DISTINCT k) FROM unnest(keywords || %(k)s::text[]) k), keywords),
            year = COALESCE(year, %(y)s), runtime = COALESCE(runtime, %(r)s),
            number_of_seasons = COALESCE(number_of_seasons, %(s)s),
            overview = COALESCE(overview, %(d)s),
            countries = CASE WHEN cardinality(countries) = 0 THEN %(c)s ELSE countries END
        WHERE id = %(id)s
        """,
        {"g": genres, "k": kws + subjects, "y": year, "r": runtime, "s": seasons, "d": desc,
         "c": countries, "id": title_id},
    )
    has_credits = conn.execute("SELECT 1 FROM credits WHERE title_id = %s LIMIT 1", (title_id,)).fetchone()
    if has_credits:
        return
    for role in PERSON_ROLES:
        for ordn, (pq, name) in enumerate(facts.get(role, [])[:15]):
            if not pq.startswith("Q") or name == pq:
                continue
            pr = conn.execute(
                "INSERT INTO people (wikidata_id, name) VALUES (%s, %s) "
                "ON CONFLICT (wikidata_id) DO UPDATE SET name = EXCLUDED.name RETURNING id", (pq, name)).fetchone()
            conn.execute("INSERT INTO credits (title_id, person_id, role, ord) VALUES (%s,%s,%s,%s) "
                         "ON CONFLICT DO NOTHING", (title_id, pr["id"], role, ordn))


def fetch_facts(batch: int = 60, limit: int | None = None, sp: Sparql | None = None) -> int:
    sp = sp or Sparql()
    rows = db.fetchall(
        "SELECT id, wikidata_id, source FROM titles WHERE wikidata_id IS NOT NULL AND wikidata_fetched_at IS NULL "
        "ORDER BY popularity DESC NULLS LAST" + (f" LIMIT {int(limit)}" if limit else ""))
    n = 0
    for i in range(0, len(rows), batch):
        chunk = rows[i:i + batch]
        core = any(r["source"] != "tmdb" for r in chunk)
        try:
            facts = parse_facts(sp.query(_facts_query([r["wikidata_id"] for r in chunk], core), retries=2))
        except (httpx.HTTPError, ValueError):
            # big result sets (long cast lists) can time out: retry in small slices
            facts = {}
            for k in range(0, len(chunk), 10):
                part = chunk[k:k + 10]
                try:
                    facts.update(parse_facts(sp.query(_facts_query([r["wikidata_id"] for r in part], core))))
                except (httpx.HTTPError, ValueError) as e:
                    log.warning("facts slice failed (%s); will retry next run", e)
                    chunk = [r for r in chunk if r not in part]
        with db.connect() as conn:
            for r in chunk:
                f = facts.get(r["wikidata_id"], {})
                conn.execute("DELETE FROM wikidata_facts WHERE title_id = %s", (r["id"],))
                for prop in ENRICH_PROPS:
                    for oq, lab in f.get(prop, []):
                        conn.execute(
                            "INSERT INTO wikidata_facts VALUES (%s,%s,%s,%s) ON CONFLICT DO NOTHING",
                            (r["id"], prop, oq, lab))
                if r["source"] != "tmdb":
                    _apply_core(conn, r["id"], f)
                conn.execute("UPDATE titles SET wikidata_fetched_at = now() WHERE id = %s", (r["id"],))
                n += 1
            conn.commit()
        log.info("wikidata facts: %d/%d", min(i + batch, len(rows)), len(rows))
    return n


# ----------------------------------------------------------------- TV bootstrap
# television series, miniseries, animated series, anime series, web series, docuseries, sitcom, drama series...
SERIES_TYPES = ("wd:Q5398426 wd:Q1259759 wd:Q117467246 wd:Q581714 wd:Q63952888 wd:Q526877 wd:Q15416 "
                "wd:Q1366112 wd:Q21191270 wd:Q24862 wd:Q7725310 wd:Q20650540 wd:Q113671041 wd:Q186124")


def prune_non_series(sp: Sparql | None = None) -> int:
    """Drop Wikidata-bootstrapped 'series' that are award shows, talk shows, etc.
    Titles you rated, swiped or listed are kept."""
    sp = sp or Sparql()
    rows = db.fetchall("SELECT id, wikidata_id FROM titles WHERE kind = 'tv' AND source = 'wikidata' "
                       "AND wikidata_id IS NOT NULL")
    keep: set[str] = set()
    for i in range(0, len(rows), 300):
        values = " ".join(f"wd:{r['wikidata_id']}" for r in rows[i:i + 300])
        res = sp.query(f"SELECT DISTINCT ?item WHERE {{ VALUES ?item {{ {values} }} "
                       f"?item wdt:P31 ?type . VALUES ?type {{ {SERIES_TYPES} }} }}")
        keep |= {_qid(_val(b, "item")) for b in res}
    drop = [r["id"] for r in rows if r["wikidata_id"] not in keep]
    if drop:
        db.execute(
            """DELETE FROM titles t WHERE t.id = ANY(%s)
               AND NOT EXISTS (SELECT 1 FROM user_ratings WHERE title_id = t.id)
               AND NOT EXISTS (SELECT 1 FROM swipes WHERE title_id = t.id)
               AND NOT EXISTS (SELECT 1 FROM watchlist WHERE title_id = t.id)""", (drop,))
    log.info("pruned %d non-series TV stubs", len(drop))
    return len(drop)
def bootstrap_tv(n: int = 1500, min_sitelinks: int = 15, sp: Sparql | None = None) -> int:
    """Seed well-known TV series from Wikidata (keyed by their TMDB TV id, so a later
    TMDB crawl fills the same rows)."""
    sp = sp or Sparql()
    q = f"""
    SELECT ?item ?tmdb ?itemLabel ?orig ?links WHERE {{
      ?item wdt:P4983 ?tmdb ; wikibase:sitelinks ?links .
      FILTER(?links >= {int(min_sitelinks)})
      # TMDB's TV ids also cover award shows and talk shows: keep series only
      ?item wdt:P31 ?type . VALUES ?type {{ {SERIES_TYPES} }}
      OPTIONAL {{ ?item wdt:P1476 ?orig }}
      SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en,fr,mul". }}
    }} ORDER BY DESC(?links) LIMIT {int(n)}"""
    res = sp.query(q)
    added = 0
    with db.connect() as conn:
        for b in res:
            try:
                tmdb = int(_val(b, "tmdb"))
            except (TypeError, ValueError):
                continue
            label = _val(b, "itemLabel") or ""
            if not label or label.startswith("Q"):
                continue
            links = int(_val(b, "links") or 0)
            cur = conn.execute(
                """INSERT INTO titles (kind, tmdb_id, wikidata_id, title, original_title, norm_title, popularity, source)
                   VALUES ('tv', %s, %s, %s, %s, %s, %s, 'wikidata')
                   ON CONFLICT (kind, tmdb_id) DO UPDATE SET wikidata_id = COALESCE(titles.wikidata_id, EXCLUDED.wikidata_id)
                   RETURNING id, (xmax = 0) AS inserted""",
                (tmdb, _qid(_val(b, "item")), label, _val(b, "orig"), norm_title(label), float(links) / 4),
            ).fetchone()
            added += int(cur["inserted"])
            orig = _val(b, "orig")
            if orig and norm_title(orig) != norm_title(label):
                conn.execute("INSERT INTO title_aliases VALUES (%s,%s) ON CONFLICT DO NOTHING",
                             (cur["id"], norm_title(orig)))
        conn.commit()
    log.info("wikidata tv bootstrap: %d results, %d new", len(res), added)
    return added


# ----------------------------------------------------------------- title lookup (keyless fallback)
def lookup_title(name: str, year: int | None, kind: str | None, sp: Sparql | None = None) -> int | None:
    """Find a film/series on Wikidata by name (+year) and add it as a stub keyed by its TMDB id.
    Used by the matcher when a title isn't local and no TMDB key is configured."""
    from ..userdata.matcher import Candidate, best_match

    sp = sp or Sparql()
    try:
        r = sp.client.get("https://www.wikidata.org/w/api.php", params={
            "action": "wbsearchentities", "search": name, "language": "en", "uselang": "en", "type": "item",
            "limit": 40, "format": "json"})
        r.raise_for_status()
        hits = r.json().get("search", [])
        qids = [h["id"] for h in hits]
        # the alias the search matched on ("LOL : Qui rit sort" -> the French LOL series)
        matched_alias = {h["id"]: norm_title((h.get("match") or {}).get("text")) for h in hits}
        if not qids:
            return None
        values = " ".join(f"wd:{q}" for q in qids)
        res = sp.query(f"""
        SELECT ?item ?itemLabel ?orig ?mv ?tv (MIN(?d) AS ?date) WHERE {{
          VALUES ?item {{ {values} }}
          OPTIONAL {{ ?item wdt:P4947 ?mv }} OPTIONAL {{ ?item wdt:P4983 ?tv }}
          FILTER(BOUND(?mv) || BOUND(?tv))
          OPTIONAL {{ ?item wdt:P1476 ?orig }}
          OPTIONAL {{ ?item wdt:P577|wdt:P580 ?d }}
          SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en,fr,mul". }}
        }} GROUP BY ?item ?itemLabel ?orig ?mv ?tv""")
    except (httpx.HTTPError, ValueError) as e:
        log.warning("wikidata lookup failed for %r: %s", name, e)
        return None
    cands, info = [], {}
    for b in res:
        q = _qid(_val(b, "item"))
        for k, var in (("movie", "mv"), ("tv", "tv")):
            v = _val(b, var)
            if not v or not v.isdigit():
                continue
            d = _val(b, "date")
            y = int(d[:4]) if d and d[:4].isdigit() else None
            label = _val(b, "itemLabel") or ""
            c = Candidate(id=len(cands), kind=k, title=label, original_title=_val(b, "orig"), year=y,
                          aliases=tuple(a for a in [matched_alias.get(q, "")] if a))
            cands.append(c)
            info[c.id] = (q, int(v), k, label, _val(b, "orig"), y)
    m = best_match(name, year, cands, kind_hint=kind)
    if not m:
        return None
    q, tmdb, k, label, orig, y = info[m.candidate.id]
    with db.connect() as conn:
        row = conn.execute(
            """INSERT INTO titles (kind, tmdb_id, wikidata_id, title, original_title, norm_title, year, source)
               VALUES (%s, %s, %s, %s, %s, %s, %s, 'wikidata')
               ON CONFLICT (kind, tmdb_id) DO UPDATE SET wikidata_id = COALESCE(titles.wikidata_id, EXCLUDED.wikidata_id)
               RETURNING id""", (k, tmdb, q, label, orig, norm_title(label), y)).fetchone()
        if orig and norm_title(orig) != norm_title(label):
            conn.execute("INSERT INTO title_aliases VALUES (%s,%s) ON CONFLICT DO NOTHING", (row["id"], norm_title(orig)))
        if m.score >= 0.95:
            conn.execute("INSERT INTO title_aliases VALUES (%s,%s) ON CONFLICT DO NOTHING", (row["id"], norm_title(name)))
        conn.commit()
    # pull its facts (director, cast, genres, awards...) right away
    rows = db.fetchall("SELECT id, wikidata_id, source FROM titles WHERE id = %s", (row["id"],))
    facts = parse_facts(sp.query(_facts_query([q], core=True)))
    with db.connect() as conn:
        for prop in ENRICH_PROPS:
            for oq, lab in facts.get(q, {}).get(prop, []):
                conn.execute("INSERT INTO wikidata_facts VALUES (%s,%s,%s,%s) ON CONFLICT DO NOTHING",
                             (row["id"], prop, oq, lab))
        if rows and rows[0]["source"] != "tmdb":
            _apply_core(conn, row["id"], facts.get(q, {}))
        conn.execute("UPDATE titles SET wikidata_fetched_at = now() WHERE id = %s", (row["id"],))
        conn.commit()
    return row["id"]
