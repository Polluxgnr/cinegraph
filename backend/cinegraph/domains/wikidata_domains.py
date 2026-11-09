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
                meta={"coord": d.get("coord"), "country": country, "description": d.get("itemDescription")},
            ))
    log.info("places: %d", len(items))
    return items


# ------------------------------------------------------------------ cars
CARS_Q = """
SELECT ?item ?itemLabel ?itemDescription ?makerLabel ?img ?links ?start ?classLabel WHERE {
  { SELECT ?item ?links WHERE {
      ?item wdt:P31 wd:Q3231690 ; wikibase:sitelinks ?links . FILTER(?links > 12)
  } ORDER BY DESC(?links) LIMIT 700 }
  ?item wdt:P18 ?img .
  OPTIONAL { ?item wdt:P176 ?maker }
  OPTIONAL { ?item wdt:P571 ?start }
  OPTIONAL { ?item wdt:P279 ?class }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,fr". }
}"""


def cars() -> list[Item]:
    g = _group(_rows(CARS_Q), ("makerLabel", "classLabel"))
    items = []
    for q, d in g.items():
        label = d.get("itemLabel", q)
        if label == q:
            continue
        maker = ", ".join(m for m in d.get("makerLabel", [])[:2] if not m.startswith("Q"))
        classes = [c for c in d.get("classLabel", []) if not c.startswith("Q")][:3]
        year = (d.get("start") or "")[:4]
        items.append(Item(
            id=f"cars:{q}", title=label, subtitle=" · ".join(x for x in (maker, year) if x),
            image=commons_image(d.get("img")), url=f"https://en.wikipedia.org/wiki/Special:Search?search={label}",
            tags=classes + ([maker] if maker else []),
            text=f"{label}. {d.get('itemDescription', '')}. {maker}. {', '.join(classes)}.",
            date=f"{year}-01-01" if year.isdigit() else None, pop=float(d.get("links", 0)),
            links={"wikidata": f"https://www.wikidata.org/wiki/{q}"},
            meta={"maker": maker, "description": d.get("itemDescription")},
        ))
    log.info("cars: %d", len(items))
    return items


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
