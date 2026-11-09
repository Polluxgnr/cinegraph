"""External links and images for every title, from open sources only.

- Wikidata identifiers: AlloCiné (film P1265 / series P1267), SensCritique (P10100), Letterboxd (P6127),
  IMDb (P345), plus the English/French Wikipedia article titles. They become direct links in the app
  (no scraping of those sites).
- Images: TMDB posters when the TMDB crawl has run; otherwise the article image of the title's
  Wikipedia page (MediaWiki `pageimages`, batched 50 titles per request).
"""
from __future__ import annotations

import json
import logging

import httpx

from .. import db
from .wikidata import Sparql, _qid, _val

log = logging.getLogger(__name__)

ID_PROPS = {"allocine_film": "P1265", "allocine_series": "P1267", "senscritique": "P10100",
            "letterboxd": "P6127", "imdb": "P345"}


def fetch_ids(batch: int = 200, sp: Sparql | None = None, only_missing: bool = True) -> int:
    sp = sp or Sparql()
    where = "AND NOT (extra ? 'links')" if only_missing else ""
    rows = db.fetchall(f"SELECT id, wikidata_id FROM titles WHERE wikidata_id IS NOT NULL {where}")
    done = 0
    for i in range(0, len(rows), batch):
        chunk = rows[i:i + batch]
        values = " ".join(f"wd:{r['wikidata_id']}" for r in chunk)
        opts = " ".join(f"OPTIONAL {{ ?item wdt:{p} ?{k} }}" for k, p in ID_PROPS.items())
        q = f"""
        SELECT ?item {' '.join('?' + k for k in ID_PROPS)} ?enwiki ?frwiki WHERE {{
          VALUES ?item {{ {values} }}
          {opts}
          OPTIONAL {{ ?en schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> ; schema:name ?enwiki }}
          OPTIONAL {{ ?fr schema:about ?item ; schema:isPartOf <https://fr.wikipedia.org/> ; schema:name ?frwiki }}
        }}"""
        try:
            res = sp.query(q)
        except (httpx.HTTPError, ValueError) as e:
            log.warning("id batch failed: %s", e)
            continue
        by_q: dict[str, dict] = {}
        for b in res:
            d = by_q.setdefault(_qid(_val(b, "item")), {})
            for k in list(ID_PROPS) + ["enwiki", "frwiki"]:
                v = _val(b, k)
                if v and k not in d:
                    d[k] = v
        with db.connect() as conn:
            for r in chunk:
                links = by_q.get(r["wikidata_id"], {})
                conn.execute("UPDATE titles SET extra = extra || jsonb_build_object('links', %s::jsonb), "
                             "imdb_id = COALESCE(imdb_id, %s) WHERE id = %s",
                             (json.dumps(links), links.get("imdb"), r["id"]))
                done += 1
            conn.commit()
        log.info("wikidata ids: %d/%d", min(i + batch, len(rows)), len(rows))
    return done


def fetch_wikipedia_images(batch: int = 50, size: int = 500) -> int:
    """Poster-like image for titles without a TMDB poster, from their Wikipedia article."""
    client = httpx.Client(headers={"User-Agent": Sparql().client.headers["User-Agent"]}, timeout=60)
    found = 0
    for wiki in ("enwiki", "frwiki"):
        host = "en" if wiki == "enwiki" else "fr"
        rows = db.fetchall(
            f"""SELECT id, extra->'links'->>'{wiki}' AS page FROM titles
                WHERE poster_path IS NULL AND NOT (extra ? 'image') AND extra->'links'->>'{wiki}' IS NOT NULL""")
        for i in range(0, len(rows), batch):
            chunk = rows[i:i + batch]
            try:
                r = client.get(f"https://{host}.wikipedia.org/w/api.php", params={
                    "action": "query", "prop": "pageimages", "piprop": "thumbnail", "pithumbsize": size, "pilicense": "any",
                    "titles": "|".join(c["page"] for c in chunk), "format": "json", "formatversion": 2,
                    "redirects": 1})
                r.raise_for_status()
                data = r.json()["query"]
            except (httpx.HTTPError, KeyError, ValueError) as e:
                log.warning("wikipedia images batch failed: %s", e)
                continue
            # follow normalisation / redirects back to the requested page names
            alias = {n["to"]: n["from"] for n in data.get("normalized", []) + data.get("redirects", [])}
            thumbs = {}
            for page in data.get("pages", []):
                src = (page.get("thumbnail") or {}).get("source")
                if src:
                    name = page["title"]
                    while name in alias:
                        name = alias[name]
                    thumbs[name] = src
            with db.connect() as conn:
                for c in chunk:
                    src = thumbs.get(c["page"])
                    if src:
                        conn.execute("UPDATE titles SET extra = extra || jsonb_build_object('image', %s::text) "
                                     "WHERE id = %s", (src, c["id"]))
                        found += 1
                conn.commit()
            log.info("wikipedia images (%s): %d/%d", host, min(i + batch, len(rows)), len(rows))
    return found
