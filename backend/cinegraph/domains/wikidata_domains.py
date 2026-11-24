"""Places, cars and fashion brands from Wikidata (CC0) with Wikimedia Commons photos.
Popularity = number of Wikipedia language editions (sitelinks), a good open proxy for "well known"."""
from __future__ import annotations

import logging

from ..ingest.wikidata import Sparql, _qid, _val
from .base import Item, commons_image

log = logging.getLogger(__name__)


def _rows(query: str) -> list[dict]:
    return Sparql(min_interval=1.0).query(query, retries=2)


def _group(res: list[dict], multi: tuple[str, ...]) -> dict[str, dict]:
    """SPARQL returns one row per value combination: fold multi-valued vars into lists."""
    out: dict[str, dict] = {}
    for b in res:
        q = _qid(_val(b, "item"))
        d = out.setdefault(q, {"qid": q})
        for k, v in b.items():
            val = v["value"]
            if k in multi:
                d.setdefault(k, [])
                if val not in d[k]:
                    d[k].append(val)
            elif k not in d:
                d[k] = val
    return out


# ------------------------------------------------------------------ places
PLACE_TYPES = {
    "Q515": ("city", 70), "Q1200957": ("tourist destination", 25), "Q46169": ("national park", 25),
    "Q23442": ("island", 40), "Q8502": ("mountain", 40), "Q40080": ("beach", 8), "Q9259": ("World Heritage Site", 30),
    "Q570116": ("tourist attraction", 30), "Q35509": ("cave", 15), "Q34038": ("waterfall", 15),
}

# one query per place type keeps each under the endpoint's 60 s limit
PLACES_Q = """
SELECT ?item ?itemLabel ?itemDescription ?countryLabel ?img ?links ?voy ?coord WHERE {{
  {{ SELECT ?item ?links WHERE {{
      ?item wdt:P31 wd:{qid} ; wikibase:sitelinks ?links . FILTER(?links > {min_links})
  }} ORDER BY DESC(?links) LIMIT {limit} }}
  ?item wdt:P18 ?img .
  OPTIONAL {{ ?voy schema:about ?item ; schema:isPartOf <https://en.wikivoyage.org/> }}
  OPTIONAL {{ ?item wdt:P17 ?country }}
  OPTIONAL {{ ?item wdt:P625 ?coord }}
  SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en,fr". }}
}}"""


# French names, asked separately by id so the heavy per-type queries stay as light as before (a failure here only
# leaves the English names)
FR_Q = """
SELECT ?item ?frLabel ?frDesc WHERE {{
  VALUES ?item {{ {ids} }}
  OPTIONAL {{ ?item rdfs:label ?frLabel FILTER(LANG(?frLabel) = "fr") }}
  OPTIONAL {{ ?item schema:description ?frDesc FILTER(LANG(?frDesc) = "fr") }}
}}"""


def french_labels(qids: list[str], batch: int = 200) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for i in range(0, len(qids), batch):
        try:
            rows = _rows(FR_Q.format(ids=" ".join(f"wd:{q}" for q in qids[i:i + batch])))
        except Exception as e:  # noqa: BLE001
            log.warning("french labels %d-%d failed: %s", i, i + batch, e)
            continue
        for q, d in _group(rows, ()).items():
            out[q] = d
    return out


def places(limit_per_type: int = 150) -> list[Item]:
    items, seen = [], set()
    for qid, (type_label, min_links) in PLACE_TYPES.items():
        try:
            g = _group(_rows(PLACES_Q.format(qid=qid, min_links=min_links, limit=limit_per_type)), ("countryLabel",))
        except Exception as e:  # noqa: BLE001
            log.warning("places %s failed: %s", type_label, e)
            continue
        for q, d in g.items():
            label = d.get("itemLabel", q)
            if label == q or q in seen:
                continue
            seen.add(q)
            country = ", ".join(d.get("countryLabel", [])[:2])
            voy = d.get("voy")
            items.append(Item(
                id=f"places:{q}", title=label, subtitle=" · ".join(x for x in (country, type_label) if x),
                image=commons_image(d.get("img")),
                url=voy or f"https://en.wikivoyage.org/wiki/Special:Search?search={label.replace(' ', '%20')}",
                tags=[type_label] + d.get("countryLabel", [])[:2],
                text=f"{label}. {d.get('itemDescription', '')}. {type_label}. {country}.",
                pop=float(d.get("links", 0)),
                links={"wikidata": f"https://www.wikidata.org/wiki/{q}",
                       "maps": f"https://www.openstreetmap.org/search?query={label.replace(' ', '%20')}",
                       "pinterest": f"https://www.pinterest.com/search/pins/?q={label.replace(' ', '%20')}"},
                meta={"coord": d.get("coord"), "country": country, "description": d.get("itemDescription"),
                      },
            ))
    # every country, and every city of 100,000 people or more (Wikidata's "city" class misses Paris, Madrid...)
    for extra, what in ((countries, "countries"), (big_cities, "cities")):
        try:
            for it in extra():
                q = it.id.split(":", 1)[1]
                if q not in seen:
                    seen.add(q)
                    items.append(it)
        except Exception as e:  # noqa: BLE001 - keep what the per-type queries found
            log.warning("places %s failed: %s", what, e)
    # French name and description, shown when the interface is in French (London -> Londres)
    fr = french_labels([it.id.split(":", 1)[1] for it in items if not it.id.startswith("places:gn")])
    for it in items:
        d = fr.get(it.id.split(":", 1)[1], {})
        if d.get("frLabel") and d["frLabel"] != it.title:
            it.meta["fr"] = d["frLabel"]
        if d.get("frDesc"):
            it.meta["description_fr"] = d["frDesc"]
    log.info("places: %d (%d with a French name)", len(items), sum("fr" in it.meta for it in items))
    return items


def _place_item(q: str, label: str, kind: str, country: str, d: dict, pop: float, coord: str | None) -> Item:
    voy = d.get("voy")
    return Item(
        id=f"places:{q}", title=label, subtitle=" · ".join(x for x in (country, kind) if x),
        image=commons_image(d.get("img")),
        url=voy or f"https://en.wikivoyage.org/wiki/Special:Search?search={label.replace(' ', '%20')}",
        tags=[kind] + ([country] if country else []),
        text=f"{label}. {d.get('itemDescription') or d.get('desc') or ''}. {kind}. {country}.",
        pop=pop,
        links={"wikidata": f"https://www.wikidata.org/wiki/{q}" if not q.startswith("gn") else "",
               "maps": f"https://www.openstreetmap.org/search?query={label.replace(' ', '%20')}",
               "pinterest": f"https://www.pinterest.com/search/pins/?q={label.replace(' ', '%20')}"},
        meta={"coord": coord, "country": country, "description": d.get("itemDescription") or d.get("desc")},
    )


COUNTRIES_Q = """
SELECT ?item ?itemLabel ?itemDescription ?img ?links ?voy ?coord ?capitalLabel ?population WHERE {
  VALUES ?t { wd:Q6256 wd:Q3624078 }
  ?item wdt:P31 ?t ; wikibase:sitelinks ?links .
  FILTER NOT EXISTS { ?item wdt:P576 ?end }
  OPTIONAL { ?item wdt:P18 ?img }
  OPTIONAL { ?voy schema:about ?item ; schema:isPartOf <https://en.wikivoyage.org/> }
  OPTIONAL { ?item wdt:P625 ?coord }
  OPTIONAL { ?item wdt:P36 ?capital }
  OPTIONAL { ?item wdt:P1082 ?population }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}"""


def countries() -> list[Item]:
    out = []
    for q, d in _group(_rows(COUNTRIES_Q), ()).items():
        label = d.get("itemLabel", q)
        if label == q:
            continue
        it = _place_item(q, label, "country", "", d, float(d.get("links", 0)), d.get("coord"))
        it.tags = ["country"]
        it.meta.update(capital=d.get("capitalLabel"), population=int(float(d["population"])) if d.get("population") else None)
        out.append(it)
    log.info("countries: %d", len(out))
    return out


GEONAMES = "https://download.geonames.org/export/dump/"
# GeoNames id (P1566) -> the Wikidata item, for its photo, Wikivoyage page and fame (sitelinks)
GN_Q = """
SELECT ?item ?gn ?img ?links ?voy ?desc WHERE {{
  VALUES ?gn {{ {ids} }}
  ?item wdt:P1566 ?gn ; wikibase:sitelinks ?links .
  OPTIONAL {{ ?item wdt:P18 ?img }}
  OPTIONAL {{ ?voy schema:about ?item ; schema:isPartOf <https://en.wikivoyage.org/> }}
  OPTIONAL {{ ?item schema:description ?desc FILTER(LANG(?desc) = "en") }}
}}"""


NAME_Q = """
SELECT ?item ?l ?countryLabel ?img ?links ?voy ?desc WHERE {{
  VALUES ?l {{ {names} }}
  ?item rdfs:label ?l ; wdt:P17 ?country ; wdt:P1082 ?pop ; wikibase:sitelinks ?links .
  FILTER(?pop > 100000)
  OPTIONAL {{ ?item wdt:P18 ?img }}
  OPTIONAL {{ ?voy schema:about ?item ; schema:isPartOf <https://en.wikivoyage.org/> }}
  OPTIONAL {{ ?item schema:description ?desc FILTER(LANG(?desc) = "en") }}
  SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en". }}
}}"""


def _geonames(name: str, max_age_days: int = 60) -> bytes:
    """GeoNames dump file, kept in the data folder: the server sends ~10 KB/s, so it's fetched every two months."""
    import time

    import httpx

    from ..config import get_settings

    p = get_settings().data_dir / "geonames" / name
    if p.exists() and time.time() - p.stat().st_mtime < max_age_days * 86400:
        return p.read_bytes()
    try:
        raw = httpx.get(GEONAMES + name, timeout=httpx.Timeout(30, read=300), follow_redirects=True).raise_for_status().content
    except Exception:
        if p.exists():  # an old copy beats no cities
            return p.read_bytes()
        raise
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(raw)
    return raw


def big_cities(min_pop: int = 100_000, batch: int = 250) -> list[Item]:
    """GeoNames (CC BY 4.0): every city of `min_pop` people or more and every capital, enriched from Wikidata."""
    import io
    import math
    import zipfile

    names = {}
    for line in _geonames("countryInfo.txt").decode("utf-8").splitlines():
        if line and not line.startswith("#"):
            c = line.split("\t")
            names[c[0]] = c[4]
    raw = _geonames("cities15000.zip")
    rows = []
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        for line in z.read("cities15000.txt").decode("utf-8").splitlines():
            c = line.split("\t")
            pop = int(c[14] or 0)
            if pop >= min_pop or c[7] == "PPLC":
                rows.append((c[0], c[1], c[4], c[5], names.get(c[8], c[8]), pop, c[7] == "PPLC"))
    wd: dict[str, dict] = {}
    for i in range(0, len(rows), batch):
        try:
            res = _rows(GN_Q.format(ids=" ".join(f'"{r[0]}"' for r in rows[i:i + batch])))
        except Exception as e:  # noqa: BLE001 - those cities keep no photo
            log.warning("cities wikidata %d-%d failed: %s", i, i + batch, e)
            continue
        for q, d in _group(res, ()).items():
            g = d.get("gn")
            if g and (g not in wd or float(d.get("links", 0)) > float(wd[g].get("links", 0))):
                wd[g] = d
    # a big city whose GeoNames id points to a minor item (Madrid -> a district): look it up by its name instead
    weak = [r for r in rows if (r[5] >= 300_000 or r[6]) and float(wd.get(r[0], {}).get("links", 0)) < 80]
    for i in range(0, len(weak), 120):
        part = weak[i:i + 120]
        try:
            res = _rows(NAME_Q.format(names=" ".join('"%s"@en' % r[1].replace('"', "") for r in part)))
        except Exception as e:  # noqa: BLE001
            log.warning("cities by name %d failed: %s", i, e)
            continue
        best: dict[tuple[str, str], dict] = {}
        for q, d in _group(res, ()).items():
            k = (d.get("l", ""), d.get("countryLabel", ""))
            if k not in best or float(d.get("links", 0)) > float(best[k].get("links", 0)):
                best[k] = d
        for r in part:
            d = best.get((r[1], r[4]))
            if d and float(d.get("links", 0)) > float(wd.get(r[0], {}).get("links", 0)):
                wd[r[0]] = d
    out, used = [], set()
    for gid, name, lat, lon, country, pop, capital in rows:
        d = wd.get(gid, {})
        q = d.get("qid") or f"gn{gid}"
        if q in used:  # two GeoNames entries for one city
            continue
        used.add(q)
        fame = float(d.get("links", 0)) or 10 * math.log10(max(pop, 10))
        it = _place_item(q, name, "city", country, d, fame, f"Point({lon} {lat})")
        it.meta.update(population=pop, capital=capital or None, geonames=gid)
        if capital:
            it.tags.append("capital")
        out.append(it)
    log.info("cities: %d from GeoNames (%d matched on Wikidata, %d with a photo)", len(out), len(wd), sum(1 for i in out if i.image))
    return out


# ------------------------------------------------------------------ cars (dream garage)
DREAM_MAKES = [
    "Porsche", "Ferrari", "Lamborghini", "McLaren", "Aston Martin", "Bugatti", "Pagani", "Koenigsegg", "Lotus Cars",
    "Alpine", "Maserati", "Bentley", "Rolls-Royce Motor Cars", "Rimac Automobili", "Lancia", "Alfa Romeo", "Jaguar Cars",
    "Shelby American", "DeLorean Motor Company", "De Tomaso", "Spyker Cars", "Noble Automotive", "Ariel Motor Company",
    "Caterham Cars", "Morgan Motor Company", "Polestar", "Lucid Motors", "Singer Vehicle Design", "Hennessey Special Vehicles",
    "Brabus", "Mercedes-AMG", "BMW M", "Audi Sport", "Gordon Murray Automotive", "W Motors", "Zenvo", "Lexus", "Acura",
]
# iconic models from mainstream makers that still belong in a dream garage
DREAM_MODELS = [
    "Nissan GT-R", "Nissan Skyline GT-R", "Toyota Supra", "Toyota 2000GT", "Honda NSX", "Mazda RX-7", "Mazda MX-5",
    "Mitsubishi Lancer Evolution", "Subaru Impreza WRX STI", "Ford GT", "Ford Mustang", "Ford GT40", "Chevrolet Corvette",
    "Dodge Viper", "Dodge Challenger", "Mercedes-Benz 300 SL", "Mercedes-Benz G-Class", "Mercedes-Benz SLS AMG",
    "BMW M3", "BMW M1", "BMW i8", "BMW Z8", "Audi R8", "Audi Quattro", "Volkswagen Golf GTI", "Peugeot 205 GTi",
    "Renault 5 Turbo", "Renault Clio V6", "Land Rover Defender", "Toyota Land Cruiser", "Jeep Wrangler",
    "Tesla Roadster", "Tesla Model S", "Citroën DS", "Citroën SM", "Fiat 500", "Mini", "Volkswagen Beetle",
    "Jaguar E-Type", "Lancia Stratos", "Lancia Delta Integrale", "Ferrari F40", "Lamborghini Countach", "Porsche 911",
]
# sports car, supercar, grand tourer, muscle car, hypercar, roadster, luxury car, rally car
DREAM_CLASSES = "wd:Q274586 wd:Q815679 wd:Q1067089 wd:Q1414386 wd:Q3043012 wd:Q1132617 wd:Q1849137 wd:Q2302136"

CARS_Q = """
SELECT ?item ?itemLabel ?itemDescription ?makerLabel ?img ?links ?start ?classLabel WHERE {{
  {{ SELECT DISTINCT ?item ?links WHERE {{
      {selector}
      ?item wikibase:sitelinks ?links . FILTER(?links > 5)
  }} ORDER BY DESC(?links) LIMIT {limit} }}
  ?item wdt:P18 ?img .
  OPTIONAL {{ ?item wdt:P176 ?maker }}
  OPTIONAL {{ ?item wdt:P571 ?start }}
  OPTIONAL {{ ?item wdt:P279 ?class }}
  SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en,fr". }}
}}"""

# three cheap selectors instead of one UNION the endpoint can't finish in 60 s
CAR_SELECTORS = [
    ("makes", "VALUES ?mkl {{ {makes} }} ?mk rdfs:label ?mkl . ?item wdt:P176 ?mk ; wdt:P31 wd:Q3231690 .", 700),
    ("models", "VALUES ?il {{ {models} }} ?item rdfs:label ?il ; wdt:P31 wd:Q3231690 .", 200),
    ("classes", "VALUES ?cls {{ {classes} }} ?item wdt:P279 ?cls ; wdt:P31 wd:Q3231690 .", 400),
]


def cars() -> list[Item]:
    fill = {"makes": " ".join(f'"{m}"@en' for m in DREAM_MAKES),
            "models": " ".join(f'"{m}"@en' for m in DREAM_MODELS), "classes": DREAM_CLASSES}
    g: dict[str, dict] = {}
    for name, sel, limit in CAR_SELECTORS:
        try:
            part = _group(_rows(CARS_Q.format(selector=sel.format(**fill), limit=limit)), ("makerLabel", "classLabel"))
            for k, v in part.items():
                g.setdefault(k, v)
        except Exception as e:  # noqa: BLE001
            log.warning("cars selector %s failed: %s", name, e)
    items = []
    for q_, d in g.items():
        label = d.get("itemLabel", q_)
        if label == q_:
            continue
        maker = ", ".join(m for m in d.get("makerLabel", [])[:2] if not m.startswith("Q"))
        classes = [c for c in d.get("classLabel", []) if not c.startswith("Q")][:3]
        year = (d.get("start") or "")[:4]
        items.append(Item(
            id=f"cars:{q_}", title=label, subtitle=" · ".join(x for x in (maker, year) if x),
            image=commons_image(d.get("img")), url=f"https://en.wikipedia.org/wiki/Special:Search?search={label.replace(' ', '%20')}",
            tags=classes + ([maker] if maker else []),
            text=f"{label}. {d.get('itemDescription', '')}. {maker}. {', '.join(classes)}.",
            date=f"{year}-01-01" if year.isdigit() else None, pop=float(d.get("links", 0)),
            links={"wikidata": f"https://www.wikidata.org/wiki/{q_}",
                   "pinterest": f"https://www.pinterest.com/search/pins/?q={label.replace(' ', '%20')}"},
            meta={"maker": maker, "description": d.get("itemDescription")},
        ))
    priced = apply_car_prices(items)
    specced = apply_car_specs(items)
    log.info("cars (dream garage): %d (%d with a price, %d with specs)", len(items), priced, specced)
    return items


def _wiki_image(page: str) -> str | None:
    """Lead image of an English Wikipedia page (REST summary; open data, one call per spec'd car)."""
    import json
    import urllib.parse
    import urllib.request

    try:
        req = urllib.request.Request(f"https://en.wikipedia.org/api/rest_v1/page/summary/{urllib.parse.quote(page)}",
                                     headers={"User-Agent": "CineGraph/1.0 (weekly catalogue build)"})
        with urllib.request.urlopen(req, timeout=20) as r:
            j = json.load(r)
        return (j.get("originalimage") or j.get("thumbnail") or {}).get("source")
    except Exception:  # noqa: BLE001 - a missing photo is fine
        return None


def apply_car_specs(items: list[Item]) -> int:
    """config/car_specs.yaml: engine, power, seats... on the matching car, and the cars Wikidata lacks added."""
    from importlib import resources

    import yaml

    cfg = yaml.safe_load(resources.files("cinegraph").joinpath("config/car_specs.yaml").read_text("utf-8"))
    by_title = {_fold(it.title): it for it in items}
    n = 0
    for title, sp in (cfg.get("cars") or {}).items():
        it = by_title.get(_fold(title))
        if it is None:
            slug = _fold(title).replace(" ", "-").replace("(", "").replace(")", "").replace("/", "-")
            wiki = sp.get("wiki")
            it = Item(id=f"cars:spec-{slug}", title=title, subtitle=" · ".join(str(x) for x in (sp.get("maker"), sp.get("year")) if x),
                      image=_wiki_image(wiki) if wiki else None,
                      url=f"https://en.wikipedia.org/wiki/{wiki}" if wiki else None,
                      tags=[t for t in (sp.get("body"), sp.get("maker")) if t],
                      date=f"{sp['year']}-01-01" if sp.get("year") else None, pop=30.0,
                      links={"pinterest": f"https://www.pinterest.com/search/pins/?q={title.replace(' ', '%20')}"},
                      meta={"maker": sp.get("maker"), "description": sp.get("body")})
            items.append(it)
        specs = {k: sp[k] for k in ("engine", "cyl", "litres", "hp", "nm", "seats", "drive", "gearbox", "zero100", "vmax", "kg", "body") if sp.get(k) is not None}
        it.meta.update(specs)
        if sp.get("price"):
            it.meta.update(price=int(sp["price"][0]), price_approx=True, price_kind=sp["price"][1])
        it.text = f"{it.text} {sp.get('engine', '')} {sp.get('hp', '')} hp {sp.get('body', '')} {sp.get('drive', '')}".strip()
        n += 1
    return n


def refresh_kept_cars(items: list[dict]) -> int:
    """When last week's car export is kept (Wikidata timed out), still bring the curated specs up to date on it."""
    from importlib import resources

    import yaml

    cfg = yaml.safe_load(resources.files("cinegraph").joinpath("config/car_specs.yaml").read_text("utf-8"))
    by_title = {_fold(it["title"]): it for it in items}
    n = 0
    for title, sp in (cfg.get("cars") or {}).items():
        it = by_title.get(_fold(title))
        if it is None:
            continue
        meta = it.setdefault("meta", {})
        meta.update({k: sp[k] for k in ("engine", "cyl", "litres", "hp", "nm", "seats", "drive", "gearbox", "zero100", "vmax", "kg", "body") if sp.get(k) is not None})
        if sp.get("price"):
            meta.update(price=int(sp["price"][0]), price_approx=True, price_kind=sp["price"][1])
        n += 1
    return n


def _fold(s: str) -> str:
    import unicodedata
    return "".join(c for c in unicodedata.normalize("NFKD", s.lower()) if not unicodedata.combining(c)).strip()


def car_price(title: str, maker: str, year: str | None) -> tuple[int, str] | None:
    """(euros, "new" | "market" | "from") from config/car_prices.yaml, or None."""
    from importlib import resources

    import yaml

    global _PRICES
    if "_PRICES" not in globals():
        cfg = yaml.safe_load(resources.files("cinegraph").joinpath("config/car_prices.yaml").read_text("utf-8"))
        _PRICES = ({_fold(k): (int(v[0]), v[1]) for k, v in cfg["models"].items()},
                   {_fold(k): int(v) for k, v in cfg["makes_from"].items()})
    models, makes = _PRICES
    t = _fold(title)
    if t in models:
        return models[t]
    if year and year.isdigit() and int(year) >= 2015:
        for mk, eur in makes.items():
            if _fold(maker).startswith(mk) or t.startswith(mk):
                return eur, "from"
    return None


def apply_car_prices(items: list[Item]) -> int:
    n = 0
    for it in items:
        year = (it.date or "")[:4] or None
        p = car_price(it.title, it.meta.get("maker", ""), year)
        if p:
            it.meta.update(price=p[0], price_approx=True, price_kind=p[1])
            n += 1
    return n


# ------------------------------------------------------------------ brands
BRANDS_Q = """
SELECT ?item ?itemLabel ?itemDescription ?countryLabel ?logo ?img ?links ?site ?indLabel WHERE {
  { SELECT DISTINCT ?item ?links WHERE {
      { ?item wdt:P31 wd:Q1618899 } UNION { ?item wdt:P31 wd:Q3661311 } UNION { ?item wdt:P31 wd:Q76213285 }
      UNION { ?item wdt:P452 wd:Q11828862 } UNION { ?item wdt:P452 wd:Q3231404 }
      ?item wikibase:sitelinks ?links . FILTER(?links > 6)
  } ORDER BY DESC(?links) LIMIT 700 }
  OPTIONAL { ?item wdt:P154 ?logo }
  OPTIONAL { ?item wdt:P18 ?img }
  OPTIONAL { ?item wdt:P17 ?country }
  OPTIONAL { ?item wdt:P856 ?site }
  OPTIONAL { ?item wdt:P452 ?ind }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,fr". }
}"""


GENERIC_BRANDS = {"fashion", "clothing", "textile", "retail", "fashion house", "fast fashion"}


def brands() -> list[Item]:
    g = _group(_rows(BRANDS_Q), ("indLabel",))
    items = []
    for q, d in g.items():
        label = d.get("itemLabel", q)
        img = d.get("img") or d.get("logo")
        if label == q or not img or label.lower() in GENERIC_BRANDS:
            continue
        inds = [i for i in d.get("indLabel", []) if not i.startswith("Q")][:3]
        items.append(Item(
            id=f"brands:{q}", title=label, subtitle=d.get("countryLabel", ""),
            image=commons_image(img), url=d.get("site"),
            tags=inds + ([d["countryLabel"]] if d.get("countryLabel") else []),
            text=f"{label}. {d.get('itemDescription', '')}. {', '.join(inds)}.", pop=float(d.get("links", 0)),
            links={"wikidata": f"https://www.wikidata.org/wiki/{q}",
                   "pinterest": f"https://www.pinterest.com/search/pins/?q={label.replace(' ', '%20')}"},
            meta={"description": d.get("itemDescription"), "logo": commons_image(d.get("logo"), 200)},
        ))
    log.info("brands: %d", len(items))
    return items
