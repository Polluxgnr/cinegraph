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
    # the brands' own shops: their current pieces (photo, price, category), browsable and saveable in the app
    shop_items = shop_pieces(cfg, brand_item)
    items.extend(shop_items)
    log.info("style: %d brands (%d with images), %d curated pieces, %d pieces from the brands' shops", len(cfg),
             sum(1 for p in previews if p.get("image")), len(pieces), len(shop_items))
    return items


# ------------------------------------------------------------------ the brands' own shops
CATEGORY = [  # shop product types -> the app's categories
    ("sneakers", r"sneaker|trainer|shoe|boot|slide|mule|loafer|footwear|chaussure|zapatilla"),
    ("outerwear", r"jacket|coat|parka|puffer|anorak|gilet|vest|overshirt|bomber|blouson|veste|manteau|chaqueta"),
    ("tops", r"t-?shirt|tee|shirt|hoodie|sweat|crew|knit|sweater|jumper|cardigan|polo|top|longsleeve|chemise|pull|sudadera|camiseta"),
    ("pants", r"pant|trouser|jean|denim|short|jogger|cargo|chino|pantalon|pantal"),
    ("bags", r"bag|tote|backpack|pouch|wallet|sac|bolso"),
    ("accessories", r"cap|hat|beanie|scarf|glove|sock|belt|jewel|ring|necklace|chain|sunglass|eyewear|keychain|accessor|casquette|bonnet"),
    ("fragrance", r"fragrance|parfum|perfume|eau de|candle|bougie"),
]


def _category(*texts: str) -> str:
    t = " ".join(x for x in texts if x).lower()
    for name, pat in CATEGORY:
        if re.search(pat, t):
            return name
    return "other"


def _allowed(base: str, path: str) -> bool:
    """robots.txt says we may fetch this path (no robots.txt = allowed)."""
    import urllib.robotparser

    rp = urllib.robotparser.RobotFileParser()
    try:
        r = httpx.get(urllib.parse.urljoin(base, "/robots.txt"), headers={"User-Agent": UA}, timeout=15, follow_redirects=True)
        if r.status_code >= 400:
            return True
        rp.parse(r.text.splitlines())
        return rp.can_fetch(UA, urllib.parse.urljoin(base, path))
    except Exception:  # noqa: BLE001
        return True


def shop_products(url: str, limit: int = 40) -> list[dict]:
    """A Shopify shop's public product list (/products.json, newest first); [] for other shops or on refusal."""
    p = urllib.parse.urlparse(url)
    base = f"{p.scheme}://{p.netloc}"
    if not _allowed(base, "/products.json"):
        return []
    try:
        r = httpx.get(f"{base}/products.json", params={"limit": limit}, headers={"User-Agent": UA, "Accept": "application/json"},
                      timeout=20, follow_redirects=True)
        if r.status_code != 200 or "json" not in r.headers.get("content-type", ""):
            return []
        cur = None
        try:  # the shop's currency, when it publishes it
            cur = httpx.get(f"{base}/meta.json", headers={"User-Agent": UA}, timeout=10).json().get("currency")
        except Exception:  # noqa: BLE001
            pass
        out = []
        for x in r.json().get("products", [])[:limit]:
            v = (x.get("variants") or [{}])[0]
            img = (x.get("images") or [{}])[0].get("src")
            if not img:
                continue
            out.append({"handle": x["handle"], "title": x["title"], "type": x.get("product_type") or "",
                        "tags": x.get("tags") if isinstance(x.get("tags"), list) else str(x.get("tags") or "").split(", "),
                        "price": float(v.get("price") or 0) or None, "currency": cur, "image": img,
                        "url": f"{base}/products/{x['handle']}", "date": (x.get("published_at") or "")[:10] or None})
        return out
    except Exception as e:  # noqa: BLE001
        log.info("shop %s: %s", base, e)
        return []


def shop_pieces(cfg: list[dict], brand_item: dict[str, Item]) -> list[Item]:
    """Current pieces from every brand shop that publishes its product list; a few seconds apart, politely."""
    import time

    items: list[Item] = []
    for b in cfg:
        if b.get("shop") is False or "vinted" in b["url"]:
            continue
        prods = shop_products(b["url"])
        time.sleep(1.5)
        brand = brand_item.get(b["name"])
        for x in prods:
            cat = _category(x["type"], x["title"], " ".join(x["tags"][:6]))
            title = x["title"] if b["name"].lower() in x["title"].lower() else f"{b['name']} {x['title']}"
            items.append(Item(
                id=f"brands:shop:{slug(b['name'])}-{slug(x['handle'])[:60]}", title=title,
                subtitle=f"{cat} · {b['name']}", image=x["image"], url=x["url"],
                tags=["piece", cat, *b["tags"][:3]], date=x["date"],
                text=f"{title}. {x['type']}. {cat} by {b['name']}. {', '.join(b['tags'])}.",
                pop=0, links={"vinted": f"https://www.vinted.fr/catalog?search_text={urllib.parse.quote(title)}"},
                meta={"kind": "piece", "brand": b["name"], "category": cat, "from_shop": True,
                      **({"price": x["price"], "currency": x["currency"] or "EUR"} if x["price"] else {})},
                related=[brand.id] if brand else [],
            ))
    return items
