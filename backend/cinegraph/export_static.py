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
    """TMDB posters are stored as their path ("/abc.jpg"; the app prefixes the w342 base), others as full URLs."""
    if t.get("poster_path"):
        return t["poster_path"]
    return (t.get("extra") or {}).get("image")


def _ids(t: dict) -> dict:
    """Outbound link ids, rebuilt into URLs by the app (web/lib/data.ts filmLinks): ~4x smaller than URLs."""
    ex = (t.get("extra") or {}).get("links") or {}
    out = {"tm": t["tmdb_id"]}
    if t.get("imdb_id"):
        out["im"] = t["imdb_id"]
    if t.get("wikidata_id"):
        out["wd"] = t["wikidata_id"]
    ac = ex.get("allocine_film") if t["kind"] == "movie" else ex.get("allocine_series")
    if ac:
        out["ac"] = ac
    if ex.get("senscritique"):
        out["sc"] = ex["senscritique"]
    if ex.get("letterboxd"):
        out["lb"] = ex["letterboxd"]
    if ex.get("frwiki"):
        out["wp"] = "fr:" + ex["frwiki"].replace(" ", "_")
    elif ex.get("enwiki"):
        out["wp"] = "en:" + ex["enwiki"].replace(" ", "_")
    return out


def reduce_dims(m: np.ndarray, k: int = 192) -> tuple[np.ndarray, float]:
    """PCA to k dimensions (centred, top-k right singular vectors), rows re-normalised: halves the download
    while keeping cosine neighbourhoods. Returns the matrix and the share of variance kept."""
    if m.shape[1] <= k or m.shape[0] <= k:
        return m, 1.0
    c = m - m.mean(axis=0, keepdims=True)
    _, s, vt = np.linalg.svd(c, full_matrices=False)
    z = c @ vt[:k].T
    z /= np.linalg.norm(z, axis=1, keepdims=True) + 1e-9
    return z.astype(np.float32), float((s[:k] ** 2).sum() / (s ** 2).sum())


DETAIL_SHARDS = 64
CORE_KW = CORE_CAST = 8


DETAIL_SHARDS = 64
CORE_KW = CORE_CAST = 8


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
    "c": "countries", "pop": "popularity", "va": "vote average /10", "vc": "vote count", "img": "poster: TMDB path (/x.jpg, w342) or full url", "x": "link ids (tm imdb wd ac sc lb wp)",
    "bd": "backdrop TMDB path (w780)", "tr": "YouTube trailer key", "tf": "French title (TMDB fr-FR, when different)", "mlr": "MovieLens mean rating /5", "ir": "IMDb rating /10 (official dataset)", "ic": "IMDb votes", "mlc": "MovieLens ratings count", "cast": "person idx (billing order)", "dir": "directors", "wri": "writers",
    "cre": "creators", "mus": "composers", "coll": "collection key", "aw": "awards", "nom": "nominations",
    "src": "based on", "inf": "influenced by", "loc": "narrative locations", "sub": "main subjects",
    "prov": "FR streaming (subscription / free)", "rent": "FR rent / buy", "details/<id % 64>.json": "ov kw cast rent nom jw, loaded on demand",
    "chips": "reaction chips", "blk": "hard-filter reason (romance / musical / sitcom)",
}


NOT_A_SAGA = re.compile(r"(list of|greatest|best |feature film|animated feature|films$|movies$|top \d+|\d+ (films|movies)|"
                        r"criterion|registry|canon|filmography|anthology film|productions$)", re.I)


def movielens_stats(min_count: int = 20) -> dict[int, tuple[float, int]]:
    """title_id -> (mean rating /5, number of ratings) from the individual MovieLens ratings, if downloaded."""
    from .config import get_settings

    s = get_settings()
    path = s.data_dir / "movielens" / s.movielens_variant / "ratings.npz"
    if not path.exists():
        return {}
    z = np.load(path)
    tid, r = z["title_id"].astype(np.int64), z["rating"].astype(np.float64)
    n = np.bincount(tid)
    tot = np.bincount(tid, weights=r)
    ids = np.nonzero(n >= min_count)[0]
    return {int(i): (round(float(tot[i] / n[i]), 2), int(n[i])) for i in ids}


def imdb_ratings() -> dict[str, tuple[float, int]]:
    """imdb id -> (IMDb rating /10, number of votes) from IMDb's official non-commercial dataset
    (https://developer.imdb.com/non-commercial-datasets/, refreshed daily; personal, non-commercial use).
    Downloaded once a day into the data dir; an unreachable dataset only means no IMDb scores this run."""
    import gzip
    import time
    import urllib.request

    from .config import get_settings

    path = get_settings().data_dir / "imdb" / "title.ratings.tsv.gz"
    try:
        if not path.exists() or time.time() - path.stat().st_mtime > 86_400:
            path.parent.mkdir(parents=True, exist_ok=True)
            urllib.request.urlretrieve("https://datasets.imdbws.com/title.ratings.tsv.gz", path)
        out = {}
        with gzip.open(path, "rt", encoding="utf-8") as f:
            next(f)
            for line in f:
                tconst, rating, votes = line.rstrip("\n").split("\t")
                out[tconst] = (float(rating), int(votes))
        return out
    except Exception as e:  # noqa: BLE001 - optional source
        print(f"IMDb ratings unavailable: {e}")
        return {}


def export_films(out: Path) -> dict:
    ml = movielens_stats()
    imdb = imdb_ratings()
    rows = db.fetchall("""
        SELECT t.*, e.embedding FROM titles t JOIN title_embeddings e ON e.title_id = t.id
        ORDER BY t.id""")
    raw = defaultdict(lambda: defaultdict(list))  # title -> role -> person db ids (billing order)
    pinfo: dict[int, tuple] = {}  # person db id -> (name, tmdb id, profile path, wikidata id)
    chars: dict[int, list[str]] = defaultdict(list)  # title -> character per cast member (billing order)
    for r in db.fetchall("""SELECT c.title_id, c.role, c.person_id, c.character, p.name, p.tmdb_person_id,
                                   p.profile_path, p.wikidata_id FROM credits c
                             JOIN people p ON p.id = c.person_id ORDER BY c.title_id, c.role, c.ord"""):
        pinfo.setdefault(r["person_id"], (r["name"], r["tmdb_person_id"], r["profile_path"], r["wikidata_id"]))
        raw[r["title_id"]][r["role"]].append(r["person_id"])
        if r["role"] == "cast":
            chars[r["title_id"]].append(r["character"] or "")
    # people on the catalogue's cards come first: people.json ships only their names (about half of everyone);
    # the rest (deeper cast, details only) get their name from their people/N.json shard when shown
    core_roles = {"cast": CORE_CAST, "director": 99, "writer": 4, "creator": 99, "composer": 2}
    people: dict[int, int] = {}
    for tid in sorted(raw):
        for role, n in core_roles.items():
            for pid in raw[tid].get(role, [])[:n]:
                people.setdefault(pid, len(people))
    n_core = len(people)
    for tid in sorted(raw):
        for ids in raw[tid].values():
            for pid in ids:
                people.setdefault(pid, len(people))
    names = [""] * len(people)
    pmeta: list[list] = [[]] * len(people)  # idx -> [tmdb person id, profile path, wikidata id, (name if not core)]
    for pid, i in people.items():
        nm, tm, img, wd = pinfo[pid]
        names[i] = nm
        pmeta[i] = [tm, img, wd] + ([nm] if i >= n_core else [])
    credits = {tid: {role: [people[pid] for pid in ids] for role, ids in roles.items()} for tid, roles in raw.items()}
    credits = defaultdict(lambda: defaultdict(list), {k: defaultdict(list, v) for k, v in credits.items()})
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
    details: list[dict[int, dict]] = [{} for _ in range(DETAIL_SHARDS)]
    for r in rows:
        cr = credits[r["id"]]
        f = facts[r["id"]]
        ex = r["extra"] or {}
        lab = lambda p, n=6: [x[1] for x in f.get(p, [])[:n] if x[1] and not x[1].startswith("Q")]  # noqa: E731
        t = {
            "id": r["id"], "k": r["kind"], "t": r["title"], "y": r["year"],
            "d": r["release_date"].isoformat() if r["release_date"] else None,
            "rt": r["runtime"], "lang": r["original_language"],
            "g": r["genres"], "kw": (r["keywords"] or [])[:CORE_KW], "c": (r["countries"] or [])[:3],
            "pop": round(float(r["popularity"] or 0), 2), "va": r["vote_average"], "vc": r["vote_count"],
            "img": _img(r), "bd": r["backdrop_path"] or None,
            "tr": (r["extra"] or {}).get("trailer"),
            "tf": ((r["extra"] or {}).get("fr") or {}).get("t") if ((r["extra"] or {}).get("fr") or {}).get("t") != r["title"] else None,
            "mlr": ml.get(r["id"], (None, None))[0], "mlc": ml.get(r["id"], (None, None))[1],
            "ir": imdb.get(r["imdb_id"] or "", (None, None))[0], "ic": imdb.get(r["imdb_id"] or "", (None, None))[1],
            "cast": cr.get("cast", [])[:CORE_CAST], "dir": cr.get("director", []), "wri": cr.get("writer", [])[:4],
            "cre": cr.get("creator", []), "mus": cr.get("composer", [])[:2],
            "coll": coll_of.get(r["id"]), "aw": lab("award"), "src": lab("based_on", 3),
            "inf": lab("influenced_by", 4), "loc": lab("narrative_location", 4), "sub": lab("main_subject", 4),
            "prov": sorted(provs[r["id"]]["prov"]),
            "x": {k: v for k, v in _ids(r).items() if k in ("tm", "wd")}, "chips": reaction_chips(r),
        }
        # loaded on demand when the film is shown (web/lib/data.ts filmDetails)
        detail = {"ov": r["overview"], "ovf": ((r["extra"] or {}).get("fr") or {}).get("ov"), "kw": (r["keywords"] or [])[:25], "cast": cr.get("cast", [])[:30], "chr": chars[r["id"]][:30] if any(chars[r["id"]][:30]) else None,
                  "rent": sorted(provs[r["id"]]["rent"]), "nom": lab("nominated", 4), "jw": ex.get("watch_link"),
                  # outside-site link ids (IMDb, AlloCiné, SensCritique, Letterboxd, Wikipedia): only the title page needs them
                  "xl": {k: v for k, v in _ids(r).items() if k not in ("tm", "wd")}}
        details[r["id"] % DETAIL_SHARDS][r["id"]] = {k: v for k, v in detail.items() if v not in (None, [], {}, "")}
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
    write_json(fd / "people.json", names[:n_core])
    # photos and ids per person, sharded like the details (loaded when a cast list or person page is shown)
    (fd / "people").mkdir(exist_ok=True)
    pshards: list[dict[int, list]] = [{} for _ in range(DETAIL_SHARDS)]
    for i, m in enumerate(pmeta):
        if any(m[:3]) or len(m) > 3:
            pshards[i % DETAIL_SHARDS][i] = m
    for i, shard in enumerate(pshards):
        write_json(fd / "people" / f"{i}.json", shard)
    write_json(fd / "collections.json", collections)
    (fd / "details").mkdir(exist_ok=True)
    for i, shard in enumerate(details):
        write_json(fd / "details" / f"{i}.json", shard)
    emb, kept = reduce_dims(np.vstack(vecs))
    log.info("film embeddings: %d -> %d dims (%.0f%% of variance kept)", vecs[0].shape[0], emb.shape[1], kept * 100)
    write_matrix(fd / "emb", emb)
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
            "format": 3, "detail_shards": DETAIL_SHARDS,
            "cf_items": len(cf_ids), "dim": int(emb.shape[1]) if vecs else 0}


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


def export_extras(out: Path, name: str, module, items, manifest: dict) -> None:
    """A domain module may define `extras(items) -> {"releases": [...], ...}`: side lists published
    next to its catalogue as <domain>/<key>.json (new music releases, clothing pieces...)."""
    fn = getattr(module, "extras", None)
    if fn is None or not items:
        return
    try:
        extras = fn(items)
    except Exception as e:  # noqa: BLE001 - extras are a bonus, never fatal
        log.warning("extras for %s failed: %s", name, e)
        return
    entry = manifest["domains"].setdefault(name, {})
    entry["extras"] = {**entry.get("extras", {})}
    for key, rows in extras.items():
        if not rows:
            continue
        (out / name).mkdir(parents=True, exist_ok=True)
        write_json(out / name / f"{key}.json", rows)
        entry["extras"][key] = len(rows)
        log.info("%s/%s.json: %d rows", name, key, len(rows))


DOMAINS = {
    "youtube": ("Videos & docs", "cinegraph.domains.youtube", "collect"),
    "music": ("Music", "cinegraph.domains.music", "collect"),
    "recipes": ("Recipes", "cinegraph.domains.recipes", "collect"),
    "places": ("Destinations", "cinegraph.domains.wikidata_domains", "places"),
    "cars": ("Dream garage", "cinegraph.domains.wikidata_domains", "cars"),
    "brands": ("Style", "cinegraph.domains.style", "collect"),
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
        from .config import get_settings

        ev = get_settings().data_dir / "eval.json"
        if ev.exists():
            manifest["eval"] = json.loads(ev.read_text("utf-8"))
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
            prev = (manifest["domains"].get(name) or {}).get("count", 0)
            if prev and len(items) < 0.6 * prev:
                # a source that timed out half-way shouldn't wipe last week's catalogue
                log.warning("domain %s: %d items vs %d before, keeping the previous export", name, len(items), prev)
                continue
            manifest["domains"][name] = export_domain(out, name, label, items, emb)
        except Exception as e:  # noqa: BLE001 - keep the previous export of that domain
            log.exception("domain %s failed: %s", name, e)
            items = None
        export_extras(out, name, importlib.import_module(mod), items, manifest)
        save()
    save()
    return manifest
