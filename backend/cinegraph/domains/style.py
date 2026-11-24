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
    # Wikidata (CC0) and Wikimedia Commons (free licences): photos for what has none, more brands, their famous pieces
    try:
        n_more, n_wd_pieces = enrich_from_wikidata(items, brand_item)
    except Exception as e:  # noqa: BLE001 - the curated catalogue stands on its own
        log.warning("style wikidata failed: %s", e)
        n_more = n_wd_pieces = 0
    n_photos = commons_piece_photos([it for it in items if it.meta.get("kind") == "piece" and not it.meta.get("photo")])
    # the brands' own shops: their current pieces (photo, price, category), browsable and saveable in the app
    shop_items = shop_pieces(cfg, brand_item)
    items.extend(shop_items)
    log.info("style: %d brands (%d with images), %d curated pieces (%d with a photo), %d more brands and %d pieces from Wikidata, "
             "%d pieces from the brands' shops", len(cfg), sum(1 for p in previews if p.get("image")), len(pieces), n_photos,
             n_more, n_wd_pieces, len(shop_items))
    return items


# ------------------------------------------------------------------ Wikidata and Commons
WD_UA = "CineGraph/1.0 (personal taste app; https://github.com/Polluxgnr/cinegraph)"
FASHION_INDUSTRIES = "wd:Q12684 wd:Q11828862 wd:Q5915560 wd:Q107601662 wd:Q3231404"
WD_BRANDS_Q = """
SELECT ?item ?itemLabel ?itemDescription ?img ?logo ?links ?countryLabel ?site WHERE {
  { VALUES ?ind { %s } ?item wdt:P452 ?ind } UNION { ?item wdt:P31 wd:Q1618899 }
  ?item wikibase:sitelinks ?links . FILTER(?links >= 5)
  OPTIONAL { ?item wdt:P18 ?img } OPTIONAL { ?item wdt:P154 ?logo }
  OPTIONAL { ?item wdt:P17 ?country } OPTIONAL { ?item wdt:P856 ?site }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}""" % FASHION_INDUSTRIES
# the curated brands, found by name among companies and labels
WD_NAMES_Q = """
SELECT ?item ?l ?itemDescription ?img ?logo ?links WHERE {{
  VALUES ?l {{ {names} }}
  ?item rdfs:label ?l ; wikibase:sitelinks ?links .
  FILTER EXISTS {{ {{ ?item wdt:P452 ?ind }} UNION {{ ?item wdt:P31/wdt:P279* wd:Q431289 }} UNION {{ ?item wdt:P31/wdt:P279* wd:Q4830453 }} }}
  OPTIONAL {{ ?item wdt:P18 ?img }} OPTIONAL {{ ?item wdt:P154 ?logo }}
  SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en". }}
}}"""
# what a brand makes or puts its name on, with a photo
WD_PIECES_Q = """
SELECT ?item ?itemLabel ?itemDescription ?brand ?img ?classLabel ?links WHERE {{
  VALUES ?brand {{ {ids} }}
  {{ ?item wdt:P1716 ?brand }} UNION {{ ?item wdt:P176 ?brand }}
  ?item wdt:P18 ?img ; wikibase:sitelinks ?links .
  OPTIONAL {{ ?item wdt:P31 ?class }}
  SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en". }}
}}"""
NOT_A_PIECE = re.compile(r"human|ball|trophy|award|organi[sz]ation|company|business|store|shop|building|event|tournament|team|advertis|campaign|software|app\b|video game|film|\bcar\b"
                         r"|automobile|racing|formula|vehicle|device|tracker|electronic|fashion label|clothing line|subsidiary|fashion house", re.I)
# retailers, holdings and groups: not labels you dress in
NOT_A_LABEL = re.compile(r"holding|conglomerate|department store|retailer|retail (company|chain)|e-commerce|online shop|investment"
                         r"|wholesale|multinational corporation|group of companies", re.I)
COMPANY_SUFFIX = re.compile(r",?\s+(Inc\.?|B\.V\.|plc|SE|AG|S\.p\.A\.|S\.A\.|Ltd\.?|GmbH|Co\.|Corporation|Group)$")
PIECE_KIND = [("sneakers", r"shoe|sneaker|boot|footwear|sandal|slipper|trainer"), ("bags", r"bag|handbag|backpack|purse"),
              ("outerwear", r"jacket|coat|parka|anorak"), ("pants", r"jeans|trousers|pants"), ("accessories", r"watch|sunglasses|eyewear|hat|belt|jewel|wallet"),
              ("fragrance", r"perfume|fragrance|eau de"), ("tops", r"shirt|sweater|polo|garment|clothing|dress")]


def _commons(name: str | None, width: int = 600) -> str | None:
    from .base import commons_image
    return commons_image(name, width)


def _fold(s: str) -> str:
    import unicodedata
    return "".join(c for c in unicodedata.normalize("NFKD", s.lower()) if not unicodedata.combining(c)).strip()


def enrich_from_wikidata(items: list[Item], brand_item: dict[str, Item]) -> tuple[int, int]:
    """Curated brands without a photo get Wikidata's; well-known labels not in the list join; their pieces with a photo too."""
    from ..ingest.wikidata import _qid, _val
    from .wikidata_domains import _group, _rows

    qid_of: dict[str, Item] = {}
    names = list(brand_item)
    for i in range(0, len(names), 80):
        part = names[i:i + 80]
        try:
            res = _rows(WD_NAMES_Q.format(names=" ".join('"%s"@en' % n.replace('"', "") for n in part)))
        except Exception as e:  # noqa: BLE001
            log.info("style names %d: %s", i, e)
            continue
        best: dict[str, dict] = {}
        for b in res:
            l, q = _val(b, "l"), _qid(_val(b, "item"))
            if l and (l not in best or float(_val(b, "links") or 0) > float(best[l].get("links") or 0)):
                best[l] = {"qid": q, **{k: v["value"] for k, v in b.items()}}
        for l, d in best.items():
            it = brand_item.get(l)
            if not it:
                continue
            qid_of[d["qid"]] = it
            if "favicons" in (it.image or "") and (d.get("img") or d.get("logo")):
                it.image = _commons(d.get("img") or d.get("logo"))
            if not it.meta.get("description") and d.get("itemDescription"):
                it.meta["description"] = d["itemDescription"]
            it.links["wikidata"] = f"https://www.wikidata.org/wiki/{d['qid']}"
    # more labels
    known = {_fold(n) for n in brand_item}
    more = 0
    for q, d in _group(_rows(WD_BRANDS_Q), ()).items():
        label = COMPANY_SUFFIX.sub("", d.get("itemLabel", q)).strip()
        img = d.get("img") or d.get("logo")
        generic = label == label.lower() and label in {"fashion", "clothing", "footwear", "apparel"}
        if label == q or not img or generic or _fold(label) in known or NOT_A_LABEL.search(d.get("itemDescription", "")):
            continue
        known.add(_fold(label))
        country = d.get("countryLabel", "")
        it = Item(
            id=f"brands:{slug(label)}", title=label, subtitle=" · ".join(x for x in (country, "label") if x),
            image=_commons(img), url=d.get("site") or f"https://www.wikidata.org/wiki/{q}",
            tags=["label", *([country] if country else [])],
            text=f"{label}. {d.get('itemDescription', '')}. fashion label. {country}.", pop=float(d.get("links", 0)),
            links={"wikidata": f"https://www.wikidata.org/wiki/{q}", "pinterest": f"https://www.pinterest.com/search/pins/?q={urllib.parse.quote(label)}",
                   "vinted": f"https://www.vinted.fr/catalog?search_text={urllib.parse.quote(label)}"},
            meta={"description": d.get("itemDescription"), "kind": "brand", "from_wikidata": True},
        )
        items.append(it)
        brand_item[label] = it
        qid_of[q] = it
        more += 1
    # their famous pieces
    pieces = 0
    ids = list(qid_of)
    seen: set[str] = set()
    have = {it.id for it in items}
    for i in range(0, len(ids), 60):
        try:
            res = _rows(WD_PIECES_Q.format(ids=" ".join(f"wd:{q}" for q in ids[i:i + 60])))
        except Exception as e:  # noqa: BLE001
            log.info("style pieces %d: %s", i, e)
            continue
        for q, d in _group(res, ("classLabel",)).items():
            label, classes = d.get("itemLabel", q), " ".join(d.get("classLabel", []))
            brand = qid_of.get(_qid(d.get("brand", "")))
            if q in seen or label == q or not brand or NOT_A_PIECE.search(f"{classes} {d.get('itemDescription', '')}"):
                continue
            seen.add(q)
            kind = next((k for k, pat in PIECE_KIND if re.search(pat, f"{classes} {d.get('itemDescription', '')} {label}", re.I)), "other")
            pid = f"brands:piece:{slug(brand.title)}-{slug(label)}"
            if pid in have:
                continue
            have.add(pid)
            title = label if _fold(brand.title.split()[0]) in _fold(label) else f"{brand.title} {label}"
            qs = urllib.parse.quote(title)
            items.append(Item(
                id=f"brands:piece:{slug(brand.title)}-{slug(label)}", title=title, subtitle=f"{kind} · {brand.title}",
                image=_commons(d.get("img")), url=f"https://www.wikidata.org/wiki/{q}",
                tags=["piece", kind, *brand.tags[:3]], pop=float(d.get("links", 0)),
                text=f"{title}. {d.get('itemDescription', '')}. {kind} by {brand.title}. {', '.join(brand.tags)}.",
                links={"wikidata": f"https://www.wikidata.org/wiki/{q}", "shop": f"https://www.google.com/search?tbm=shop&q={qs}",
                       "vinted": f"https://www.vinted.fr/catalog?search_text={qs}", "pinterest": f"https://www.pinterest.com/search/pins/?q={qs}"},
                meta={"kind": "piece", "brand": brand.title, "category": kind, "photo": True, "description": d.get("itemDescription")},
                related=[brand.id],
            ))
            brand.related.append(f"brands:piece:{slug(brand.title)}-{slug(label)}")
            pieces += 1
    return more, pieces


def commons_piece_photos(pieces: list[Item]) -> int:
    """A Wikimedia Commons photo for a curated piece, only when the file is plainly of it (brand and model in its name)."""
    import time

    n = 0
    for it in pieces:
        brand = it.meta.get("brand", "")
        model = _fold(it.title[len(brand):] if it.title.startswith(brand) else it.title)
        words = [w for w in re.findall(r"[a-z0-9]{2,}", model) if w not in {"the", "and", "of", "jacket", "shirt", "coat", "bag", "sneaker", "sneakers", "boot", "boots"}]
        if not words:
            continue
        try:
            r = httpx.get("https://commons.wikimedia.org/w/api.php", params={
                "action": "query", "format": "json", "generator": "search", "gsrnamespace": 6, "gsrlimit": 5,
                "gsrsearch": f"{brand} {model} filetype:bitmap", "prop": "imageinfo", "iiprop": "url", "iiurlwidth": 600,
            }, headers={"User-Agent": WD_UA}, timeout=20)
            pages = sorted(((r.json().get("query") or {}).get("pages") or {}).values(), key=lambda p: p.get("index", 99))
        except Exception:  # noqa: BLE001
            continue
        finally:
            time.sleep(0.4)
        bw = [w for w in re.findall(r"[a-z0-9]{2,}", _fold(brand))][:1]
        for p in pages:
            t = _fold(p.get("title", ""))
            if all(w in t for w in bw) and sum(w in t for w in words) >= max(1, (len(words) + 1) // 2):
                info = (p.get("imageinfo") or [{}])[0]
                if info.get("thumburl"):
                    it.image = info["thumburl"]
                    it.meta["photo"] = True
                    it.links.setdefault("commons", info.get("descriptionurl", ""))
                    n += 1
                    break
    return n


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
