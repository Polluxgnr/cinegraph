"""Your taste profile, assembled fresh from the DB on each request (it is small), so every
rating or swipe takes effect immediately."""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .. import db

SWIPE_STARS = {"love": 5.0, "like": 4.0, "dislike": 1.5}


@dataclass
class Signal:
    rating: float | None      # stars (explicit, or derived from a swipe / heart)
    kind: str                 # rating | love | like | dislike | heart | watched
    title: str = ""

    @property
    def weight(self) -> float:
        if self.rating is None:
            return 0.15  # watched without a rating: mild positive (you chose to watch it)
        return float(np.clip((self.rating - 3.0) / 2.0, -1.0, 1.0))


@dataclass
class Profile:
    signals: dict[int, Signal] = field(default_factory=dict)
    seen: set[int] = field(default_factory=set)
    unseen: set[int] = field(default_factory=set)       # swiped "not seen"
    watchlist: set[int] = field(default_factory=set)
    swiped: set[int] = field(default_factory=set)

    @property
    def rated(self) -> dict[int, float]:
        return {t: s.rating for t, s in self.signals.items() if s.rating is not None}

    def anchors(self, min_abs_w: float = 0.2) -> dict[int, dict]:
        from .graph import anchor_label

        return {t: {"w": s.weight, "title": s.title, "label": anchor_label(s.rating if s.kind == "rating" else None,
                                                                            s.kind if s.kind != "rating" else "")}
                for t, s in self.signals.items() if abs(s.weight) >= min_abs_w}

    @property
    def n_feedback(self) -> int:
        return len(self.signals) + len(self.unseen)


def load_profile() -> Profile:
    p = Profile()
    for r in db.fetchall("SELECT w.title_id, t.title FROM user_watched w JOIN titles t ON t.id = w.title_id"):
        p.signals[r["title_id"]] = Signal(None, "watched", r["title"])
        p.seen.add(r["title_id"])
    for r in db.fetchall("SELECT l.title_id, t.title FROM user_likes l JOIN titles t ON t.id = l.title_id"):
        p.signals[r["title_id"]] = Signal(4.5, "heart", r["title"])
        p.seen.add(r["title_id"])
    # latest swipe per title
    for r in db.fetchall(
            """SELECT DISTINCT ON (s.title_id) s.title_id, s.action, t.title FROM swipes s
               JOIN titles t ON t.id = s.title_id ORDER BY s.title_id, s.created_at DESC"""):
        p.swiped.add(r["title_id"])
        if r["action"] == "unseen":
            p.unseen.add(r["title_id"])
            continue
        p.signals[r["title_id"]] = Signal(SWIPE_STARS[r["action"]], r["action"], r["title"])
        p.seen.add(r["title_id"])
    # explicit stars win (rated after / instead of a swipe)
    for r in db.fetchall("""SELECT r.title_id, r.rating, r.source, t.title FROM user_ratings r
                            JOIN titles t ON t.id = r.title_id"""):
        prev = p.signals.get(r["title_id"])
        if r["source"] == "swipe" and prev is not None and prev.kind in SWIPE_STARS:
            continue
        p.signals[r["title_id"]] = Signal(float(r["rating"]), "rating", r["title"])
        p.seen.add(r["title_id"])
        p.unseen.discard(r["title_id"])
    for r in db.fetchall("SELECT title_id FROM watchlist"):
        p.watchlist.add(r["title_id"])
    return p
