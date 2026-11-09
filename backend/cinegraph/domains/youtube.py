"""YouTube: documentaries, science and culture channels, via YouTube's official per-channel RSS feeds
(no API key, no scraping). Channels are curated in config/youtube_channels.yaml; add your own."""
from __future__ import annotations

import logging
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
        views = 0
        stats = group.find("media:community/media:statistics", NS) if group is not None else None
        if stats is not None:
            views = int(stats.get("views") or 0)
        out.append(Item(
            id=f"youtube:{vid}", title=title, subtitle=ch["name"],
            image=f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg",
            url=f"https://www.youtube.com/watch?v={vid}",
            tags=list(ch.get("tags", [])) + [ch.get("lang", "")],
            text=f"{title}. {ch['name']}. {' '.join(ch.get('tags', []))}. {desc[:600]}",
            date=(e.findtext("a:published", namespaces=NS) or "")[:10] or None,
            pop=float(views),
            meta={"channel": ch["name"], "channel_id": ch["id"], "lang": ch.get("lang"), "embed": vid},
        ))
    return out


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
    log.info("youtube: %d videos from %d channels", len(items), len(channels()))
    return items
