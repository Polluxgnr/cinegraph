"""Shared shape for every taste domain (films, YouTube, recipes, places, cars, brands, music...).

A domain module exposes `NAME`, `LABEL` and `collect() -> list[Item]`. The exporter embeds each
item's text with the same model as films, so one recommendation engine in the browser serves
every domain. Adding a domain = one file here + one entry in `REGISTRY`.
"""
from __future__ import annotations

import logging
import time
import urllib.parse
from dataclasses import asdict, dataclass, field
from typing import Any

import httpx

log = logging.getLogger(__name__)

UA = "CineGraph/0.2 (https://github.com/Polluxgnr/cinegraph; personal taste app)"


@dataclass
class Item:
    id: str                      # "<domain>:<source id>"
    title: str
    subtitle: str = ""           # one short line under the title
    image: str | None = None
    url: str | None = None       # canonical page (official / open source)
    tags: list[str] = field(default_factory=list)
    text: str = ""               # what gets embedded (description, ingredients, genres...)
    date: str | None = None      # ISO date when meaningful (published, released, founded)
    pop: float = 0.0             # popularity prior, any scale (normalised per domain in the app)
    links: dict[str, str] = field(default_factory=dict)   # extra outbound links
    meta: dict[str, Any] = field(default_factory=dict)
    related: list[str] = field(default_factory=list)      # graph edges to other item ids

    def to_json(self) -> dict:
        d = asdict(self)
        return {k: v for k, v in d.items() if v not in (None, "", [], {}) or k in ("id", "title")}


def commons_image(filename: str | None, width: int = 600) -> str | None:
    """Wikimedia Commons file name (or URL) -> thumbnail URL."""
    if not filename:
        return None
    name = filename.rsplit("/", 1)[-1]
    name = urllib.parse.unquote(name)
    return f"https://commons.wikimedia.org/wiki/Special:FilePath/{urllib.parse.quote(name)}?width={width}"


class Http:
    """Polite JSON/XML client: fixed User-Agent, minimum interval, retries."""

    def __init__(self, min_interval: float = 0.2):
        self.c = httpx.Client(headers={"User-Agent": UA}, timeout=60, follow_redirects=True)
        self.min_interval = min_interval
        self._last = 0.0

    def get(self, url: str, **params) -> httpx.Response:
        delay = 1.0
        for attempt in range(4):
            wait = self.min_interval - (time.monotonic() - self._last)
            if wait > 0:
                time.sleep(wait)
            self._last = time.monotonic()
            try:
                r = self.c.get(url, params=params or None)
                if r.status_code in (429, 500, 502, 503, 504):
                    raise httpx.HTTPStatusError("retry", request=r.request, response=r)
                return r
            except httpx.HTTPError as e:
                if attempt == 3:
                    raise
                log.debug("retry %s (%s)", url, e)
                time.sleep(delay)
                delay *= 2
        raise RuntimeError("unreachable")
