"""The general browser reader against a neutral public site, with a throwaway profile."""
import pytest

from agora.config import load_config
from agora.sources.browser import BrowserManager, BrowserSource

pytestmark = pytest.mark.live


class HNBrowser(BrowserSource):
    name = ""  # not registered as a real source
    search_url = "https://hn.algolia.com/?q={q}"
    link_pattern = r"^/item\?id=\d+$"
    strip_query = False

    def available(self):
        return True, ""


async def test_browser_reader(tmp_path, monkeypatch):
    cfg = load_config()["browser"]
    monkeypatch.setitem(cfg, "headless", True)
    monkeypatch.setitem(cfg, "profile_dir", str(tmp_path / "profile"))
    monkeypatch.setitem(cfg, "pace_seconds", 1.5)
    src = HNBrowser()
    try:
        docs = await src.search("rust", 3)
        assert docs, "no post links collected from the search page"
        doc = await src.enrich(docs[0], 20)
        assert len(doc.text) > 500 and doc.meta["page_text"]
        print(docs[0].url, len(doc.text), repr(doc.text[:150]))
    finally:
        await BrowserManager.close()
