"""TMDB ingestion.

1. Download the daily ID export files (movies + TV series) -> `tmdb_export`.
2. Pick targets: top N by popularity (or everything with --full) plus every title
   already referenced by user data. Targets become stub rows in `titles`.
3. Crawl: fetch details+credits+keywords+external ids+images+FR providers for every
   title whose `details_fetched_at` is NULL. State lives in the DB, so the job is
   resumable: kill it and re-run, it continues where it stopped.
"""
from __future__ import annotations

import asyncio
import datetime as dt
import gzip
import io
import json
import logging
from typing import Any, Iterable

import httpx

from .. import db
from ..config import get_settings
from ..textnorm import norm_title
from .tmdb_client import TMDBClient

log = logging.getLogger(__name__)

EXPORT_URL = "http://files.tmdb.org/p/exports/{name}_ids_{date}.json.gz"
EXPORT_NAMES = {"movie": "movie", "tv": "tv_series"}


# ----------------------------------------------------------------- exports
def download_export(kind: str, date: dt.date | None = None) -> tuple[dt.date, bytes]:
    """Exports appear around 08:00 UTC; fall back up to 3 days."""
    base = date or dt.datetime.now(dt.UTC).date()
    last_err: Exception | None = None
    for back in range(4):
        d = base - dt.timedelta(days=back)
        url = EXPORT_URL.format(name=EXPORT_NAMES[kind], date=d.strftime("%m_%d_%Y"))
        try:
            r = httpx.get(url, timeout=120, follow_redirects=True)
            if r.status_code == 200:
                return d, r.content
            last_err = RuntimeError(f"HTTP {r.status_code} for {url}")
        except httpx.HTTPError as e:
            last_err = e
    raise RuntimeError(f"could not download TMDB {kind} export: {last_err}")


def parse_export(raw_gz: bytes) -> Iterable[dict]:
    with gzip.open(io.BytesIO(raw_gz), "rt", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if line:
                yield json.loads(line)


def stage_exports(kinds: Iterable[str] = ("movie", "tv")) -> dict[str, int]:
    counts = {}
    for kind in kinds:
        date, raw = download_export(kind)
        rows = 0
        with db.connect() as conn:
            conn.execute("DELETE FROM tmdb_export WHERE kind = %s", (kind,))
            with conn.cursor().copy(
                "COPY tmdb_export (kind, tmdb_id, name, popularity, adult, export_date) FROM STDIN"
            ) as cp:
                for rec in parse_export(raw):
                    name = rec.get("original_title") or rec.get("original_name") or ""
                    cp.write_row((kind, rec["id"], name, rec.get("popularity") or 0,
                                  bool(rec.get("adult")), date))
                    rows += 1
            conn.commit()
        counts[kind] = rows
        log.info("staged %d %s ids from export %s", rows, kind, date)
    return counts


def select_targets(top_movies: int, top_tv: int, full: bool = False) -> int:
    """Insert stub titles for the crawl. Existing rows are untouched (resumable)."""
    with db.connect() as conn:
        n = 0
        for kind, top in (("movie", top_movies), ("tv", top_tv)):
            limit = "" if full else f"LIMIT {int(top)}"
            cur = conn.execute(
                f"""
                INSERT INTO titles (kind, tmdb_id, title, norm_title, popularity, source)
                SELECT kind, tmdb_id, name, '', popularity, 'tmdb'
                FROM (SELECT * FROM tmdb_export WHERE kind = %s AND NOT adult
                      ORDER BY popularity DESC {limit}) t
                ON CONFLICT (kind, tmdb_id) DO NOTHING
                """,
                (kind,),
            )
            n += cur.rowcount
        conn.commit()
    return n


# ----------------------------------------------------------------- parsing
WRITER_JOBS = {"Screenplay", "Writer", "Story", "Novel", "Author", "Teleplay"}
CREW_ROLES = {"Director": "director", "Original Music Composer": "composer",
              "Director of Photography": "dop", "Producer": "producer"}
OFFER_TYPES = ("flatrate", "free", "ads", "rent", "buy")


def _year(date_str: str | None) -> int | None:
    if date_str and len(date_str) >= 4 and date_str[:4].isdigit():
        return int(date_str[:4])
    return None


def parse_details(kind: str, d: dict, region: str = "FR") -> dict[str, Any]:
    """Pure transformation of a TMDB details payload -> our row shapes."""
    is_movie = kind == "movie"
    title = d.get("title") if is_movie else d.get("name")
    original = d.get("original_title") if is_movie else d.get("original_name")
    date = d.get("release_date") if is_movie else d.get("first_air_date")
    if is_movie:
        runtime = d.get("runtime") or None
    else:
        ert = d.get("episode_run_time") or []
        runtime = int(sum(ert) / len(ert)) if ert else None
        if runtime is None and (d.get("last_episode_to_air") or {}).get("runtime"):
            runtime = d["last_episode_to_air"]["runtime"]

    kw_block = d.get("keywords") or {}
    keywords = [k["name"] for k in kw_block.get("keywords", kw_block.get("results", []))]
    ext = d.get("external_ids") or {}

    people: list[dict] = []
    if is_movie:
        cr = d.get("credits") or {}
        for c in cr.get("cast", [])[:15]:
            people.append({"tmdb_person_id": c["id"], "name": c["name"], "profile_path": c.get("profile_path"),
                           "role": "cast", "character": c.get("character"), "ord": c.get("order", 99)})
        for c in cr.get("crew", []):
            job = c.get("job")
            role = "writer" if job in WRITER_JOBS else CREW_ROLES.get(job)
            if role:
                people.append({"tmdb_person_id": c["id"], "name": c["name"], "profile_path": c.get("profile_path"),
                               "role": role, "character": None, "ord": 0})
    else:
        for c in d.get("created_by", []):
            people.append({"tmdb_person_id": c["id"], "name": c["name"], "profile_path": c.get("profile_path"),
                           "role": "creator", "character": None, "ord": 0})
        ac = d.get("aggregate_credits") or {}
        for c in ac.get("cast", [])[:15]:
            roles = c.get("roles") or [{}]
            people.append({"tmdb_person_id": c["id"], "name": c["name"], "profile_path": c.get("profile_path"),
                           "role": "cast", "character": roles[0].get("character"), "ord": c.get("order", 99)})
        for c in ac.get("crew", []):
            for j in c.get("jobs", []):
                job = j.get("job")
                role = "writer" if job in WRITER_JOBS else CREW_ROLES.get(job)
                # TV "Director" appears per-episode; keep only frequent ones
                if role and (role != "director" or j.get("episode_count", 0) >= 3):
                    people.append({"tmdb_person_id": c["id"], "name": c["name"],
                                   "profile_path": c.get("profile_path"), "role": role,
                                   "character": None, "ord": 0})
    # de-duplicate (person, role)
    seen: set[tuple[int, str]] = set()
    uniq = []
    for p in people:
        k = (p["tmdb_person_id"], p["role"])
        if k not in seen:
            seen.add(k)
            uniq.append(p)

    providers = []
    reg = ((d.get("watch/providers") or {}).get("results") or {}).get(region) or {}
    for offer in OFFER_TYPES:
        for p in reg.get(offer, []):
            providers.append({"provider_id": p["provider_id"], "provider_name": p["provider_name"],
                              "offer_type": offer, "logo_path": p.get("logo_path")})

    alt = d.get("alternative_titles") or {}
    aliases = {a.get("title") for a in alt.get("titles", alt.get("results", [])) if a.get("title")}
    aliases |= {title or "", original or ""}
    aliases = {norm_title(a) for a in aliases} - {""}

    countries = [c["iso_3166_1"] for c in d.get("production_countries", [])] or d.get("origin_country", [])

    images = d.get("images") or {}
    return {
        "title": {
            "imdb_id": ext.get("imdb_id") or d.get("imdb_id"),
            "wikidata_id": ext.get("wikidata_id"),
            "title": title or original or "?",
            "original_title": original,
            "norm_title": norm_title(title or original),
            "original_language": d.get("original_language"),
            "year": _year(date),
            "release_date": date or None,
            "overview": d.get("overview") or None,
            "tagline": d.get("tagline") or None,
            "runtime": runtime,
            "number_of_seasons": d.get("number_of_seasons"),
            "status": d.get("status"),
            "popularity": d.get("popularity"),
            "vote_average": d.get("vote_average"),
            "vote_count": d.get("vote_count"),
            "poster_path": d.get("poster_path"),
            "backdrop_path": d.get("backdrop_path"),
            "genres": [g["name"] for g in d.get("genres", [])],
            "keywords": keywords,
            "countries": countries,
            "networks": [n["name"] for n in d.get("networks", [])],
            "extra": {
                "backdrops": [i["file_path"] for i in images.get("backdrops", [])[:5]],
                "logos": [i["file_path"] for i in images.get("logos", [])[:2]],
                "in_production": d.get("in_production"),
                "type": d.get("type"),
                "collection": ({"id": d["belongs_to_collection"]["id"], "name": d["belongs_to_collection"]["name"]}
                               if d.get("belongs_to_collection") else None),
                "watch_link": reg.get("link"),
                "status_tv": d.get("status") if not is_movie else None,
                "episodes": d.get("number_of_episodes"),
                "seasons": [{"n": se.get("season_number"), "episodes": se.get("episode_count"), "name": se.get("name")}
                            for se in d.get("seasons", []) if se.get("season_number")] if not is_movie else None,
            },
        },
        "people": uniq,
        "providers": providers,
        "aliases": sorted(aliases),
    }


# ----------------------------------------------------------------- writing
def upsert_details(conn, title_id: int, parsed: dict, region: str) -> None:
    t = parsed["title"]
    conn.execute(
        """
        UPDATE titles SET imdb_id = COALESCE(%(imdb_id)s, imdb_id),
            wikidata_id = COALESCE(%(wikidata_id)s, wikidata_id),
            title = %(title)s, original_title = %(original_title)s, norm_title = %(norm_title)s,
            original_language = %(original_language)s, year = %(year)s, release_date = %(release_date)s,
            overview = %(overview)s, tagline = %(tagline)s, runtime = %(runtime)s,
            number_of_seasons = %(number_of_seasons)s, status = %(status)s, popularity = %(popularity)s,
            vote_average = %(vote_average)s, vote_count = %(vote_count)s, poster_path = %(poster_path)s,
            backdrop_path = %(backdrop_path)s, genres = %(genres)s, keywords = %(keywords)s,
            countries = %(countries)s, networks = %(networks)s, extra = extra || %(extra)s::jsonb,
            source = 'tmdb', details_fetched_at = now(), tmdb_error = NULL
        WHERE id = %(id)s
        """,
        {**t, "extra": json.dumps(t["extra"]), "id": title_id},
    )
    conn.execute("DELETE FROM credits WHERE title_id = %s", (title_id,))
    for p in parsed["people"]:
        row = conn.execute(
            """
            INSERT INTO people (tmdb_person_id, name, profile_path) VALUES (%s, %s, %s)
            ON CONFLICT (tmdb_person_id) DO UPDATE SET name = EXCLUDED.name,
                profile_path = COALESCE(EXCLUDED.profile_path, people.profile_path)
            RETURNING id
            """,
            (p["tmdb_person_id"], p["name"], p["profile_path"]),
        ).fetchone()
        conn.execute(
            "INSERT INTO credits (title_id, person_id, role, character, ord) VALUES (%s,%s,%s,%s,%s) "
            "ON CONFLICT DO NOTHING",
            (title_id, row["id"], p["role"], p["character"], p["ord"]),
        )
    conn.execute("DELETE FROM providers WHERE title_id = %s AND region = %s", (title_id, region))
    for p in parsed["providers"]:
        conn.execute(
            "INSERT INTO providers (title_id, region, provider_id, provider_name, offer_type, logo_path) "
            "VALUES (%s,%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING",
            (title_id, region, p["provider_id"], p["provider_name"], p["offer_type"], p["logo_path"]),
        )
    for a in parsed["aliases"]:
        conn.execute("INSERT INTO title_aliases (title_id, norm_alias) VALUES (%s, %s) ON CONFLICT DO NOTHING",
                     (title_id, a))


# ----------------------------------------------------------------- crawl
async def _crawl_async(limit: int | None, batch: int, client: TMDBClient | None = None) -> dict:
    s = get_settings()
    own = client is None
    client = client or TMDBClient(s.tmdb_api_key, rate=s.tmdb_rate_limit)
    done = failed = 0
    try:
        while limit is None or done + failed < limit:
            take = batch if limit is None else min(batch, limit - done - failed)
            rows = db.fetchall(
                """
                SELECT id, kind, tmdb_id FROM titles
                WHERE details_fetched_at IS NULL AND tmdb_attempts < 3
                ORDER BY (source = 'tmdb') ASC, popularity DESC NULLS LAST, id
                LIMIT %s
                """,
                (take,),
            )
            if not rows:
                break

            async def one(r):
                try:
                    return r, await client.details(r["kind"], r["tmdb_id"], s.tmdb_language), None
                except Exception as e:  # noqa: BLE001 - recorded per title, crawl continues
                    return r, None, str(e)

            results = await asyncio.gather(*(one(r) for r in rows))
            with db.connect() as conn:
                for r, payload, err in results:
                    if payload is None:
                        failed += 1
                        conn.execute(
                            "UPDATE titles SET tmdb_attempts = tmdb_attempts + 1, tmdb_error = %s WHERE id = %s",
                            (err or "404 not found", r["id"]),
                        )
                        continue
                    upsert_details(conn, r["id"], parse_details(r["kind"], payload, s.tmdb_region), s.tmdb_region)
                    done += 1
                conn.commit()
            log.info("tmdb crawl: %d fetched, %d failed", done, failed)
    finally:
        if own:
            await client.close()
    return {"fetched": done, "failed": failed}


def crawl(limit: int | None = None, batch: int = 200, client: TMDBClient | None = None) -> dict:
    return asyncio.run(_crawl_async(limit, batch, client))


async def search_and_add(kind: str, name: str, year: int | None) -> int | None:
    """Used by matchers when a title isn't local yet (needs TMDB key)."""
    s = get_settings()
    async with TMDBClient(s.tmdb_api_key, rate=s.tmdb_rate_limit) as client:
        results = await client.search(kind, name, year)
        if not results and year:
            results = await client.search(kind, name, None)
        if not results:
            return None
        from ..userdata.matcher import Candidate, best_match

        cands = [
            Candidate(id=r["id"], kind=kind, title=r.get("title") or r.get("name") or "",
                      original_title=r.get("original_title") or r.get("original_name"),
                      year=_year(r.get("release_date") or r.get("first_air_date")),
                      popularity=r.get("popularity") or 0)
            for r in results[:10]
        ]
        m = best_match(name, year, cands)
        if not m:
            return None
        payload = await client.details(kind, m.candidate.id, s.tmdb_language)
        if not payload:
            return None
    with db.connect() as conn:
        row = conn.execute(
            "INSERT INTO titles (kind, tmdb_id, title, norm_title, source) VALUES (%s,%s,%s,%s,'tmdb') "
            "ON CONFLICT (kind, tmdb_id) DO UPDATE SET kind = EXCLUDED.kind RETURNING id",
            (kind, m.candidate.id, m.candidate.title, norm_title(m.candidate.title)),
        ).fetchone()
        upsert_details(conn, row["id"], parse_details(kind, payload, s.tmdb_region), s.tmdb_region)
        conn.commit()
    return row["id"]


def pick_trailer(videos: list[dict]) -> str | None:
    """Best YouTube video: official trailer > trailer > teaser, then the most recent."""
    yt = [v for v in videos if v.get("site") == "YouTube" and v.get("key")]
    rank = {"Trailer": 0, "Teaser": 1, "Clip": 2}
    yt = [v for v in yt if v.get("type") in rank]
    if not yt:
        return None
    best = min(yt, key=lambda v: (rank[v["type"]], not v.get("official")))
    return best["key"]


async def _trailers_async(limit: int | None, batch: int = 100) -> dict:
    """Trailer YouTube key per title (French first, then any language), stored in titles.extra.trailer.
    Titles already tried are skipped, so weekly runs only fetch new titles."""
    s = get_settings()
    found = tried = 0
    async with TMDBClient(s.tmdb_api_key, rate=s.tmdb_rate_limit) as client:
        while limit is None or tried < limit:
            rows = db.fetchall(
                """SELECT t.id, t.kind, t.tmdb_id FROM titles t JOIN title_embeddings e ON e.title_id = t.id
                   WHERE t.tmdb_id IS NOT NULL AND NOT (t.extra ? 'trailer_tried')
                   ORDER BY t.popularity DESC NULLS LAST LIMIT %s""", (batch,))
            if not rows:
                break

            async def one(r):
                path = f"/{'tv' if r['kind'] == 'tv' else 'movie'}/{r['tmdb_id']}/videos"
                try:
                    fr = await client.get(path, language="fr-FR") or {}
                    key = pick_trailer(fr.get("results", []))
                    if not key:
                        en = await client.get(path) or {}
                        key = pick_trailer(en.get("results", []))
                    return r, key
                except Exception:  # noqa: BLE001
                    return r, None

            results = await asyncio.gather(*(one(r) for r in rows))
            with db.connect() as conn:
                for r, key in results:
                    patch = {"trailer_tried": True, **({"trailer": key} if key else {})}
                    conn.execute("UPDATE titles SET extra = extra || %s::jsonb WHERE id = %s", (json.dumps(patch), r["id"]))
                    found += bool(key)
                conn.commit()
            tried += len(rows)
            log.info("trailers: %d tried, %d found", tried, found)
    return {"tried": tried, "found": found}


def trailers(limit: int | None = None) -> dict:
    return asyncio.run(_trailers_async(limit))


async def _french_async(limit: int | None, batch: int = 100) -> dict:
    """French title and synopsis of every catalogue title (TMDB fr-FR), stored in titles.extra.fr.
    Titles already tried are skipped, so weekly runs only fetch new titles."""
    s = get_settings()
    done = tried = 0
    async with TMDBClient(s.tmdb_api_key, rate=s.tmdb_rate_limit) as client:
        while limit is None or tried < limit:
            rows = db.fetchall(
                """SELECT t.id, t.kind, t.tmdb_id FROM titles t JOIN title_embeddings e ON e.title_id = t.id
                   WHERE t.tmdb_id IS NOT NULL AND NOT (t.extra ? 'fr_tried')
                   ORDER BY t.popularity DESC NULLS LAST LIMIT %s""", (batch,))
            if not rows:
                break

            async def one(r):
                try:
                    d = await client.get(f"/{'tv' if r['kind'] == 'tv' else 'movie'}/{r['tmdb_id']}", language="fr-FR") or {}
                    return r, {"t": d.get("title") or d.get("name"), "ov": d.get("overview")}
                except Exception:  # noqa: BLE001
                    return r, None

            results = await asyncio.gather(*(one(r) for r in rows))
            with db.connect() as conn:
                for r, fr in results:
                    patch = {"fr_tried": True, **({"fr": {k: v for k, v in fr.items() if v}} if fr else {})}
                    conn.execute("UPDATE titles SET extra = extra || %s::jsonb WHERE id = %s", (json.dumps(patch), r["id"]))
                    done += bool(fr and fr.get("t"))
                conn.commit()
            tried += len(rows)
            log.info("french: %d tried, %d found", tried, done)
    return {"tried": tried, "found": done}


def french(limit: int | None = None) -> dict:
    return asyncio.run(_french_async(limit))
