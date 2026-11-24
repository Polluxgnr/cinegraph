"""Reddit through its official API (free for personal use).

Setup: https://www.reddit.com/prefs/apps -> "create another app" -> type "script".
Put the client id and secret in config.toml, or in REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET.
Without a key, use the "reddit_browser" source instead (reads Reddit in your logged-in browser).
"""
from __future__ import annotations

import os
import time

import httpx

from ..models import Comment, Document
from .base import Source, clip, iso_from_epoch


class Reddit(Source):
    name = "reddit"
    label = "Reddit"
    description = "Posts and comment threads via the official API"

    _token: str | None = None
    _token_exp: float = 0

    def _creds(self) -> tuple[str, str]:
        cid = self.cfg.get("client_id") or os.environ.get("REDDIT_CLIENT_ID", "")
        sec = self.cfg.get("client_secret") or os.environ.get("REDDIT_CLIENT_SECRET", "")
        return cid, sec

    def _ua(self) -> str:
        user = self.cfg.get("username", "unknown")
        return f"windows:agora-research:0.1 (by /u/{user})"

    def available(self):
        cid, sec = self._creds()
        if not (cid and sec):
            return False, "Needs a free Reddit app key (see README), or use 'Reddit (browser)'"
        return True, ""

    async def _auth(self, client: httpx.AsyncClient) -> str:
        if self._token and time.time() < self._token_exp - 60:
            return self._token
        cid, sec = self._creds()
        r = await client.post(
            "https://www.reddit.com/api/v1/access_token",
            auth=(cid, sec), data={"grant_type": "client_credentials"},
            headers={"User-Agent": self._ua()},
        )
        r.raise_for_status()
        data = r.json()
        Reddit._token = data["access_token"]
        Reddit._token_exp = time.time() + data.get("expires_in", 3600)
        return Reddit._token

    async def _get(self, path: str, params: dict) -> dict | list:
        async with httpx.AsyncClient(timeout=20) as client:
            token = await self._auth(client)
            r = await client.get(
                f"https://oauth.reddit.com{path}", params={**params, "raw_json": 1},
                headers={"Authorization": f"bearer {token}", "User-Agent": self._ua()},
            )
            r.raise_for_status()
            return r.json()

    async def search(self, query, limit):
        data = await self._get("/search", {"q": query, "limit": min(limit, 100), "sort": "relevance", "t": "all"})
        docs = []
        for child in data["data"]["children"]:
            p = child["data"]
            docs.append(Document(
                platform="reddit",
                url="https://www.reddit.com" + p["permalink"],
                title=p.get("title", ""),
                text=clip(p.get("selftext", ""), 6000),
                author=p.get("author", ""),
                date=iso_from_epoch(p.get("created_utc")),
                score=p.get("score"),
                num_comments=p.get("num_comments"),
                meta={"id": p["id"], "subreddit": p.get("subreddit_name_prefixed"), "link": p.get("url")},
            ))
        return docs

    async def enrich(self, doc, max_comments):
        pid = doc.meta.get("id")
        if not pid or not doc.num_comments:
            return doc
        data = await self._get(f"/comments/{pid}", {"limit": max_comments, "depth": 3, "sort": "top"})
        comments: list[Comment] = []

        def walk(children, depth):
            for c in children:
                if c.get("kind") != "t1" or len(comments) >= max_comments:
                    continue
                d = c["data"]
                comments.append(Comment(text=clip(d.get("body", ""), 1500), author=d.get("author", ""),
                                        score=d.get("score"), date=iso_from_epoch(d.get("created_utc")), depth=depth))
                replies = d.get("replies")
                if isinstance(replies, dict):
                    walk(replies["data"]["children"], depth + 1)

        walk(data[1]["data"]["children"], 0)
        doc.comments = comments
        return doc
