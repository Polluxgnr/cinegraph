"""Recipes from TheMealDB (free public API, photos included). Marmiton has no public API, so each
recipe gets a Marmiton search link, and Marmiton recipes you save land in your vault."""
from __future__ import annotations

import logging
import string
import urllib.parse

from .base import Http, Item

NAME, LABEL = "recipes", "Recipes"
log = logging.getLogger(__name__)
API = "https://www.themealdb.com/api/json/v1/1/search.php"


def to_item(m: dict) -> Item:
    ingredients = []
    for i in range(1, 21):
        ing = (m.get(f"strIngredient{i}") or "").strip()
        if ing:
            ingredients.append(f"{(m.get(f'strMeasure{i}') or '').strip()} {ing}".strip())
    tags = [t.strip().lower() for t in (m.get("strTags") or "").split(",") if t.strip()]
    tags += [x.lower() for x in (m.get("strCategory"), m.get("strArea")) if x]
    title = m["strMeal"]
    return Item(
        id=f"recipes:{m['idMeal']}", title=title,
        subtitle=" · ".join(x for x in (m.get("strArea"), m.get("strCategory")) if x),
        image=m.get("strMealThumb"), url=m.get("strSource") or f"https://www.themealdb.com/meal/{m['idMeal']}",
        tags=sorted(set(tags)),
        text=f"{title}. {m.get('strArea') or ''} {m.get('strCategory') or ''}. Ingredients: {', '.join(ingredients)}.",
        links={k: v for k, v in {
            "marmiton": f"https://www.marmiton.org/recettes/recherche.aspx?aqt={urllib.parse.quote(title)}",
            "video": m.get("strYoutube") or "",
        }.items() if v},
        meta={"ingredients": ingredients, "instructions": (m.get("strInstructions") or "")[:4000],
              "area": m.get("strArea"), "category": m.get("strCategory")},
    )


def collect() -> list[Item]:
    http = Http(min_interval=0.3)
    seen, items = set(), []
    for letter in string.ascii_lowercase:
        try:
            meals = http.get(API, f=letter).json().get("meals") or []
        except Exception as e:  # noqa: BLE001
            log.warning("themealdb %s failed: %s", letter, e)
            continue
        for m in meals:
            if m["idMeal"] not in seen:
                seen.add(m["idMeal"])
                items.append(to_item(m))
    log.info("recipes: %d", len(items))
    return items
