"""Shared data shapes. Every source returns Documents; everything downstream reads them."""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass
class Comment:
    text: str
    author: str = ""
    score: int | None = None
    date: str | None = None  # ISO 8601
    depth: int = 0


@dataclass
class Document:
    platform: str            # "reddit", "youtube", "tiktok", ...
    url: str
    title: str = ""
    text: str = ""
    author: str = ""
    date: str | None = None  # ISO 8601
    score: int | None = None # upvotes / likes / stars, whatever the platform has
    num_comments: int | None = None
    comments: list[Comment] = field(default_factory=list)
    kind: str = "post"       # post | page | video | place | chat
    geo: tuple[float, float] | None = None
    query: str = ""          # the query that found it
    meta: dict[str, Any] = field(default_factory=dict)
    rank: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class SearchRequest:
    question: str
    answers: dict[str, str] = field(default_factory=dict)  # clarifying question -> user's answer
    sources: list[str] | None = None                        # None = all enabled
    mode: str = "standard"                                  # quick | standard | deep
    model: str | None = None
