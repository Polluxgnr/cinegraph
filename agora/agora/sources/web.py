"""The open web: search results, then the article text of each page.
This is where the facts baseline comes from (official pages, guides, blogs, forums)."""
from __future__ import annotations

import asyncio

import httpx

from ..models import Document
from .base import USER_AGENT, Source, clip


class Web(Source):
    name = "web"
    label = "Web"
    description = "Search engine results, forums, blogs and official pages"

    async def search(self, query, limit):
        from ddgs import DDGS

        def run():
            kw = {"region": self.cfg["region"]} if self.cfg.get("region") else {}
            return DDGS(timeout=int(self.cfg.get("timeout", 20))).text(query, max_results=min(limit, 25), **kw)

        try:
            results = await asyncio.to_thread(run)
        except Exception:  # one search engine timed out or refused: ddgs tries others on the retry
            await asyncio.sleep(1)
            results = await asyncio.to_thread(run)
        return [
            Document(platform="web", kind="page", url=r["href"], title=r.get("title", ""),
                     text=r.get("body", ""), meta={"snippet_only": True})
            for r in results or [] if r.get("href")
        ]

    async def enrich(self, doc, max_comments):
        import trafilatura

        async with httpx.AsyncClient(timeout=15, follow_redirects=True, headers={"User-Agent": USER_AGENT}) as c:
            r = await c.get(doc.url)
        if r.status_code >= 400 or "html" not in r.headers.get("content-type", ""):
            return doc  # keep the search snippet
        extracted = await asyncio.to_thread(
            trafilatura.bare_extraction, r.text, url=doc.url, include_comments=True, with_metadata=True)
        if extracted:
            data = extracted if isinstance(extracted, dict) else extracted.as_dict()
            body = data.get("text") or ""
            if data.get("comments"):
                body += "\n\nComments on the page:\n" + data["comments"]
            if body:
                doc.text = clip(body, 8000)
                doc.meta.pop("snippet_only", None)
            doc.date = data.get("date") or doc.date
            doc.author = data.get("author") or doc.author
            doc.meta["site"] = data.get("sitename")
        return doc
