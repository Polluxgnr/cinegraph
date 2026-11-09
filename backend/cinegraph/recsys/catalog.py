"""Catalogue helpers shared by the ranker, the swipe deck and the API: cached embedding
matrix, title metadata, moods and platform matching."""
from __future__ import annotations

import threading
import time
from dataclasses import dataclass

import numpy as np

from .. import db
from ..textnorm import strip_accents
from .embeddings import load_matrix

# ------------------------------------------------------------------ embeddings cache
_lock = threading.Lock()
_cache: dict = {"key": None, "ids": None, "m": None, "pos": None, "checked": 0.0}


@dataclass
class EmbIndex:
    ids: np.ndarray
    m: np.ndarray
    pos: dict[int, int]

    def vec(self, tid: int) -> np.ndarray | None:
        j = self.pos.get(tid)
        return None if j is None else self.m[j]

    def __len__(self) -> int:
        return len(self.ids)


def emb_index() -> EmbIndex:
    with _lock:
        now = time.monotonic()
        if _cache["m"] is None or now - _cache["checked"] > 30:
            key = tuple(db.fetchone("SELECT count(*) n, COALESCE(max(title_id), 0) mx, "
                                    "COALESCE(max(md5(text_hash)), '') h FROM title_embeddings").values())
            _cache["checked"] = now
            if key != _cache["key"]:
                ids, m = load_matrix()
                _cache.update(key=key, ids=ids, m=m, pos={int(t): i for i, t in enumerate(ids)})
        return EmbIndex(_cache["ids"], _cache["m"], _cache["pos"])


# ------------------------------------------------------------------ metadata
TITLE_COLS = """t.id, t.kind, t.tmdb_id, t.imdb_id, t.title, t.original_title, t.year, t.genres, t.keywords,
    t.runtime, t.number_of_seasons, t.popularity, t.vote_average, t.vote_count, t.poster_path, t.backdrop_path,
    t.overview, t.countries, t.original_language, t.source,
    COALESCE((SELECT array_agg(DISTINCT p.provider_name) FROM providers p WHERE p.title_id = t.id
              AND p.offer_type IN ('flatrate', 'free', 'ads')), '{}') AS stream_on"""


def titles_by_id(ids: list[int]) -> dict[int, dict]:
    if not ids:
        return {}
    rows = db.fetchall(f"SELECT {TITLE_COLS} FROM titles t WHERE t.id = ANY(%s)", (list(ids),))
    return {r["id"]: r for r in rows}


# ------------------------------------------------------------------ platforms
PLATFORM_ALIASES = {
    "Netflix": ["netflix", "netflix standard with ads", "netflix basic with ads"],
    "Prime Video": ["amazon prime video", "prime video", "amazon prime video with ads"],
    "Disney+": ["disney plus", "disney"],
    "HBO Max": ["max", "hbo max", "max amazon channel", "hbo max amazon channel"],
    "Canal+": ["canal", "canal series", "canal cine series", "mycanal", "canal plus"],
    "Apple TV+": ["apple tv plus", "apple tv plus amazon channel"],
}


def _pnorm(s: str) -> str:
    s = strip_accents(s).lower().replace("+", " plus ").replace("é", "e")
    s = "".join(c if c.isalnum() or c == " " else " " for c in s)
    return " ".join(s.split())


_ALIAS_INDEX = {_pnorm(a): k for k, al in PLATFORM_ALIASES.items() for a in al + [k]}


def platform_of(provider_name: str) -> str | None:
    n = _pnorm(provider_name)
    if n in _ALIAS_INDEX:
        return _ALIAS_INDEX[n]
    for alias, k in _ALIAS_INDEX.items():
        if n.startswith(alias + " ") and k != "HBO Max":
            return k
    return None


def platforms_for(title: dict) -> list[str]:
    return sorted({p for name in title.get("stream_on") or [] if (p := platform_of(name))})


# ------------------------------------------------------------------ moods
MOODS: dict[str, dict] = {
    "tense": {"label": "Tense & gripping", "genres": {"Thriller", "Crime", "War", "Mystery", "Action & Adventure"},
              "keywords": {"suspense", "tension", "conspiracy", "hostage", "heist", "manhunt", "spy", "espionage",
                           "cat and mouse", "psychological thriller", "survival", "serial killer", "investigation"}},
    "laugh": {"label": "Laugh out loud", "genres": {"Comedy"}, "require_genre": True,
              "keywords": {"dark comedy", "black comedy", "satire", "parody", "absurd", "deadpan", "mockumentary",
                           "spoof", "cringe comedy", "buddy comedy", "black humor", "dark humor"}},
    "mind": {"label": "Mind-bending", "genres": {"Science Fiction", "Mystery", "Sci-Fi & Fantasy"},
             "keywords": {"time travel", "twist ending", "nonlinear timeline", "dream", "parallel universe",
                          "alternate reality", "mind-bending", "surreal", "time loop", "simulation", "memory",
                          "identity", "psychological", "multiverse", "artificial intelligence", "unreliable narrator",
                          "philosophy"}},
    "horror": {"label": "Horror", "genres": {"Horror"}, "require_genre": True,
               "keywords": {"supernatural", "haunted house", "ghost", "slasher", "folk horror", "body horror"}},
    "epic": {"label": "Epic", "genres": {"War", "History", "Adventure", "Fantasy", "Western", "War & Politics"},
             "keywords": {"epic", "battle", "empire", "saga", "space opera", "historical epic", "kingdom",
                          "world war ii", "quest", "dystopia"}, "min_runtime": 125},
}


def mood_score(title: dict, mood: str) -> float:
    m = MOODS[mood]
    g = set(title.get("genres") or [])
    kws = {k.lower() for k in title.get("keywords") or []}
    gm = bool(g & m["genres"])
    km = len(kws & m["keywords"])
    if m.get("require_genre") and not gm:
        return 0.0
    s = (0.6 if gm else 0.0) + min(km, 3) * 0.2
    if mood == "laugh" and {"Romance", "Family"} & g and not km:
        s *= 0.4  # family comedies / rom-coms aren't the brief
    if m.get("min_runtime") and title.get("kind") == "movie":
        rt = title.get("runtime") or 0
        if rt and rt < m["min_runtime"] and not km:
            s *= 0.5
    return min(s, 1.0)


def my_platforms() -> list[str]:
    """Your streaming services: the in-app setting, else MY_PLATFORMS from .env."""
    from ..config import get_settings

    return db.get_setting("platforms") or get_settings().platforms
