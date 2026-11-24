"""The general reader: platforms that only show their content to a logged-in person are read
through a real Chrome window signed in as you, one page at a time at human pace.

Each site only declares where its search page is and what a post link looks like. Reading
a post is the same for every site: open it, let comments load, take the visible text. The
model then works out what is a post, a comment or a reply, so a site redesign doesn't break
anything, and a new site is ~10 lines (see SITES below or subclass BrowserSource).
"""
from __future__ import annotations

import asyncio
import re
from pathlib import Path
from typing import Any
from urllib.parse import quote_plus, urljoin

from ..config import ROOT, load_config
from ..models import Document
from .base import Source, clip


class BrowserManager:
    """One persistent Chrome profile shared by all browser sources, one page load at a time."""

    _pw: Any = None
    _ctx: Any = None
    lock = asyncio.Lock()

    @classmethod
    def cfg(cls) -> dict[str, Any]:
        return load_config()["browser"]

    @classmethod
    def profile_dir(cls) -> Path:
        return ROOT / cls.cfg().get("profile_dir", "data/browser-profile")

    @classmethod
    async def context(cls, headless: bool | None = None):
        if cls._ctx is None:
            from playwright.async_api import async_playwright
            cfg = cls.cfg()
            cls._pw = await async_playwright().start()
            cls.profile_dir().mkdir(parents=True, exist_ok=True)
            cls._ctx = await cls._pw.chromium.launch_persistent_context(
                str(cls.profile_dir()),
                channel=cfg.get("channel") or None,
                headless=cfg.get("headless", False) if headless is None else headless,
                viewport={"width": 1280, "height": 900},
            )
        return cls._ctx

    @classmethod
    async def close(cls):
        if cls._ctx is not None:
            await cls._ctx.close()
            await cls._pw.stop()
            cls._ctx = cls._pw = None

    @classmethod
    def pace(cls) -> float:
        return float(cls.cfg().get("pace_seconds", 2.5))


class BrowserSource(Source):
    group = "browser"
    search_url = ""                     # with {q}
    link_pattern = r""                  # regex matched against each link's path
    login_url = ""
    scrolls = 3                         # scrolls on the search page to load more results
    comment_scrolls = 2                 # scrolls on a post page to load comments
    doc_kind = "post"                   # post | video | place
    strip_query = True                  # drop ?tracking=params from post links

    def available(self):
        if not BrowserManager.profile_dir().exists():
            return False, "Run `python -m agora login` once and sign in"
        return True, ""

    async def _open(self, url: str):
        ctx = await BrowserManager.context()
        page = await ctx.new_page()
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=45_000)
        except Exception:
            await page.close()
            raise
        await asyncio.sleep(BrowserManager.pace())
        return page

    async def _scroll(self, page, times: int):
        for _ in range(times):
            await page.mouse.wheel(0, 2500)
            await asyncio.sleep(BrowserManager.pace() * 0.6)

    async def search(self, query, limit):
        limit = min(limit, int(BrowserManager.cfg().get("max_pages", 12)))
        async with BrowserManager.lock:
            page = await self._open(self.search_url.format(q=quote_plus(query)))
            try:
                await self._scroll(page, self.scrolls)
                docs = await self.collect(page, query)
            finally:
                await page.close()
        return docs[:limit]

    async def collect(self, page, query) -> list[Document]:
        """Turn the search results page into Documents. Default: every link matching link_pattern."""
        links = await page.eval_on_selector_all(
            "a[href]", "els => els.map(a => [a.getAttribute('href'), (a.innerText || a.getAttribute('aria-label') || '').trim()])")
        seen, docs = set(), []
        pat = re.compile(self.link_pattern)
        for href, label in links:
            url = urljoin(page.url, href).split("#")[0]
            if self.strip_query:
                url = url.split("?")[0].rstrip("/")
            path = re.sub(r"^https?://[^/]+", "", url)
            if not pat.search(path) or url in seen:
                continue
            seen.add(url)
            docs.append(Document(platform=self.name, kind=self.doc_kind, url=url,
                                 title=clip(label.replace("\n", " "), 200), meta={"via_browser": True}))
        return docs

    async def enrich(self, doc, max_comments):
        async with BrowserManager.lock:
            page = await self._open(doc.url)
            try:
                await self.before_read(page)
                await self._scroll(page, self.comment_scrolls + max_comments // 40)
                text = await page.inner_text("body")
                doc.title = doc.title or await page.title()
                self.after_read(doc, page.url)
            finally:
                await page.close()
        doc.text = clip(re.sub(r"\n{3,}", "\n\n", text), 12_000)
        doc.meta["page_text"] = True  # comments are inside the text, the model separates them
        return doc

    async def before_read(self, page) -> None:
        """Hook: click "show comments", open a reviews tab, etc."""

    def after_read(self, doc: Document, final_url: str) -> None:
        """Hook: pull extra facts from the final URL (e.g. map coordinates)."""


class TikTok(BrowserSource):
    name, label = "tiktok", "TikTok"
    description = "Videos, captions and comments (logged-in browser)"
    search_url = "https://www.tiktok.com/search?q={q}"
    link_pattern = r"^/@[^/]+/video/\d+$"
    login_url = "https://www.tiktok.com/login"
    doc_kind = "video"


class Instagram(BrowserSource):
    name, label = "instagram", "Instagram"
    description = "Posts, reels, captions and comments (logged-in browser)"
    search_url = "https://www.instagram.com/explore/search/keyword/?q={q}"
    link_pattern = r"/(p|reel)/[\w-]+$"
    login_url = "https://www.instagram.com/accounts/login/"


class X(BrowserSource):
    name, label = "x", "X / Twitter"
    description = "Posts and replies (logged-in browser)"
    search_url = "https://x.com/search?q={q}&src=typed_query"
    link_pattern = r"^/[^/]+/status/\d+$"
    login_url = "https://x.com/i/flow/login"


class RedditBrowser(BrowserSource):
    name, label = "reddit_browser", "Reddit (browser)"
    description = "Reddit without an API key, read in your browser"
    search_url = "https://www.reddit.com/search/?q={q}"
    link_pattern = r"^/r/[^/]+/comments/[a-z0-9]+/[^/]+$"
    login_url = "https://www.reddit.com/login/"


_COORDS = re.compile(r"!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)")
_AT = re.compile(r"@(-?\d+\.\d+),(-?\d+\.\d+)")
_REVIEWS = re.compile(r"review|avis|reseñas|bewertungen|recensioni|avaliações", re.I)


class GoogleMaps(BrowserSource):
    name, label = "gmaps", "Google Maps"
    description = "Places, ratings and reviews (browser)"
    search_url = "https://www.google.com/maps/search/{q}"
    link_pattern = r"^/maps/place/"
    login_url = "https://accounts.google.com/"
    scrolls = 2
    comment_scrolls = 3

    def available(self):
        return True, ""  # works without logging in

    async def collect(self, page, query):
        if "/maps/place/" in page.url:  # Maps jumped straight to a single place
            return [Document(platform=self.name, kind="place", url=page.url.split("?")[0],
                             title=await page.title(), meta={"via_browser": True})]
        docs = await super().collect(page, query)
        for d in docs:
            d.kind = "place"
        return docs

    async def before_read(self, page):
        try:
            tab = page.get_by_role("tab", name=_REVIEWS).first
            if await tab.count():
                await tab.click(timeout=5000)
                await asyncio.sleep(BrowserManager.pace())
                feed = page.locator("div[role=main] div[tabindex='-1']").last
                for _ in range(3):
                    await feed.hover(timeout=3000)
                    await page.mouse.wheel(0, 3000)
                    await asyncio.sleep(1.2)
        except Exception:
            pass  # reviews tab is best-effort; the overview text still has rating and top reviews

    def after_read(self, doc, final_url):
        m = _COORDS.search(final_url) or _AT.search(final_url)
        if m:
            doc.geo = (float(m.group(1)), float(m.group(2)))


async def login(sites: list[str] | None = None) -> None:
    """Open the browser profile on each site's login page so you can sign in once."""
    from .base import all_sources
    targets = [s for s in all_sources().values()
               if isinstance(s, BrowserSource) and s.login_url and (not sites or s.name in sites)]
    ctx = await BrowserManager.context(headless=False)
    for s in targets:
        page = await ctx.new_page()
        await page.goto(s.login_url)
    print(f"Sign in on the {len(targets)} tabs that opened ({', '.join(s.label for s in targets)}).")
    print("Close the browser window when you're done; your sessions are saved in the profile.")
    closed = asyncio.Event()
    ctx.on("close", lambda *_: closed.set())
    await closed.wait()
    BrowserManager._ctx = None
    await BrowserManager._pw.stop()
    BrowserManager._pw = None
