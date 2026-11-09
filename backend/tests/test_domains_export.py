"""Domain collectors and the static exporter (no network: fixtures only)."""
import numpy as np

from cinegraph.domains.base import commons_image
from cinegraph.domains.recipes import to_item
from cinegraph.domains.youtube import parse_feed
from cinegraph.export_static import quantize, reaction_chips

FEED = b"""<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
 <entry><yt:videoId>abc123</yt:videoId><title>Les abeilles | ARTE Reportage</title>
  <published>2026-11-01T10:00:00+00:00</published>
  <media:group><media:description>Un documentaire.</media:description>
   <media:community><media:statistics views="12345"/></media:community></media:group></entry>
 <entry><yt:videoId>short1</yt:videoId><title>Quick one #shorts</title><published>2026-11-02T10:00:00+00:00</published></entry>
 <entry><yt:videoId>short2</yt:videoId><title>Untagged short</title><link rel="alternate" href="https://www.youtube.com/shorts/short2"/></entry>
</feed>"""


def test_youtube_feed_parsing_skips_shorts():
    items = parse_feed(FEED, {"id": "UCx", "name": "ARTE", "lang": "fr", "tags": ["documentary"]})
    assert [i.id for i in items] == ["youtube:abc123"]
    v = items[0]
    assert v.image == "https://i.ytimg.com/vi/abc123/hqdefault.jpg"
    assert v.date == "2026-11-01" and v.pop == 12345 and v.meta["embed"] == "abc123"
    assert "documentary" in v.tags


def test_recipe_item_has_marmiton_search_link_and_ingredients():
    it = to_item({"idMeal": "1", "strMeal": "Boeuf Bourguignon", "strCategory": "Beef", "strArea": "French",
                  "strMealThumb": "https://x/y.jpg", "strTags": "Stew,Wine", "strIngredient1": "Beef",
                  "strMeasure1": "1kg", "strIngredient2": "", "strInstructions": "Cook slowly."})
    assert it.id == "recipes:1" and it.subtitle == "French · Beef"
    assert it.links["marmiton"].endswith("aqt=Boeuf%20Bourguignon")
    assert it.meta["ingredients"] == ["1kg Beef"]
    assert {"stew", "wine", "beef", "french"} <= set(it.tags)


def test_commons_image_url():
    assert commons_image("http://commons.wikimedia.org/wiki/Special:FilePath/Eiffel%20Tower.jpg") == \
        "https://commons.wikimedia.org/wiki/Special:FilePath/Eiffel%20Tower.jpg?width=600"
    assert commons_image(None) is None


def test_int8_quantisation_keeps_cosines():
    rng = np.random.default_rng(0)
    m = rng.normal(size=(50, 384)).astype(np.float32)
    q, s = quantize(m)
    back = q.astype(np.float32) * s[:, None]
    cos = lambda a, b: (a @ b) / np.linalg.norm(a) / np.linalg.norm(b)  # noqa: E731
    errs = [abs(cos(m[i], m[j]) - cos(back[i], back[j])) for i in range(10) for j in range(10)]
    assert max(errs) < 0.01 and q.dtype == np.int8


def test_reaction_chips_follow_the_title():
    long_film = {"kind": "movie", "runtime": 175, "keywords": ["plot twist"], "genres": ["Thriller"], "extra": {}}
    assert reaction_chips(long_film)[:2] == ["Too long", "Saw the twist coming"]
    sitcom = {"kind": "tv", "number_of_seasons": 9, "keywords": [], "genres": ["Comedy"], "extra": {}}
    assert "Dropped it midway" in reaction_chips(sitcom) and "Not funny" in reaction_chips(sitcom)
    reviewed = {"kind": "movie", "extra": {"review": {"chips": ["Gorgeous but empty"]}}}
    assert reaction_chips(reviewed) == ["Gorgeous but empty"]
