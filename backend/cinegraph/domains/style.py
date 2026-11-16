"""Style space: curated design-led / independent labels (config/style_brands.yaml).

Each brand's image and description come from its own homepage's link-preview metadata
(og:image, og:description): one request per brand per build, like any link preview. If a site
doesn't answer, the brand keeps a text card and links still work.

Pieces (config/style_pieces.yaml) are iconic items with an approximate retail price; each is linked to
its brand in the taste graph, so liking a brand lifts its pieces and the reverse. Cards use the
brand's own preview image. Your own pieces,
Pinterest pins and Instagram saves are added in the app."""
from __future__ import annotations

import html
import logging
import re
import urllib.parse
from concurrent.futures import ThreadPoolExecutor
from importlib import resources

import httpx
import yaml

from .base import Item

NAME, LABEL = "brands", "Style"
log = logging.getLogger(__name__)
UA = "Mozilla/5.0 (compatible; CineGraph link preview; +https://github.com/Polluxgnr/cinegraph)"


def brands_config() -> list[dict]:
    return yaml.safe_load(resources.files("cinegraph").joinpath("config/style_brands.yaml").read_text("utf-8"))


def pieces_config() -> list[dict]:
    return yaml.safe_load(resources.files("cinegraph").joinpath("config/style_pieces.yaml").read_text("utf-8"))


def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")





def _meta(page: str, prop: str) -> str | None:
    for pat in (rf'<meta[^>]+(?:property|name)=["\']{prop}["\'][^>]+content=["\']([^"\']+)',
                rf'<meta[^>]+content=["\']([^"\']+)["\'][^>]+(?:property|name)=["\']{prop}["\']'):
        m = re.search(pat, page, re.I)
        if m:
            return html.unescape(m.group(1)).strip()
    return None


def preview(url: str) -> dict:
    try:
        r = httpx.get(url, headers={"User-Agent": UA, "Accept-Language": "en,fr"}, timeout=15, follow_redirects=True)
        page = r.text[:300_000]
    except httpx.HTTPError:
        return {}
    img = _meta(page, "og:image") or _meta(page, "twitter:image")
    if img and img.startswith("//"):
        img = "https:" + img
    elif img and img.startswith("/"):
        img = urllib.parse.urljoin(str(r.url), img)
    return {"image": img, "description": _meta(page, "og:description") or _meta(page, "description")}


def collect() -> list[Item]:
    cfg = brands_config()
    pieces = pieces_config()
    with ThreadPoolExecutor(8) as pool:
        previews = list(pool.map(lambda b: preview(b["url"]), cfg))

    by_brand: dict[str, list[dict]] = {}
    for p in pieces:
        by_brand.setdefault(p["brand"], []).append(p)
    items = []
    for b, p in zip(cfg, previews):
        name = b["name"]
        host = urllib.parse.urlparse(b["url"]).netloc
        q = urllib.parse.quote(name)
        own = by_brand.get(name, [])
        prices = sorted(p["price"] for p in own)
        items.append(Item(
            id=f"brands:{slug(name)}", title=name,
            subtitle=" · ".join([b.get("country", ""), ", ".join(b["tags"][:2])]).strip(" ·"),
            image=p.get("image") or f"https://www.google.com/s2/favicons?domain={host}&sz=256",
            url=b["url"], tags=b["tags"] + [b.get("country", "")],
            text=f"{name}. {', '.join(b['tags'])}. {b.get('country', '')}. {(p.get('description') or '')[:300]}",
            pop=0, links={"pinterest": f"https://www.pinterest.com/search/pins/?q={q}",
                          "instagram": f"https://www.instagram.com/explore/search/keyword/?q={q}",
                          "vinted": f"https://www.vinted.fr/catalog?search_text={q}"},
            meta={"description": p.get("description"), "kind": "brand",
                  **({"price": prices[len(prices) // 2], "price_approx": True} if prices else {})},
            related=[f"brands:piece:{slug(name)}-{slug(x['name'])}" for x in own],
        ))
    brand_item = {it.title: it for it in items}
    for p in pieces:
        b = brand_item[p["brand"]]
        title = f"{p['brand']} {p['name']}"
        q = urllib.parse.quote(title)
        items.append(Item(
            id=f"brands:piece:{slug(p['brand'])}-{slug(p['name'])}", title=title,
            subtitle=f"{p['category']} · {p['brand']}",
            image=b.image, url=b.url,
            tags=["piece", p["category"], *p.get("tags", []), *b.tags[:3]],
            text=f"{title}. {p['category']} by {p['brand']}. {', '.join(p.get('tags', []))}. {', '.join(b.tags)}.",
            pop=0, links={"shop": f"https://www.google.com/search?tbm=shop&q={q}",
                          "vinted": f"https://www.vinted.fr/catalog?search_text={q}",
                          "pinterest": f"https://www.pinterest.com/search/pins/?q={q}"},
            meta={"kind": "piece", "brand": p["brand"], "price": p["price"], "price_approx": True},
            related=[b.id],
        ))
    log.info("style: %d brands (%d with images), %d pieces", len(cfg),
             sum(1 for p in previews if p.get("image")), len(pieces))
    return items
