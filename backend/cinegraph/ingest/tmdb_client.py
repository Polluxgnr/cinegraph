"""Rate-limited, retrying async TMDB client."""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

import httpx

log = logging.getLogger(__name__)

API = "https://api.themoviedb.org/3"

MOVIE_APPEND = "credits,keywords,external_ids,images,watch/providers,alternative_titles"
TV_APPEND = "aggregate_credits,keywords,external_ids,images,watch/providers,alternative_titles"


class TMDBError(Exception):
    pass


class TokenBucket:
    """Simple async token bucket: `rate` requests per second, burst = rate."""

    def __init__(self, rate: float):
        self.rate = max(rate, 0.1)
        self.tokens = self.rate
        self.updated = time.monotonic()
        self.lock = asyncio.Lock()

    async def take(self) -> None:
        async with self.lock:
            while True:
                now = time.monotonic()
                self.tokens = min(self.rate, self.tokens + (now - self.updated) * self.rate)
                self.updated = now
                if self.tokens >= 1:
                    self.tokens -= 1
                    return
                await asyncio.sleep((1 - self.tokens) / self.rate)


class TMDBClient:
    def __init__(
        self,
        api_key: str,
        rate: float = 30.0,
        concurrency: int = 16,
        transport: httpx.AsyncBaseTransport | None = None,
        max_retries: int = 5,
    ):
        if not api_key:
            raise TMDBError(
                "TMDB_API_KEY is empty. Create a free key at "
                "https://www.themoviedb.org/settings/api and put it in .env"
            )
        headers = {"Accept": "application/json"}
        self._params: dict[str, str] = {}
        if api_key.startswith("eyJ"):  # v4 read-access token (JWT)
            headers["Authorization"] = f"Bearer {api_key}"
        else:
            self._params["api_key"] = api_key
        self.client = httpx.AsyncClient(
            base_url=API, headers=headers, timeout=30, transport=transport
        )
        self.bucket = TokenBucket(rate)
        self.sem = asyncio.Semaphore(concurrency)
        self.max_retries = max_retries

    async def close(self) -> None:
        await self.client.aclose()

    async def __aenter__(self) -> "TMDBClient":
        return self

    async def __aexit__(self, *exc: Any) -> None:
        await self.close()

    async def get(self, path: str, **params: Any) -> dict | None:
        """GET with rate limiting and retries. Returns None on 404."""
        q = {**self._params, **{k: v for k, v in params.items() if v is not None}}
        delay = 1.0
        for attempt in range(self.max_retries + 1):
            await self.bucket.take()
            async with self.sem:
                try:
                    r = await self.client.get(path, params=q)
                except (httpx.TransportError, httpx.TimeoutException) as e:
                    if attempt == self.max_retries:
                        raise TMDBError(f"{path}: {e}") from e
                    await asyncio.sleep(delay)
                    delay *= 2
                    continue
            if r.status_code == 404:
                return None
            if r.status_code == 401:
                raise TMDBError("TMDB rejected the API key (401). Check TMDB_API_KEY in .env")
            if r.status_code == 429 or r.status_code >= 500:
                if attempt == self.max_retries:
                    raise TMDBError(f"{path}: HTTP {r.status_code}")
                wait = float(r.headers.get("Retry-After", delay))
                log.debug("TMDB %s -> %s, retrying in %.1fs", path, r.status_code, wait)
                await asyncio.sleep(wait)
                delay *= 2
                continue
            r.raise_for_status()
            return r.json()
        return None

    async def details(self, kind: str, tmdb_id: int, language: str = "en-US") -> dict | None:
        if kind == "movie":
            return await self.get(f"/movie/{tmdb_id}", append_to_response=MOVIE_APPEND, language=language,
                                  include_image_language="en,fr,null")
        return await self.get(f"/tv/{tmdb_id}", append_to_response=TV_APPEND, language=language,
                              include_image_language="en,fr,null")

    async def search(self, kind: str, query: str, year: int | None = None) -> list[dict]:
        if kind == "movie":
            res = await self.get("/search/movie", query=query, year=year)
        else:
            res = await self.get("/search/tv", query=query, first_air_date_year=year)
        return (res or {}).get("results", [])

    async def find_imdb(self, imdb_id: str) -> dict:
        return await self.get(f"/find/{imdb_id}", external_source="imdb_id") or {}
