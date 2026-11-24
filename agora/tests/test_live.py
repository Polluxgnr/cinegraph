"""End-to-end against the real internet with the stand-in model. Run: pytest -m live"""
import pytest

from agora.models import SearchRequest
from agora.pipeline import clarify, run_search
from fake_llm import install

pytestmark = pytest.mark.live


async def test_full_run_open_sources(monkeypatch):
    fake = install(monkeypatch)
    q = await clarify("cliff diving spots near marseille")
    assert len(q["questions"]) == 2

    events = [e async for e in run_search(SearchRequest(
        question="cliff diving spots near marseille", mode="quick", sources=["hackernews", "youtube", "web"]))]
    types = [e["type"] for e in events]
    assert types[-1] == "done", events[-3:]
    srcs = next(e for e in events if e["type"] == "sources")["items"]
    assert len(srcs) >= 5
    assert any(s["comments"] for s in srcs), "expected comments read from at least one source"
    ans = next(e for e in events if e["type"] == "answer")["answer"]
    assert ans["format"] == "places"
    assert all("lat" in p for p in ans["places"]), ans["places"]
    print({e["name"]: (e["status"], e.get("count")) for e in events if e["type"] == "source"}, ans["stats"])
