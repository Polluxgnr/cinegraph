"""Hacker News via the free Algolia API. Strong for tech, security and startup opinions."""
from __future__ import annotations

import httpx

from ..models import Comment, Document
from .base import USER_AGENT, Source, clip, html_to_text


class HackerNews(Source):
    name = "hackernews"
    label = "Hacker News"
    description = "Tech and security discussions with full comment trees"

    async def search(self, query, limit):
        async with httpx.AsyncClient(timeout=20, headers={"User-Agent": USER_AGENT}) as c:
            r = await c.get("https://hn.algolia.com/api/v1/search",
                            params={"query": query, "tags": "story", "hitsPerPage": min(limit, 50)})
            r.raise_for_status()
        docs = []
        for h in r.json().get("hits", []):
            docs.append(Document(
                platform="hackernews",
                url=f"https://news.ycombinator.com/item?id={h['objectID']}",
                title=h.get("title") or "",
                text=clip(html_to_text(h.get("story_text")), 4000),
                author=h.get("author", ""),
                date=(h.get("created_at") or "")[:10] or None,
                score=h.get("points"),
                num_comments=h.get("num_comments"),
                meta={"id": h["objectID"], "link": h.get("url")},
            ))
        return docs

    async def enrich(self, doc, max_comments):
        if not doc.num_comments:
            return doc
        async with httpx.AsyncClient(timeout=30, headers={"User-Agent": USER_AGENT}) as c:
            r = await c.get(f"https://hn.algolia.com/api/v1/items/{doc.meta['id']}")
            r.raise_for_status()
        comments: list[Comment] = []

        def walk(nodes, depth):
            for n in nodes:
                if len(comments) >= max_comments:
                    return
                if n.get("text"):
                    comments.append(Comment(text=clip(html_to_text(n["text"]), 1500), author=n.get("author") or "",
                                            date=(n.get("created_at") or "")[:10] or None, depth=depth))
                walk(n.get("children") or [], depth + 1)

        walk(r.json().get("children") or [], 0)
        doc.comments = comments
        return doc
