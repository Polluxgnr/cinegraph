"""Hard taste filters: no romance, no musicals, no laugh-track sitcoms."""
from __future__ import annotations

from functools import lru_cache
from importlib import resources

import yaml

from ..textnorm import norm_title


@lru_cache
def rules() -> dict:
    return yaml.safe_load(resources.files("cinegraph").joinpath("config/hard_filters.yaml").read_text("utf-8"))


def _kw(title: dict) -> set[str]:
    return {k.lower() for k in (title.get("keywords") or [])}


def blocked_reason(title: dict) -> str | None:
    """Return why a title is excluded, or None. `title` needs genres, keywords, kind, title."""
    r = rules()
    genres = list(title.get("genres") or [])
    kws = _kw(title)

    if "Romance" in genres or kws & {"romance", "romance film", "romantic drama", "romantic fantasy"}:
        # a love story inside a thriller / sci-fi / war film is fine; a romance with extras isn't
        strong = set(genres) & set(r["romance"]["strong_genres"])
        if (genres and genres[0] == "Romance") or not strong:
            return "romance"
    if kws & {k.lower() for k in r["romance"]["keywords"]}:
        return "romance"

    if kws & {k.lower() for k in r["musicals"]["keywords"]}:
        return "musical"

    if title.get("kind") == "tv":
        lt = r["laugh_track_sitcoms"]
        if kws & {k.lower() for k in lt["keywords"]}:
            return "laugh-track sitcom"
        if norm_title(title.get("title")) in _blocked_sitcoms():
            return "laugh-track sitcom"
    return None


@lru_cache
def _blocked_sitcoms() -> frozenset[str]:
    return frozenset(norm_title(t) for t in rules()["laugh_track_sitcoms"]["titles"])


def allowed(title: dict) -> bool:
    return blocked_reason(title) is None
