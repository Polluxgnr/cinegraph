"""YouTube videos and their top comments via yt-dlp (no API key)."""
from __future__ import annotations

import asyncio

from ..models import Comment, Document
from .base import Source, clip, iso_from_epoch


def _ydl(opts: dict):
    import yt_dlp
    return yt_dlp.YoutubeDL({"quiet": True, "no_warnings": True, "skip_download": True, **opts})


class YouTube(Source):
    name = "youtube"
    label = "YouTube"
    description = "Videos, descriptions and top comments"

    async def search(self, query, limit):
        def run():
            with _ydl({"extract_flat": True}) as y:
                return y.extract_info(f"ytsearch{min(limit, 20)}:{query}", download=False)

        info = await asyncio.to_thread(run)
        docs = []
        for e in info.get("entries") or []:
            if not e.get("id"):
                continue
            docs.append(Document(
                platform="youtube", kind="video",
                url=f"https://www.youtube.com/watch?v={e['id']}",
                title=e.get("title") or "",
                author=e.get("channel") or e.get("uploader") or "",
                score=e.get("view_count"),
                meta={"id": e["id"], "duration": e.get("duration"), "score_label": "views"},
            ))
        return docs

    async def enrich(self, doc, max_comments):
        n = str(max_comments)

        def run():
            opts = {"getcomments": True,
                    "extractor_args": {"youtube": {"max_comments": [n, n, "0", "0"], "comment_sort": ["top"]}}}
            with _ydl(opts) as y:
                return y.extract_info(doc.url, download=False)

        info = await asyncio.to_thread(run)
        doc.text = clip(info.get("description") or "", 4000)
        up = info.get("upload_date")
        doc.date = f"{up[:4]}-{up[4:6]}-{up[6:]}" if up else None
        doc.num_comments = info.get("comment_count")
        doc.meta["likes"] = info.get("like_count")
        doc.comments = [
            Comment(text=clip(c.get("text", ""), 1200), author=c.get("author", ""),
                    score=c.get("like_count"), date=iso_from_epoch(c.get("timestamp")))
            for c in (info.get("comments") or [])[:max_comments]
        ]
        return doc
