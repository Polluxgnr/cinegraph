"""YouTube: documentaries, science and culture channels, via YouTube's official per-channel RSS feeds
(no scraping). Channels are curated in config/youtube_channels.yaml; add your own.

The feeds give views and likes. With a YouTube Data API key (env YOUTUBE_API_KEY, free quota is plenty:
one call per 50 videos) each video also gets its length, like and comment counts."""
from __future__ import annotations

import logging
import os
import re
import xml.etree.ElementTree as ET
from importlib import resources

import yaml

from .base import Http, Item

NAME, LABEL = "youtube", "Videos & docs"
log = logging.getLogger(__name__)

NS = {"a": "http://www.w3.org/2005/Atom", "yt": "http://www.youtube.com/xml/schemas/2015",
      "media": "http://search.yahoo.com/mrss/"}


def channels() -> list[dict]:
    return yaml.safe_load(resources.files("cinegraph").joinpath("config/youtube_channels.yaml").read_text("utf-8"))


def parse_feed(xml: bytes | str, ch: dict) -> list[Item]:
    root = ET.fromstring(xml)
    out = []
    for e in root.findall("a:entry", NS):
        vid = e.findtext("yt:videoId", namespaces=NS)
        title = e.findtext("a:title", namespaces=NS) or ""
        link = (e.find("a:link", NS).get("href") if e.find("a:link", NS) is not None else "") or ""
        if not vid or "#shorts" in title.lower() or "/shorts/" in link:
            continue  # vertical Shorts aren't the long-form content we want
        group = e.find("media:group", NS)
        desc = (group.findtext("media:description", namespaces=NS) if group is not None else "") or ""
        views = likes = 0
        community = group.find("media:community", NS) if group is not None else None
        if community is not None:
            stats = community.find("media:statistics", NS)
            rating = community.find("media:starRating", NS)
            views = int(stats.get("views") or 0) if stats is not None else 0
            likes = int(rating.get("count") or 0) if rating is not None else 0  # the feed's "ratings" are likes
        out.append(Item(
            id=f"youtube:{vid}", title=title, subtitle=ch["name"],
            image=f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg",
            url=f"https://www.youtube.com/watch?v={vid}",
            tags=list(ch.get("tags", [])) + [ch.get("lang", "")],
            text=f"{title}. {ch['name']}. {' '.join(ch.get('tags', []))}. {desc[:600]}",
            date=(e.findtext("a:published", namespaces=NS) or "")[:10] or None,
            pop=float(views),
            meta={"channel": ch["name"], "channel_id": ch["id"], "lang": ch.get("lang"), "embed": vid,
                  "views": views, "likes": likes},
        ))
    return out


def iso_minutes(d: str) -> int | None:
    """ISO 8601 duration (PT1H2M3S) -> whole minutes, at least 1."""
    m = re.fullmatch(r"P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", d or "")
    if not m:
        return None
    days, h, mi, s = (int(x or 0) for x in m.groups())
    return max(1, round(days * 1440 + h * 60 + mi + s / 60))


def enrich(items: list[Item], key: str, http: Http) -> None:
    """Length, likes and comments from the Data API (videos.list, 50 ids per call)."""
    by_id = {it.meta["embed"]: it for it in items}
    ids = list(by_id)
    for i in range(0, len(ids), 50):
        try:
            r = http.get("https://www.googleapis.com/youtube/v3/videos", part="contentDetails,statistics",
                         id=",".join(ids[i:i + 50]), key=key)
            r.raise_for_status()
        except Exception as e:  # noqa: BLE001
            log.warning("youtube api: %s", e)
            return
        for v in r.json().get("items", []):
            it = by_id.get(v["id"])
            if not it:
                continue
            st = v.get("statistics", {})
            minutes = iso_minutes(v.get("contentDetails", {}).get("duration", ""))
            if minutes:
                it.meta["minutes"] = minutes
            for src, dst in (("viewCount", "views"), ("likeCount", "likes"), ("commentCount", "comments")):
                if st.get(src) is not None:
                    it.meta[dst] = int(st[src])


def collect() -> list[Item]:
    http = Http(min_interval=0.3)
    items: list[Item] = []
    for ch in channels():
        try:
            r = http.get("https://www.youtube.com/feeds/videos.xml", channel_id=ch["id"])
            r.raise_for_status()
            items += parse_feed(r.content, ch)
        except Exception as e:  # noqa: BLE001 - one dead channel shouldn't stop the build
            log.warning("youtube channel %s failed: %s", ch["name"], e)
    if key := os.environ.get("YOUTUBE_API_KEY"):
        enrich(items, key, http)
    # Shorts sometimes slip through the feed filter: anything under 2 minutes isn't a documentary
    items = [it for it in items if it.meta.get("minutes", 99) >= 2]
    log.info("youtube: %d videos from %d channels (%d with length)", len(items), len(channels()),
             sum(1 for it in items if "minutes" in it.meta))
    return items
