"""Fast, offline tests for the logic that doesn't need the network or a model."""
import json

import pytest

from agora.llm import extract_json, strip_think
from agora.models import Comment, Document
from agora.pipeline import build_context, format_doc
from agora.rank import diversify, rank, terms
from agora.sources import all_sources
from agora.sources.local import LocalImports


def test_extract_json_handles_model_mess():
    assert extract_json('Sure! ```json\n{"a": 1}\n``` hope that helps') == {"a": 1}
    assert extract_json('<think>hmm {"no": 1}</think>{"b": "x}y"}') == {"b": "x}y"}
    assert extract_json('prefix {"c": {"d": [1, 2]}} suffix') == {"c": {"d": [1, 2]}}
    with pytest.raises(ValueError):
        extract_json("no json here")


def test_strip_think():
    assert strip_think("<think>a\nb</think>answer") == "answer"


def test_terms_drop_stopwords():
    assert terms("What are the best cliff diving spots in Marseille?") == ["cliff", "diving", "spots", "marseille"]


def test_rank_dedups_and_prefers_relevant():
    docs = [
        Document(platform="reddit", url="https://x/1", title="Cooking pasta"),
        Document(platform="reddit", url="https://x/2", title="Cliff diving Marseille spots", score=50),
        Document(platform="web", url="https://x/2/", title="dup"),
    ]
    out = rank(docs, "cliff diving marseille")
    assert [d.url for d in out] == ["https://x/2", "https://x/1"]


def test_diversify_round_robins_platforms():
    docs = [Document(platform="a", url=f"a{i}") for i in range(5)] + [Document(platform="b", url="b0")]
    assert [d.platform for d in diversify(docs, 3)] == ["a", "b", "a"]


def test_context_respects_budget_and_numbers_sources():
    docs = [Document(platform="reddit", url=f"https://r/{i}", title=f"t{i}", text="x" * 5000,
                     comments=[Comment(text="c" * 300, score=5)] * 30) for i in range(10)]
    ctx, kept = build_context(docs, 20_000)
    assert ctx.startswith("[1] reddit")
    assert len(ctx) <= 20_000 + 2000
    assert 1 <= len(kept) <= 10


def test_format_doc_marks_page_text():
    d = Document(platform="tiktok", url="u", title="t", text="post then comments", meta={"page_text": True})
    assert "comments/replies/reviews as shown" in format_doc(1, d, 2000)


def test_registry_finds_all_platforms():
    names = set(all_sources())
    assert {"reddit", "hackernews", "youtube", "web", "tiktok", "instagram", "x", "gmaps", "reddit_browser", "local"} <= names


async def test_local_imports_discord_export(tmp_path, monkeypatch):
    export = {"guild": {"name": "Rail Travellers"}, "channel": {"name": "china"},
              "messages": [{"timestamp": "2025-03-01T10:00:00", "author": {"name": "li"},
                            "content": f"msg {i} about something"} for i in range(30)]
              + [{"timestamp": "2025-03-02T10:00:00", "author": {"name": "max"},
                  "content": "Book the Beijing Moscow train early, the 12306 app needs a passport"}]}
    (tmp_path / "export.json").write_text(json.dumps(export), encoding="utf-8")
    src = LocalImports()
    monkeypatch.setattr(src, "folder", lambda: tmp_path)
    hits = await src.search("beijing train passport", 5)
    assert hits and "12306" in hits[0].text
    assert hits[0].title.startswith("Rail Travellers / #china")


async def test_chain_falls_back_to_next_model():
    from agora.llm import LLM, ChainLLM, LLMError

    class Broken(LLM):
        async def chat(self, *a, **k):
            raise LLMError("rate limited")

    class Garbled(LLM):
        async def chat(self, *a, **k):
            return "not json at all"

    class Good(LLM):
        async def chat(self, *a, **k):
            return '{"ok": true}'

    chain = ChainLLM([Broken("a", {}), Garbled("b", {}), Good("c", {"context_chars": 1000})])
    assert await chain.chat_json("s", "u") == {"ok": True}
    assert chain.used == ["c"] and chain.context_chars == 1000
