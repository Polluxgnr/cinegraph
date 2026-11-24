"""Cheap, model-free ranking: decides which results are worth reading in full and which
make it into the model's limited context. Relevance first, then engagement, then freshness."""
from __future__ import annotations

import math
import re
from datetime import date

from .models import Document

_STOP = set("""a an and are as at be by can do for from has have how i in is it its me my of on or
so that the this to was what when where which who why will with you your best good get any
le la les un une des du de et en est pour que qui dans sur au aux avec pas plus ou par ce""".split())


def terms(text: str) -> list[str]:
    words = re.findall(r"[\w'-]+", text.lower())
    return list(dict.fromkeys(w for w in words if len(w) > 2 and w not in _STOP))


def score(doc: Document, q: list[str]) -> float:
    title = doc.title.lower()
    body = (doc.text[:4000] + " " + " ".join(c.text for c in doc.comments[:20])).lower()
    rel = sum(2.0 for t in q if t in title) + sum(1.0 for t in q if t in body)
    rel = rel / max(len(q), 1)
    eng = math.log10(1 + max(doc.score or 0, 0)) * 0.4 + math.log10(1 + (doc.num_comments or 0)) * 0.5
    fresh = 0.0
    if doc.date:
        try:
            age_days = (date.today() - date.fromisoformat(doc.date[:10])).days
            fresh = max(0.0, 1.0 - age_days / (365 * 4))  # linear decay over ~4 years
        except ValueError:
            pass
    if doc.platform == "youtube":
        eng *= 0.6  # view counts dwarf upvotes; keep them comparable
    return rel * 3 + eng + fresh


def rank(docs: list[Document], question: str) -> list[Document]:
    q = terms(question)
    seen: set[str] = set()
    unique = []
    for d in docs:
        key = d.url.lower().rstrip("/")
        if key in seen:
            continue
        seen.add(key)
        d.rank = score(d, q)
        unique.append(d)
    unique.sort(key=lambda d: -d.rank)
    return unique


def diversify(docs: list[Document], n: int) -> list[Document]:
    """Take the top n but round-robin across platforms so one loud source can't crowd out the rest."""
    by_platform: dict[str, list[Document]] = {}
    for d in docs:
        by_platform.setdefault(d.platform, []).append(d)
    out: list[Document] = []
    while len(out) < n and any(by_platform.values()):
        for plat in list(by_platform):
            if by_platform[plat] and len(out) < n:
                out.append(by_platform[plat].pop(0))
    return out
