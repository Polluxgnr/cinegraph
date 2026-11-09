"""HTTP API used by the Next.js app (proxied under /api). Single-user, bound to localhost."""
from __future__ import annotations

import datetime as dt
import io
import logging
import zipfile
from typing import Literal

from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field

from .. import db, services
from ..recsys import active, graph
from ..recsys.catalog import MOODS, PLATFORM_ALIASES, my_platforms, platforms_for, titles_by_id
from ..recsys.pipeline import Constraints, _public, recommend

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
app = FastAPI(title="CineGraph", version="0.1.0")


@app.on_event("startup")
def _startup() -> None:
    db.init_schema()

    def warm() -> None:
        # load the embedding matrix and the swipe deck so the first request isn't slow
        try:
            active._build_deck()
            recommend(n=5, log_impressions=False, explore=False)
        except Exception:  # noqa: BLE001 - empty catalogue on first boot is fine
            logging.getLogger(__name__).info("warm-up skipped (no catalogue yet?)")

    import threading

    threading.Thread(target=warm, daemon=True).start()


# ------------------------------------------------------------------ meta
@app.get("/health")
def health() -> dict:
    db.fetchone("SELECT 1")
    return {"ok": True}


@app.get("/stats")
def stats() -> dict:
    r = db.fetchone("""
        SELECT (SELECT count(*) FROM titles WHERE kind='movie') movies,
               (SELECT count(*) FROM titles WHERE kind='tv') series,
               (SELECT count(*) FROM titles WHERE details_fetched_at IS NOT NULL) tmdb_detailed,
               (SELECT count(*) FROM title_embeddings) embedded,
               (SELECT count(*) FROM kg_edges) graph_edges,
               (SELECT count(*) FROM user_ratings) ratings,
               (SELECT count(*) FROM swipes) swipes,
               (SELECT count(*) FROM watchlist) watchlist,
               (SELECT count(*) FROM pending_matches) pending""")
    return {**r, "ltr": db.get_job_state("ltr"), "rss": db.get_job_state("rss"),
            "retrain": db.get_job_state("retrain")}


@app.get("/meta")
def meta() -> dict:
    return {"moods": {k: v["label"] for k, v in MOODS.items()}, "platforms": list(PLATFORM_ALIASES),
            "my_platforms": my_platforms()}


class SettingsIn(BaseModel):
    platforms: list[str]


@app.put("/settings")
def put_settings(s: SettingsIn) -> dict:
    bad = [p for p in s.platforms if p not in PLATFORM_ALIASES]
    if bad:
        raise HTTPException(400, f"unknown platforms {bad}")
    db.set_setting("platforms", s.platforms)
    return {"my_platforms": s.platforms}


# ------------------------------------------------------------------ titles
@app.get("/titles/search")
def search(q: str = Query(min_length=1), limit: int = 12) -> list[dict]:
    from ..textnorm import norm_title

    rows = db.fetchall(
        """SELECT id FROM titles WHERE norm_title %% %(q)s OR norm_title LIKE %(p)s
           ORDER BY (norm_title = %(q)s) DESC, similarity(norm_title, %(q)s) DESC, popularity DESC NULLS LAST
           LIMIT %(l)s""", {"q": norm_title(q), "p": norm_title(q) + "%", "l": limit})
    ts = titles_by_id([r["id"] for r in rows])
    return [_with_user(_public(ts[r["id"]])) for r in rows if r["id"] in ts]


def _with_user(t: dict) -> dict:
    u = db.fetchone(
        """SELECT (SELECT rating FROM user_ratings WHERE title_id = %(id)s) rating,
                  (SELECT status FROM watchlist WHERE title_id = %(id)s) watchlist,
                  EXISTS (SELECT 1 FROM user_watched WHERE title_id = %(id)s) watched,
                  (SELECT action FROM swipes WHERE title_id = %(id)s ORDER BY id DESC LIMIT 1) swipe""",
        {"id": t["id"]})
    return {**t, "user": u}


@app.get("/titles/{title_id}")
def title(title_id: int) -> dict:
    ts = titles_by_id([title_id])
    if title_id not in ts:
        raise HTTPException(404)
    t = ts[title_id]
    credits = db.fetchall(
        """SELECT p.name, c.role, c.character, p.profile_path FROM credits c JOIN people p ON p.id = c.person_id
           WHERE c.title_id = %s ORDER BY CASE c.role WHEN 'director' THEN 0 WHEN 'creator' THEN 1
           WHEN 'writer' THEN 2 WHEN 'cast' THEN 3 ELSE 4 END, c.ord LIMIT 40""", (title_id,))
    providers = db.fetchall("SELECT provider_name, offer_type, logo_path FROM providers WHERE title_id = %s "
                            "ORDER BY offer_type, provider_name", (title_id,))
    facts = db.fetchall("SELECT prop, object_label FROM wikidata_facts WHERE title_id = %s ORDER BY prop",
                        (title_id,))
    return {**_with_user(_public(t)), "overview": t["overview"], "keywords": t["keywords"],
            "countries": t["countries"], "credits": credits, "providers": providers, "facts": facts,
            "imdb_id": t["imdb_id"], "original_title": t["original_title"]}


# ------------------------------------------------------------------ recommendations
@app.get("/recs")
def recs(n: int = 20, kind: Literal["movie", "tv", "any"] = "any") -> dict:
    c = Constraints(kinds=None if kind == "any" else {kind})
    return recommend(n=n, constraints=c, surface="recs", balance_kinds=kind == "any")


@app.get("/tonight")
def tonight(mood: str | None = None, kind: Literal["movie", "tv", "any"] = "any",
            max_runtime: int | None = None, any_platform: bool = False,
            platforms: str | None = None, n: int = 12) -> dict:
    if mood and mood not in MOODS:
        raise HTTPException(400, f"mood must be one of {list(MOODS)}")
    plats = set(platforms.split(",")) if platforms else set(my_platforms())
    c = Constraints(kinds=None if kind == "any" else {kind}, mood=mood, max_runtime=max_runtime,
                    platforms=None if any_platform else plats)
    res = recommend(n=n, constraints=c, surface="tonight", balance_kinds=kind == "any")
    has_providers = db.fetchone("SELECT EXISTS (SELECT 1 FROM providers) e")["e"]
    return {**res, "provider_data": has_providers}


class QueryIn(BaseModel):
    q: str = Field(min_length=2, max_length=500)
    n: int = 10


@app.post("/query")
def nl_query(body: QueryIn) -> dict:
    from ..recsys.nlquery import query

    return query(body.q, body.n)


# ------------------------------------------------------------------ swipe
@app.get("/swipe/next")
def swipe_next(skip: str | None = None) -> dict:
    exclude = {int(x) for x in skip.split(",") if x.strip().isdigit()} if skip else set()
    card = active.next_card(exclude=exclude)
    if card is None:
        raise HTTPException(404, "no cards: run ingestion and `cinegraph build all` first")
    return {"card": _with_user(_public(card["title"])), "why": card["why"], "progress": card["progress"]}


class SwipeIn(BaseModel):
    title_id: int
    action: Literal["like", "dislike", "love", "unseen"]


@app.post("/swipe")
def swipe(body: SwipeIn) -> dict:
    return services.swipe(body.title_id, body.action)


@app.post("/swipe/undo")
def swipe_undo() -> dict:
    last = services.undo_swipe()
    return {"undone": last}


# ------------------------------------------------------------------ ratings & watchlist
class RatingIn(BaseModel):
    title_id: int
    rating: float = Field(ge=0.5, le=5)
    watched_date: dt.date | None = None
    review: str | None = None
    rewatch: bool = False


@app.post("/ratings")
def rate(body: RatingIn) -> dict:
    return services.rate(body.title_id, body.rating, body.watched_date, body.review, body.rewatch)


@app.delete("/ratings/{title_id}")
def unrate(title_id: int) -> dict:
    services.unrate(title_id)
    return {"ok": True}


@app.get("/ratings")
def ratings(limit: int = 200) -> list[dict]:
    rows = db.fetchall("SELECT title_id, rating, source, rated_at FROM user_ratings ORDER BY rated_at DESC LIMIT %s",
                       (limit,))
    ts = titles_by_id([r["title_id"] for r in rows])
    return [{**_public(ts[r["title_id"]]), "rating": r["rating"], "source": r["source"], "rated_at": r["rated_at"]}
            for r in rows if r["title_id"] in ts]


@app.get("/watchlist")
def watchlist() -> list[dict]:
    rows = db.fetchall("SELECT title_id, status, source, note, added_at FROM watchlist "
                       "ORDER BY (status = 'watching') DESC, added_at DESC")
    ts = titles_by_id([r["title_id"] for r in rows])
    return [{**_public(ts[r["title_id"]]), "status": r["status"], "source": r["source"], "note": r["note"]}
            for r in rows if r["title_id"] in ts]


class WatchlistIn(BaseModel):
    title_id: int
    status: Literal["want", "watching"] = "want"


@app.post("/watchlist")
def watchlist_add(body: WatchlistIn) -> dict:
    services.watchlist_add(body.title_id, body.status)
    return {"ok": True}


@app.delete("/watchlist/{title_id}")
def watchlist_remove(title_id: int) -> dict:
    services.watchlist_remove(title_id)
    return {"ok": True}


@app.post("/hide/{title_id}")
def hide(title_id: int) -> dict:
    services.hide(title_id)
    return {"ok": True}


@app.get("/pending")
def pending() -> list[dict]:
    return db.fetchall("SELECT id, source, name, year, kind_hint FROM pending_matches ORDER BY created_at DESC")


# ------------------------------------------------------------------ graph
@app.get("/graph/title/{title_id}")
def graph_title(title_id: int) -> dict:
    return graph.ego_graph(title_id)


@app.get("/graph/me")
def graph_me(n: int = 30) -> dict:
    return graph.taste_graph(n)


# ------------------------------------------------------------------ letterboxd
@app.post("/import/letterboxd")
async def import_letterboxd(file: UploadFile = File(...)) -> dict:
    from ..userdata.letterboxd_zip import import_zip

    data = await file.read()
    if not zipfile.is_zipfile(io.BytesIO(data)):
        raise HTTPException(400, "expected the ZIP from letterboxd.com/settings/data")
    rep = import_zip(data)
    return {"rows": rep.rows, "matched": rep.matched, "unmatched": rep.unmatched[:200],
            "unmatched_total": len(rep.unmatched)}


@app.post("/sync/rss")
def sync_rss() -> dict:
    from ..userdata.letterboxd_rss import poll

    return poll()


@app.get("/export/letterboxd.zip")
def export_zip(include_letterboxd: bool = False) -> Response:
    from ..userdata.letterboxd_export import COLUMNS, fetch_records, render_csv

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for kind in COLUMNS:
            docs = render_csv(kind, fetch_records(kind, include_letterboxd))
            for i, doc in enumerate(docs):
                zf.writestr(f"letterboxd-{kind}{'' if len(docs) == 1 else f'-{i + 1}'}.csv", doc)
    return Response(buf.getvalue(), media_type="application/zip",
                    headers={"Content-Disposition": "attachment; filename=cinegraph-letterboxd-import.zip"})


@app.get("/export/letterboxd/{kind}.csv")
def export_csv(kind: Literal["ratings", "diary", "watched", "watchlist"], include_letterboxd: bool = False) -> Response:
    from ..userdata.letterboxd_export import fetch_records, render_csv

    doc = render_csv(kind, fetch_records(kind, include_letterboxd))[0]
    return Response(doc, media_type="text/csv",
                    headers={"Content-Disposition": f"attachment; filename=letterboxd-{kind}.csv"})


# ------------------------------------------------------------------ training
@app.post("/train/{what}")
def train(what: Literal["ltr", "all"]) -> dict:
    if what == "ltr":
        from ..recsys import ltr

        return ltr.train()
    return services.retrain_all()


__all__ = ["app", "platforms_for"]
