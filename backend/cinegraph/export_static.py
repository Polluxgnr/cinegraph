"""Export everything the static web app needs into `<out>/` (default web/public/data):

  manifest.json                         build info, domains, counts
  films/catalog.json                    films + series, compact keys (see FILM_KEYS)
  films/people.json                     person index -> name
  films/collections.json                franchises / sagas (Harry Potter, Star Wars...) in viewing order
  films/emb.i8 + films/emb.scale.f32    content embeddings, int8 + one float32 scale per row
  films/cf.i8  + films/cf.scale.f32     ALS item factors (same encoding), rows aligned with cf_ids
  <domain>/items.json + emb.i8 + emb.scale.f32   every other taste domain

int8 quantisation keeps 384-d vectors at 384 bytes each (cosine error < 1%), so ~5k titles cost
~2 MB and load fast on a phone. Files are plain static assets: GitHub Pages serves them gzipped.
"""
from __future__ import annotations

import datetime as dt
import json
import logging
import re
from collections import defaultdict
from pathlib import Path

import numpy as np

from . import db
from .config import REPO_ROOT
from .recsys import cf, filters

log = logging.getLogger(__name__)
DEFAULT_OUT = REPO_ROOT / "web" / "public" / "data"
TMDB_IMG = "https://image.tmdb.org/t/p/"


# ------------------------------------------------------------------ encoding helpers
def quantize(m: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    m = np.asarray(m, dtype=np.float32)
    scale = np.maximum(np.abs(m).max(axis=1), 1e-9) / 127.0
    q = np.clip(np.round(m / scale[:, None]), -127, 127).astype(np.int8)
    return q, scale.astype(np.float32)


def write_matrix(path: Path, m: np.ndarray) -> None:
    q, s = quantize(m)
    path.with_suffix(".i8").write_bytes(q.tobytes())
    path.with_suffix(".scale.f32").write_bytes(s.tobytes())


def write_json(path: Path, obj) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    data = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
    path.write_text(data, encoding="utf-8")
    return len(data)


# ------------------------------------------------------------------ review-style reaction chips
def reaction_chips(t: dict) -> list[str]:
    """Extra swipe options tailored to the title (what people typically say about it).
    Heuristics from runtime / keywords; replaced by LLM summaries of real reviews when
    `cinegraph reviews` has run (titles.extra.review)."""
    review = (t.get("extra") or {}).get("review") or {}
    if review.get("chips"):
        return review["chips"][:4]
    kw = {k.lower() for k in t.get("keywords") or []}
    g = set(t.get("genres") or [])
    chips = []
    if t["kind"] == "movie" and (t.get("runtime") or 0) >= 150:
        chips.append("Too long")
    if t["kind"] == "tv" and (t.get("number_of_seasons") or 0) >= 5:
        chips.append("Dropped it midway")
    if kw & {"twist ending", "plot twist", "unreliable narrator"}:
        chips.append("Saw the twist coming")
    if kw & {"slow burn", "slow-burn", "contemplative", "arthouse"} or ("Drama" in g and (t.get("runtime") or 0) > 140):
        chips.append("Too slow")
    if kw & {"violence", "gore", "torture", "brutality", "splatter"} or "Horror" in g:
        chips.append("Too violent")
    if kw & {"nonlinear timeline", "time travel", "philosophy", "surreal", "mind-bending"}:
        chips.append("Lost me")
    if "Comedy" in g:
        chips.append("Not funny")
    if not chips:
        chips.append("Overrated")
    return chips[:3]


# ------------------------------------------------------------------ films + series
def _img(t: dict) -> str | None:
    if t.get("poster_path"):
        return TMDB_IMG + "w342" + t["poster_path"]
    return (t.get("extra") or {}).get("image")


def _links(t: dict) -> dict:
    ex = (t.get("extra") or {}).get("links") or {}
    out = {"tmdb": f"https://www.themoviedb.org/{'tv' if t['kind'] == 'tv' else 'movie'}/{t['tmdb_id']}"}
    if t.get("imdb_id"):
        out["imdb"] = f"https://www.imdb.com/title/{t['imdb_id']}/"
    if t.get("wikidata_id"):
        out["wikidata"] = f"https://www.wikidata.org/wiki/{t['wikidata_id']}"
    if ex.get("allocine_film") and t["kind"] == "movie":
        out["allocine"] = f"https://www.allocine.fr/film/fichefilm_gen_cfilm={ex['allocine_film']}.html"
    if ex.get("allocine_series") and t["kind"] == "tv":
        out["allocine"] = f"https://www.allocine.fr/series/ficheserie_gen_cserie={ex['allocine_series']}.html"
    if ex.get("senscritique"):
        out["senscritique"] = f"https://www.senscritique.com/{'serie' if t['kind'] == 'tv' else 'film'}/-/{ex['senscritique']}"
    if ex.get("letterboxd"):
        out["letterboxd"] = f"https://letterboxd.com/film/{ex['letterboxd']}/"
    elif t["kind"] == "movie":
        out["letterboxd"] = f"https://letterboxd.com/tmdb/{t['tmdb_id']}/"
    if ex.get("frwiki"):
        out["wikipedia"] = f"https://fr.wikipedia.org/wiki/{ex['frwiki'].replace(' ', '_')}"
    elif ex.get("enwiki"):
        out["wikipedia"] = f"https://en.wikipedia.org/wiki/{ex['enwiki'].replace(' ', '_')}"
    if (t.get("extra") or {}).get("watch_link"):
        out["justwatch"] = t["extra"]["watch_link"]
    return out


FILM_KEYS = {
    "id": "internal id", "k": "kind movie|tv", "t": "title", "ot": "original title", "y": "year",
    "d": "release / first air date", "rt": "runtime (min, per episode for series)", "ns": "seasons",
    "ne": "episodes", "lang": "original language (VO)", "ov": "overview", "g": "genres", "kw": "keywords",
    "c": "countries", "pop": "popularity", "va": "vote average /10", "vc": "vote count", "img": "poster url",
    "bd": "backdrop url", "cast": "person idx (billing order)", "dir": "directors", "wri": "writers",
    "cre": "creators", "mus": "composers", "coll": "collection key", "aw": "awards", "nom": "nominations",
    "src": "based on", "inf": "influenced by", "loc": "narrative locations", "sub": "main subjects",
    "prov": "FR streaming (subscription / free)", "rent": "FR rent / buy", "links": "outbound links",
    "chips": "reaction chips", "blk": "hard-filter reason (romance / musical / sitcom)",
}


NOT_A_SAGA = re.compile(r"(list of|greatest|best |feature film|animated feature|films$|movies$|top \d+|\d+ (films|movies)|"
                        r"criterion|registry|canon|filmography|anthology film|productions$)", re.I)


def export_films(out: Path) -> dict:
    rows = db.fetchall("""
        SELECT t.*, e.embedding FROM titles t JOIN title_embeddings e ON e.title_id = t.id
        ORDER BY t.id""")
    credits = defaultdict(lambda: defaultdict(list))
    people: dict[int, int] = {}
    names: list[str] = []
    for r in db.fetchall("""SELECT c.title_id, c.role, c.person_id, p.name FROM credits c
                             JOIN people p ON p.id = c.person_id ORDER BY c.title_id, c.role, c.ord"""):
        if r["person_id"] not in people:
            people[r["person_id"]] = len(names)
            names.append(r["name"])
        credits[r["title_id"]][r["role"]].append(people[r["person_id"]])
    facts = defaultdict(lambda: defaultdict(list))
    for r in db.fetchall("SELECT title_id, prop, object_qid, object_label FROM wikidata_facts"):
        facts[r["title_id"]][r["prop"]].append((r["object_qid"], r["object_label"]))
    provs = defaultdict(lambda: {"prov": set(), "rent": set()})
    for r in db.fetchall("SELECT title_id, provider_name, offer_type FROM providers WHERE region = 'FR'"):
        provs[r["title_id"]]["prov" if r["offer_type"] in ("flatrate", "free", "ads") else "rent"].add(r["provider_name"])

    # collections: TMDB collection first, else Wikidata "part of the series"
    groups: dict[str, dict] = {}
    for r in rows:
        ex = r["extra"] or {}
        key = name = None
        if ex.get("collection"):
            key, name = f"tmdb:{ex['collection']['id']}", ex["collection"]["name"]
        elif facts[r["id"]].get("series"):
            q, lab = facts[r["id"]]["series"][0]
            key, name = f"wd:{q}", lab
        if key:
            g = groups.setdefault(key, {"key": key, "name": name, "items": []})
            g["items"].append((r["year"] or 9999, r["release_date"].isoformat() if r["release_date"] else "", r["id"]))
    collections = []
    coll_of: dict[int, str] = {}
    for g in groups.values():
        # Wikidata "part of the series" also covers lists and studio filmographies: not sagas
        if len(g["items"]) < 2 or len(g["items"]) > 40 or NOT_A_SAGA.search(g["name"] or ""):
            continue
        g["items"].sort()
        ids = [i for _, _, i in g["items"]]
        collections.append({"key": g["key"], "name": g["name"].replace(" Collection", ""), "items": ids})
        for i in ids:
            coll_of[i] = g["key"]

    catalog, vecs = [], []
    for r in rows:
        cr = credits[r["id"]]
        f = facts[r["id"]]
        ex = r["extra"] or {}
        lab = lambda p, n=6: [x[1] for x in f.get(p, [])[:n] if x[1] and not x[1].startswith("Q")]  # noqa: E731
        t = {
            "id": r["id"], "k": r["kind"], "t": r["title"], "y": r["year"],
            "d": r["release_date"].isoformat() if r["release_date"] else None,
            "rt": r["runtime"], "lang": r["original_language"], "ov": r["overview"],
            "g": r["genres"], "kw": (r["keywords"] or [])[:25], "c": (r["countries"] or [])[:3],
            "pop": round(float(r["popularity"] or 0), 2), "va": r["vote_average"], "vc": r["vote_count"],
            "img": _img(r), "bd": TMDB_IMG + "w780" + r["backdrop_path"] if r["backdrop_path"] else None,
            "cast": cr.get("cast", [])[:12], "dir": cr.get("director", []), "wri": cr.get("writer", [])[:4],
            "cre": cr.get("creator", []), "mus": cr.get("composer", [])[:2],
            "coll": coll_of.get(r["id"]), "aw": lab("award"), "nom": lab("nominated", 4), "src": lab("based_on", 3),
            "inf": lab("influenced_by", 4), "loc": lab("narrative_location", 4), "sub": lab("main_subject", 4),
            "prov": sorted(provs[r["id"]]["prov"]), "rent": sorted(provs[r["id"]]["rent"]),
            "links": _links(r), "chips": reaction_chips(r),
        }
        if r["original_title"] and r["original_title"] != r["title"]:
            t["ot"] = r["original_title"]
        if r["kind"] == "tv":
            t["ns"] = r["number_of_seasons"]
            t["ne"] = ex.get("episodes")
        reason = filters.blocked_reason(r)
        if reason:
            t["blk"] = reason
        catalog.append({k: v for k, v in t.items() if v not in (None, [], {}, "")})
        v = r["embedding"]
        vecs.append(np.asarray(v.to_numpy() if hasattr(v, "to_numpy") else v, dtype=np.float32))

    fd = out / "films"
    fd.mkdir(parents=True, exist_ok=True)
    size = write_json(fd / "catalog.json", catalog)
    write_json(fd / "people.json", names)
    write_json(fd / "collections.json", collections)
    write_matrix(fd / "emb", np.vstack(vecs))
    model = cf.load_model()
    cf_ids = []
    if model is not None:
        keep = [i for i, t in enumerate(model.item_ids) if int(t) in {c["id"] for c in catalog}]
        cf_ids = [int(model.item_ids[i]) for i in keep]
        write_matrix(fd / "cf", model.Y[keep])
        write_json(fd / "cf_ids.json", cf_ids)
    with_img = sum(1 for c in catalog if c.get("img"))
    log.info("films: %d titles (%d with images), %d collections, %d people, %.1f MB",
             len(catalog), with_img, len(collections), len(names), size / 1e6)
    return {"count": len(catalog), "images": with_img, "collections": len(collections), "people": len(names),
            "cf_items": len(cf_ids), "dim": int(vecs[0].shape[0]) if vecs else 0}


# ------------------------------------------------------------------ other domains
def export_domain(out: Path, name: str, label: str, items, embedder) -> dict:
    if not items:
        return {"count": 0}
    dd = out / name
    dd.mkdir(parents=True, exist_ok=True)
    texts = [i.text or i.title for i in items]
    vecs = embedder.embed(texts)
    write_json(dd / "items.json", [i.to_json() for i in items])
    write_matrix(dd / "emb", vecs)
    return {"count": len(items), "label": label, "images": sum(1 for i in items if i.image)}


DOMAINS = {
    "youtube": ("Videos & docs", "cinegraph.domains.youtube", "collect"),
    "music": ("Music", "cinegraph.domains.music", "collect"),
    "recipes": ("Recipes", "cinegraph.domains.recipes", "collect"),
    "places": ("Destinations", "cinegraph.domains.wikidata_domains", "places"),
    "cars": ("Cars", "cinegraph.domains.wikidata_domains", "cars"),
    "brands": ("Brands & style", "cinegraph.domains.wikidata_domains", "brands"),
}


def export_all(out: Path | None = None, domains: list[str] | None = None, skip_films: bool = False) -> dict:
    import importlib

    from .recsys.embeddings import get_embedder

    out = out or DEFAULT_OUT
    out.mkdir(parents=True, exist_ok=True)
    manifest_path = out / "manifest.json"
    manifest = json.loads(manifest_path.read_text("utf-8")) if manifest_path.exists() else {"domains": {}}
    emb = get_embedder()

    def save() -> None:
        # register domains exported by earlier runs (a slow source shouldn't drop them)
        for d in out.iterdir():
            if d.is_dir() and (d / "items.json").exists() and d.name not in manifest["domains"]:
                items = json.loads((d / "items.json").read_text("utf-8"))
                manifest["domains"][d.name] = {"label": DOMAINS.get(d.name, (d.name,))[0], "count": len(items),
                                               "images": sum(1 for i in items if i.get("image"))}
        manifest.update(version=2, built_at=dt.datetime.now(dt.UTC).isoformat(timespec="seconds"),
                        embed_model=emb.name, film_keys=FILM_KEYS)
        write_json(manifest_path, manifest)

    if not skip_films:
        manifest["domains"]["films"] = {"label": "Films & series", **export_films(out)}
        save()
    for name in domains if domains is not None else list(DOMAINS):
        label, mod, fn = DOMAINS[name]
        try:
            items = getattr(importlib.import_module(mod), fn)()
            manifest["domains"][name] = export_domain(out, name, label, items, emb)
        except Exception as e:  # noqa: BLE001 - keep the previous export of that domain
            log.exception("domain %s failed: %s", name, e)
        save()
    save()
    return manifest
