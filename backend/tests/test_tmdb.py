import asyncio
import gzip
import json

import httpx

from cinegraph.ingest.tmdb_client import TMDBClient
from cinegraph.ingest.tmdb_ingest import parse_details, parse_export

MOVIE = {
    "id": 680, "title": "Pulp Fiction", "original_title": "Pulp Fiction", "release_date": "1994-09-10",
    "runtime": 154, "overview": "...", "popularity": 80.1, "vote_average": 8.5, "vote_count": 28000,
    "original_language": "en", "genres": [{"id": 53, "name": "Thriller"}, {"id": 80, "name": "Crime"}],
    "production_countries": [{"iso_3166_1": "US"}], "poster_path": "/p.jpg", "imdb_id": "tt0110912",
    "credits": {
        "cast": [{"id": 8891, "name": "John Travolta", "character": "Vincent Vega", "order": 0}],
        "crew": [{"id": 138, "name": "Quentin Tarantino", "job": "Director"},
                 {"id": 138, "name": "Quentin Tarantino", "job": "Screenplay"},
                 {"id": 139, "name": "Roger Avary", "job": "Story"},
                 {"id": 1, "name": "Someone", "job": "Gaffer"}]},
    "keywords": {"keywords": [{"id": 1, "name": "nonlinear timeline"}, {"id": 2, "name": "dark comedy"}]},
    "external_ids": {"imdb_id": "tt0110912", "wikidata_id": "Q104123"},
    "watch/providers": {"results": {
        "FR": {"flatrate": [{"provider_id": 8, "provider_name": "Netflix", "logo_path": "/n.jpg"}],
               "rent": [{"provider_id": 2, "provider_name": "Apple TV", "logo_path": "/a.jpg"}]},
        "US": {"flatrate": [{"provider_id": 9, "provider_name": "Amazon Prime Video"}]}}},
    "alternative_titles": {"titles": [{"iso_3166_1": "FR", "title": "Pulp Fiction (VF)"}]},
    "images": {"backdrops": [{"file_path": "/b1.jpg"}]},
}

TV = {
    "id": 64464, "name": "Fauda", "original_name": "פאודה", "first_air_date": "2015-02-15",
    "episode_run_time": [42, 46], "number_of_seasons": 4, "genres": [{"name": "Drama"}, {"name": "Action & Adventure"}],
    "origin_country": ["IL"], "created_by": [{"id": 5, "name": "Lior Raz"}],
    "aggregate_credits": {"cast": [{"id": 5, "name": "Lior Raz", "roles": [{"character": "Doron"}], "order": 0}],
                          "crew": [{"id": 7, "name": "Rotem Shamir", "jobs": [{"job": "Director", "episode_count": 12}]},
                                   {"id": 8, "name": "Guest", "jobs": [{"job": "Director", "episode_count": 1}]}]},
    "keywords": {"results": [{"name": "undercover"}]},
    "external_ids": {"imdb_id": "tt4565380", "wikidata_id": "Q19867577"},
    "networks": [{"name": "yes"}],
}


def test_parse_movie():
    p = parse_details("movie", MOVIE)
    t = p["title"]
    assert (t["title"], t["year"], t["runtime"], t["wikidata_id"]) == ("Pulp Fiction", 1994, 154, "Q104123")
    assert t["genres"] == ["Thriller", "Crime"] and t["keywords"] == ["nonlinear timeline", "dark comedy"]
    roles = {(x["name"], x["role"]) for x in p["people"]}
    assert roles == {("John Travolta", "cast"), ("Quentin Tarantino", "director"), ("Quentin Tarantino", "writer"),
                     ("Roger Avary", "writer")}
    assert {(x["provider_name"], x["offer_type"]) for x in p["providers"]} == {("Netflix", "flatrate"),
                                                                              ("Apple TV", "rent")}
    assert "pulp fiction vf" in p["aliases"]


def test_parse_tv():
    p = parse_details("tv", TV)
    t = p["title"]
    assert (t["title"], t["year"], t["runtime"], t["number_of_seasons"]) == ("Fauda", 2015, 44, 4)
    assert {(x["name"], x["role"]) for x in p["people"]} == {("Lior Raz", "creator"), ("Lior Raz", "cast"),
                                                             ("Rotem Shamir", "director")}
    assert t["countries"] == ["IL"] and p["providers"] == []


def test_parse_export():
    raw = gzip.compress(b'{"adult":false,"id":1,"original_title":"A","popularity":1.5}\n'
                        b'{"id":2,"original_name":"B","popularity":0.1}\n')
    assert [r["id"] for r in parse_export(raw)] == [1, 2]


def test_client_retries_429_and_uses_bearer_token():
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        if len(calls) == 1:
            return httpx.Response(429, headers={"Retry-After": "0"})
        return httpx.Response(200, json={"id": 680})

    async def go():
        c = TMDBClient("eyJfake.jwt.token", rate=1000, transport=httpx.MockTransport(handler))
        try:
            return await c.details("movie", 680)
        finally:
            await c.close()

    assert asyncio.run(go()) == {"id": 680}
    assert len(calls) == 2
    assert calls[0].headers["Authorization"] == "Bearer eyJfake.jwt.token"
    assert "append_to_response" in str(calls[0].url) and "api_key" not in str(calls[0].url)


def test_client_404_is_none_and_v3_key_in_query():
    seen = []

    def handler(request):
        seen.append(str(request.url))
        return httpx.Response(404)

    async def go():
        c = TMDBClient("abc123", rate=1000, transport=httpx.MockTransport(handler))
        try:
            return await c.details("tv", 1)
        finally:
            await c.close()

    assert asyncio.run(go()) is None
    assert "api_key=abc123" in seen[0]


def test_rate_limit_spacing():
    import time

    async def go():
        c = TMDBClient("k", rate=20, transport=httpx.MockTransport(lambda r: httpx.Response(200, json={})))
        t0 = time.monotonic()
        await asyncio.gather(*(c.get("/x") for _ in range(40)))
        await c.close()
        return time.monotonic() - t0

    # 20 burst + 20 more at 20/s -> about one second
    assert asyncio.run(go()) >= 0.9
    json.dumps({})
