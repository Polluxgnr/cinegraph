"""Music catalogue from Deezer's public API (no key): top artists per genre, with pictures and
"related artists" edges for the taste graph. Your own Spotify data is pulled in the browser
(Spotify login with PKCE), and matched to this catalogue by artist name."""
from __future__ import annotations

import logging
import re
import time
import urllib.parse

from .base import Http, Item

NAME, LABEL = "music", "Music"
log = logging.getLogger(__name__)
API = "https://api.deezer.com"


def _json(http: Http, url: str, **params) -> dict:
    """Deezer answers HTTP 200 with {"error": {"code": 4, ...}} when the quota (50 req / 5 s) is hit."""
    for _ in range(5):
        data = http.get(url, **params).json()
        if not (isinstance(data, dict) and data.get("error")):
            return data
        time.sleep(5)
    return {}


def _genre_like(title: str) -> bool:
    """Keep stylistic radios ("Deep House", "Jazz vocal"); skip branded / editorial ones."""
    t = title.lower()
    return (0 < len(title) <= 24 and not re.search(r"[0-9#:./|-]", title)
            and not any(w in t for w in ("festival", "le parisien", "radio", "institut", "deezer", "playlist")))


def collect(radios_per_genre: int = 8, max_artists: int = 2500, related: bool = True) -> list[Item]:
    """Deezer's per-genre chart endpoints currently return the national chart for every genre, so the
    catalogue is built from genre *radios* instead (Jazz -> "Jazz vocal", Dance -> "Deep House"...):
    the artists playing on them, tagged with genre + sub-genre."""
    http = Http(min_interval=0.12)
    genres = [g for g in _json(http, f"{API}/genre").get("data", []) if g["id"] != 0 and "audio" not in g["name"].lower()]
    artists: dict[int, dict] = {}
    for g in genres:
        radios = [r for r in _json(http, f"{API}/genre/{g['id']}/radios").get("data", []) if _genre_like(r.get("title", ""))]
        for radio in radios[:radios_per_genre]:
            try:
                tracks = _json(http, f"{API}/radio/{radio['id']}/tracks", limit=50).get("data", [])
            except Exception as e:  # noqa: BLE001
                log.warning("deezer radio %s failed: %s", radio.get("title"), e)
                continue
            for t in tracks:
                ar = t.get("artist") or {}
                if not ar.get("id"):
                    continue
                a = artists.setdefault(ar["id"], {**ar, "genres": [], "sub": [], "plays": 0})
                a["plays"] += 1
                if g["name"] not in a["genres"]:
                    a["genres"].append(g["name"])
                if radio["title"] not in a["sub"] and radio["title"] != g["name"]:
                    a["sub"].append(radio["title"])
    for a in _json(http, f"{API}/chart/0/artists", limit=100).get("data", []):
        artists.setdefault(a["id"], {**a, "genres": ["Charts"], "sub": [], "plays": 1})
    chosen = sorted(artists.values(), key=lambda a: -a["plays"])[:max_artists]
    log.info("music: %d artists from %d genres (keeping %d)", len(artists), len(genres), len(chosen))
    keep = {a["id"] for a in chosen}
    items = []
    for a in chosen:
        aid = a["id"]
        rel: list[str] = []
        fans, picture = 0, a.get("picture_xl") or a.get("picture_big")
        if related:
            try:
                rel = [f"music:{r['id']}" for r in _json(http, f"{API}/artist/{aid}/related", limit=15).get("data", [])
                       if r["id"] in keep]
                info = _json(http, f"{API}/artist/{aid}")
                fans = info.get("nb_fan", 0)
                picture = info.get("picture_xl") or picture
            except Exception:  # noqa: BLE001
                pass
        name = a["name"]
        tags = a["genres"] + a["sub"][:4]
        items.append(Item(
            id=f"music:{aid}", title=name, subtitle=" · ".join((a["sub"][:1] or a["genres"][:1]) + a["genres"][1:2]),
            image=picture, url=a.get("link") or f"https://www.deezer.com/artist/{aid}",
            tags=tags, text=f"{name}. {', '.join(tags)} artist.", pop=float(fans or a["plays"]),
            links={"spotify": f"https://open.spotify.com/search/{urllib.parse.quote(name)}",
                   "youtube": f"https://www.youtube.com/results?search_query={urllib.parse.quote(name)}",
                   "deezer": f"https://www.deezer.com/artist/{aid}"},
            related=rel, meta={"fans": fans},
        ))
    log.info("music: %d artists", len(items))
    return items
