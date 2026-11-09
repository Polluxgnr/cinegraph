"""Feedback handling shared by the API, CLI and worker. Every rating or swipe updates the
profile immediately (the profile is read fresh per request); the LTR model retrains in the
background once enough new feedback has arrived, and everything retrains nightly."""
from __future__ import annotations

import datetime as dt
import logging
import threading

from . import db
from .recsys import bandit

log = logging.getLogger(__name__)

RETRAIN_EVERY = 10   # new labelled events before an incremental LTR retrain
_train_lock = threading.Lock()

SWIPE_REWARD = {"love": 1.0, "like": 0.8, "dislike": 0.0}


def _feedback_count() -> int:
    r = db.fetchone("SELECT (SELECT count(*) FROM swipes WHERE action <> 'unseen') + "
                    "(SELECT count(*) FROM user_ratings) AS n")
    return int(r["n"])


def maybe_retrain_async() -> None:
    state = db.get_job_state("ltr_trigger")
    n = _feedback_count()
    if n - state.get("at", 0) < RETRAIN_EVERY:
        return

    def run():
        if not _train_lock.acquire(blocking=False):
            return
        try:
            from .recsys import ltr

            res = ltr.train()
            db.set_job_state("ltr_trigger", {"at": n, "last": dt.datetime.now(dt.UTC).isoformat(), **res})
        except Exception:  # noqa: BLE001
            log.exception("incremental LTR retrain failed")
        finally:
            _train_lock.release()

    threading.Thread(target=run, daemon=True).start()


def swipe(title_id: int, action: str) -> dict:
    if action not in ("like", "dislike", "love", "unseen"):
        raise ValueError(action)
    with db.connect() as conn:
        conn.execute("INSERT INTO swipes (title_id, action) VALUES (%s, %s)", (title_id, action))
        if action != "unseen":
            conn.execute("INSERT INTO user_watched (title_id, source) VALUES (%s, 'swipe') ON CONFLICT DO NOTHING",
                         (title_id,))
            conn.execute("DELETE FROM watchlist WHERE title_id = %s AND status = 'want'", (title_id,))
        conn.commit()
    if action in SWIPE_REWARD:
        bandit.update(title_id, SWIPE_REWARD[action])
    maybe_retrain_async()
    return {"ok": True}


def undo_swipe() -> dict | None:
    last = db.fetchone("SELECT id, title_id, action FROM swipes ORDER BY id DESC LIMIT 1")
    if not last:
        return None
    with db.connect() as conn:
        conn.execute("DELETE FROM swipes WHERE id = %s", (last["id"],))
        if not conn.execute("SELECT 1 FROM swipes WHERE title_id = %s AND action <> 'unseen'",
                            (last["title_id"],)).fetchone():
            conn.execute("DELETE FROM user_watched WHERE title_id = %s AND source = 'swipe'", (last["title_id"],))
        conn.commit()
    return last


def rate(title_id: int, rating: float, watched_date: dt.date | None = None, review: str | None = None,
         rewatch: bool = False) -> dict:
    if not 0.5 <= rating <= 5:
        raise ValueError("rating must be 0.5..5")
    rating = round(rating * 2) / 2
    with db.connect() as conn:
        conn.execute(
            "INSERT INTO user_ratings (title_id, rating, source) VALUES (%s, %s, 'app') "
            "ON CONFLICT (title_id) DO UPDATE SET rating = EXCLUDED.rating, source = 'app', rated_at = now()",
            (title_id, rating))
        conn.execute("INSERT INTO user_watched (title_id, source) VALUES (%s, 'app') ON CONFLICT DO NOTHING",
                     (title_id,))
        conn.execute(
            "INSERT INTO diary (title_id, watched_date, rating, rewatch, review, source, external_id) "
            "VALUES (%s, %s, %s, %s, %s, 'app', %s) ON CONFLICT (external_id) DO UPDATE SET rating = EXCLUDED.rating, "
            "review = COALESCE(EXCLUDED.review, diary.review)",
            (title_id, watched_date or dt.date.today(), rating, rewatch, review,
             f"app:{title_id}:{(watched_date or dt.date.today()).isoformat()}"))
        conn.execute("DELETE FROM watchlist WHERE title_id = %s", (title_id,))
        conn.commit()
    bandit.update(title_id, max(0.0, min(1.0, (rating - 2.0) / 3.0)))
    maybe_retrain_async()
    return {"ok": True, "rating": rating}


def unrate(title_id: int) -> None:
    with db.connect() as conn:
        conn.execute("DELETE FROM user_ratings WHERE title_id = %s", (title_id,))
        conn.execute("DELETE FROM diary WHERE title_id = %s AND source = 'app'", (title_id,))
        conn.commit()


def hide(title_id: int) -> None:
    db.execute("INSERT INTO hidden_titles (title_id) VALUES (%s) ON CONFLICT DO NOTHING", (title_id,))
    db.execute("DELETE FROM watchlist WHERE title_id = %s", (title_id,))
    bandit.update(title_id, 0.0)


def watchlist_add(title_id: int, status: str = "want", note: str | None = None) -> None:
    db.execute("INSERT INTO watchlist (title_id, status, source, note) VALUES (%s, %s, 'app', %s) "
               "ON CONFLICT (title_id) DO UPDATE SET status = EXCLUDED.status", (title_id, status, note))
    bandit.update(title_id, 0.7)


def watchlist_remove(title_id: int) -> None:
    db.execute("DELETE FROM watchlist WHERE title_id = %s", (title_id,))


def retrain_all() -> dict:
    """Nightly: graph, embeddings for new titles, clusters, ALS, LTR."""
    from .recsys import cf, embeddings, graph, ltr

    out: dict = {}
    for name, fn in (("graph", graph.build), ("embeddings", embeddings.build), ("clusters", bandit.build_clusters),
                     ("cf", cf.train), ("ltr", ltr.train)):
        try:
            out[name] = fn()
        except Exception as e:  # noqa: BLE001 - one failing stage shouldn't block the others
            log.exception("retrain stage %s failed", name)
            out[name] = {"error": str(e)}
    db.set_job_state("retrain", {"at": dt.datetime.now(dt.UTC).isoformat(), **{k: str(v)[:200] for k, v in out.items()}})
    return out
