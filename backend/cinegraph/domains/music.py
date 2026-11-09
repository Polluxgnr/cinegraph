"""Music catalogue from Deezer's public API (no key): top artists per genre, with pictures and
"related artists" edges for the taste graph. Your own Spotify data is pulled in the browser
(Spotify login with PKCE), and matched to this catalogue by artist name."""
from __future__ import annotations

import logging
import urllib.parse

from .base import Http, Item

NAME, LABEL = "music", "Music"
log = logging.getLogger(__name__)
API = "https://api.deezer.com"


def collect(per_genre: int = 60, related: bool = True) -> list[Item]:
    http = Http(min_interval=0.15)  # Deezer allows 50 requests / 5 s
    genres = [g for g in http.get(f"{API}/genre").json().get("data", []) if g["id"] != 0]
    artists: dict[int, dict] = {}
    for g in genres:
        try:
            data = http.get(f"{API}/genre/{g['id']}/artists").json().get("data", [])[:per_genre]
        except Exception as e:  # noqa: BLE001
            log.warning("deezer genre %s failed: %s", g["name"], e)
            continue
        for a in data:
            artists.setdefault(a["id"], {**a, "genres": []})["genres"].append(g["name"])
    for a in http.get(f"{API}/chart/0/artists", limit=100).json().get("data", []):
        artists.setdefault(a["id"], {**a, "genres": []})
    items = []
    for aid, a in artists.items():
        rel: list[str] = []
        fans = 0
        if related:
            try:
                rel = [f"music:{r['id']}" for r in http.get(f"{API}/artist/{aid}/related", limit=10).json()
                       .get("data", [])]
                fans = http.get(f"{API}/artist/{aid}").json().get("nb_fan", 0)
            except Exception:  # noqa: BLE001
                pass
        name = a["name"]
        items.append(Item(
            id=f"music:{aid}", title=name, subtitle=", ".join(a["genres"][:2]),
            image=a.get("picture_xl") or a.get("picture_big"), url=a.get("link"),
            tags=a["genres"], text=f"{name}. {', '.join(a['genres'])} artist.", pop=float(fans),
            links={"spotify": f"https://open.spotify.com/search/{urllib.parse.quote(name)}",
                   "youtube": f"https://www.youtube.com/results?search_query={urllib.parse.quote(name)}"},
            related=rel, meta={"fans": fans},
        ))
    log.info("music: %d artists", len(items))
    return items
