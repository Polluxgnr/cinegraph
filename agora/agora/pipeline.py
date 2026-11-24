"""Question -> refining questions -> per-platform queries -> gather -> rank -> read -> cited answer.

run_search() is an async generator of events so the interface can show progress live.
"""
from __future__ import annotations

import asyncio
import json
import time
from datetime import date
from typing import Any, AsyncIterator

import httpx

from . import prompts
from .config import load_config, read_profile
from .llm import LLM, LLMError, get_llm
from .models import Document, SearchRequest
from .rank import diversify, rank
from .sources import all_sources
from .sources.base import USER_AGENT, Source, clip

Event = dict[str, Any]

FORMATS = {"places", "compare", "ranked", "guide", "answer"}


def mode_settings(mode: str) -> dict[str, int]:
    modes = load_config()["search"].get("modes", {})
    defaults = {"queries": 3, "per_query": 10, "read": 20, "comments": 30}
    return {**defaults, **modes.get(mode, modes.get("standard", {}))}


def _context_header(req: SearchRequest) -> str:
    parts = [f"Today: {date.today().isoformat()}"]
    profile = read_profile().strip()
    if profile:
        parts.append(f"About the person asking (their profile):\n{profile}")
    parts.append(f"Question: {req.question}")
    if req.answers:
        parts.append("Their answers to refining questions:\n" +
                     "\n".join(f"- {q} -> {a}" for q, a in req.answers.items() if a))
    return "\n\n".join(parts)


# ---------------------------------------------------------------- 1. clarify

async def clarify(question: str, model: str | None = None) -> dict[str, Any]:
    llm = get_llm(model)
    req = SearchRequest(question=question)
    out = await llm.chat_json(prompts.CLARIFY, _context_header(req), max_tokens=1500)
    qs = [q for q in out.get("questions", []) if isinstance(q, dict) and q.get("q")][:4]
    return {"intent": out.get("intent", ""), "questions": qs}


# ---------------------------------------------------------------- 2. plan

async def plan(req: SearchRequest, llm: LLM, sources: list[Source], n: int) -> dict[str, Any]:
    listing = "\n".join(f"- {s.name}: {s.description}" for s in sources)
    try:
        out = await llm.chat_json(prompts.PLAN.replace("{n}", str(n)),
                                  f"{_context_header(req)}\n\nSources available:\n{listing}", max_tokens=2000)
    except (LLMError, ValueError, json.JSONDecodeError) as e:
        out = {"error": str(e)[:200]}
    queries = out.get("queries") if isinstance(out.get("queries"), dict) else {}
    if not queries:
        out.setdefault("error", "the model returned no usable search plan")
    final: dict[str, list[str]] = {}
    for s in sources:
        qs = [q for q in queries.get(s.name, []) if isinstance(q, str) and q.strip()][:n]
        if s.name not in queries:
            qs = [req.question]  # model skipped this source: fall back to the raw question
        if qs:
            final[s.name] = qs
    fmt = out.get("format") if out.get("format") in FORMATS else "answer"
    return {"format": fmt, "queries": final, "error": out.get("error")}


# ---------------------------------------------------------------- 3. gather

async def _search_one(src: Source, query: str, limit: int) -> list[Document]:
    timeout = 180 if src.group == "browser" else 60
    docs = await asyncio.wait_for(src.search(query, limit), timeout)
    for d in docs:
        d.query = query
    return docs


async def _enrich_one(src: Source, doc: Document, n_comments: int) -> Document:
    timeout = 120 if src.group == "browser" else 45
    try:
        return await asyncio.wait_for(src.enrich(doc, n_comments), timeout)
    except Exception as e:  # a page that won't load keeps its search snippet
        doc.meta["enrich_error"] = f"{type(e).__name__}: {e}"[:200]
        return doc


# ---------------------------------------------------------------- 4. context for the model

def _fmt_num(n: int | None, label: str) -> str:
    return f"{n:,} {label}" if n else ""


def format_doc(i: int, d: Document, budget: int) -> str:
    head = " · ".join(filter(None, [
        d.platform, d.meta.get("subreddit") or d.meta.get("site") or "", d.date or "",
        _fmt_num(d.score, d.meta.get("score_label", "points")), _fmt_num(d.num_comments, "comments")]))
    lines = [f"[{i}] {head}", f"Title: {d.title}", f"URL: {d.url}"]
    if d.geo:
        lines.append(f"Coordinates: {d.geo[0]:.5f},{d.geo[1]:.5f}")
    if d.meta.get("page_text"):
        lines.append("Page text (post, then comments/replies/reviews as shown on the page):")
    text_budget = budget // 2 if d.comments else budget
    if d.text:
        lines.append(clip(d.text, text_budget))
    if d.comments:
        lines.append("Comments:")
        used = sum(len(x) for x in lines)
        for c in d.comments:
            meta = " ".join(filter(None, [f"({c.score}↑)" if c.score else "", c.date or ""]))
            line = f"{'  ' * min(c.depth, 3)}- {meta} {c.author}: {c.text}".replace("\n", " ")
            if used + len(line) > budget:
                break
            lines.append(line)
            used += len(line)
    return "\n".join(lines)


def build_context(docs: list[Document], max_chars: int) -> tuple[str, list[Document]]:
    """Fit as many sources as possible, each with a fair share of the budget."""
    if not docs:
        return "", []
    per_doc = max(1200, min(6000, max_chars // len(docs)))
    parts, used, kept = [], 0, []
    for d in docs:
        block = format_doc(len(kept) + 1, d, per_doc)
        if used + len(block) > max_chars and kept:
            break
        parts.append(block)
        kept.append(d)
        used += len(block) + 2
    return "\n\n".join(parts), kept


# ---------------------------------------------------------------- 5. geocode places

_geo_cache: dict[str, tuple[float, float] | None] = {}


async def geocode(name: str, area: str) -> tuple[float, float] | None:
    """OpenStreetMap Nominatim: free, 1 request/second, so places are geocoded one by one."""
    for q in dict.fromkeys([f"{name}, {area}".strip(", "), name, area]):
        if not q:
            continue
        if q in _geo_cache:
            if _geo_cache[q]:
                return _geo_cache[q]
            continue
        async with httpx.AsyncClient(timeout=15, headers={"User-Agent": USER_AGENT}) as c:
            r = await c.get("https://nominatim.openstreetmap.org/search", params={"q": q, "format": "json", "limit": 1})
        await asyncio.sleep(1.1)
        hit = r.json()[0] if r.status_code == 200 and r.json() else None
        _geo_cache[q] = (float(hit["lat"]), float(hit["lon"])) if hit else None
        if _geo_cache[q]:
            return _geo_cache[q]
    return None


async def place_coordinates(places: list[dict], kept: list[Document]) -> None:
    for p in places[:20]:
        # Prefer exact coordinates from a cited Google Maps page over geocoding a name.
        for n in p.get("sources") or []:
            if isinstance(n, int) and 1 <= n <= len(kept) and kept[n - 1].geo:
                p["lat"], p["lon"] = kept[n - 1].geo
                p["approx"] = False
                break
        else:
            if load_config()["search"].get("geocode", True):
                try:
                    pt = await geocode(p.get("name", ""), p.get("area", ""))
                except Exception:
                    pt = None
                if pt:
                    p["lat"], p["lon"] = pt
                    p["approx"] = True


# ---------------------------------------------------------------- the whole run

async def run_search(req: SearchRequest) -> AsyncIterator[Event]:
    t0 = time.time()
    llm = get_llm(req.model)
    settings = mode_settings(req.mode)
    registry = all_sources()
    wanted = req.sources or [n for n, s in registry.items() if s.enabled]
    sources, skipped = [], []
    for n in wanted:
        s = registry.get(n)
        if not s:
            continue
        ok, why = s.available()
        if ok:
            sources.append(s)
        else:
            skipped.append((s.label, why))
    for label, why in skipped:
        yield {"type": "source", "name": label, "status": "skipped", "detail": why}
    if not sources:
        yield {"type": "error", "message": "No usable sources selected."}
        return

    yield {"type": "status", "message": f"Planning searches with {llm.name}…"}
    p = await plan(req, llm, sources, settings["queries"])
    if p["error"]:
        yield {"type": "status", "message": f"Search plan failed ({p['error']}); searching with your question as typed."}
    yield {"type": "plan", "format": p["format"], "queries": p["queries"]}

    # Gather: every (source, query) in parallel. Browser sources queue on one window by design.
    by_name = {s.name: s for s in sources}
    jobs = [(name, q) for name, qs in p["queries"].items() for q in qs]
    yield {"type": "status", "message": f"Searching {len(by_name)} sources with {len(jobs)} queries…"}
    results = await asyncio.gather(*[_search_one(by_name[n], q, settings["per_query"]) for n, q in jobs],
                                   return_exceptions=True)
    found: list[Document] = []
    per_source: dict[str, dict[str, Any]] = {}
    for (name, q), res in zip(jobs, results):
        st = per_source.setdefault(name, {"count": 0, "errors": []})
        if isinstance(res, BaseException):
            st["errors"].append(f"{q}: {type(res).__name__}: {str(res)[:150]}")
        else:
            st["count"] += len(res)
            found.extend(res)
    for name, st in per_source.items():
        yield {"type": "source", "name": by_name[name].label,
               "status": "ok" if st["count"] else ("error" if st["errors"] else "empty"),
               "count": st["count"], "detail": "; ".join(st["errors"])[:400]}

    ranked = rank(found, req.question + " " + " ".join(req.answers.values()))
    to_read = diversify(ranked, settings["read"])
    if not to_read:
        yield {"type": "error", "message": "Nothing found. Try other sources or rephrase."}
        return

    # Read: full text + comments for the best results.
    yield {"type": "reading", "done": 0, "total": len(to_read)}
    sem = asyncio.Semaphore(6)
    done = 0

    async def read(d: Document) -> Document:
        async with sem:
            return await _enrich_one(registry[d.platform], d, settings["comments"])

    tasks = [asyncio.create_task(read(d)) for d in to_read]
    for fut in asyncio.as_completed(tasks):
        await fut
        done += 1
        if done % 3 == 0 or done == len(tasks):
            yield {"type": "reading", "done": done, "total": len(to_read)}

    read_docs = rank(to_read, req.question)  # re-rank now that comments are in
    context, kept = build_context(read_docs, llm.context_chars)
    yield {"type": "sources", "items": [dict(d.to_dict(), id=i + 1) for i, d in enumerate(kept)]}

    yield {"type": "status", "message": f"Reading {len(kept)} sources and writing the answer…"}
    system = prompts.SYNTHESIZE.replace("{format}", p["format"])
    user = f"{_context_header(req)}\n\nSOURCES\n\n{context}"
    answer: dict[str, Any]
    try:
        answer = await llm.chat_json(system, user, max_tokens=12000)
    except (ValueError, json.JSONDecodeError, LLMError):
        raw = await llm.chat(system + "\n\nIf JSON is hard, plain Markdown with [n] citations is fine.", user, 12000)
        answer = {"tldr": "", "answer_md": raw}
    if not (answer.get("tldr") or answer.get("answer_md")):
        yield {"type": "error", "message": f"{llm.name} returned an empty answer. Try again or pick another model."}
        return
    answer["format"] = p["format"]
    places = [pl for pl in answer.get("places") or [] if isinstance(pl, dict) and pl.get("name")]
    if places:
        yield {"type": "status", "message": "Putting places on the map…"}
        await place_coordinates(places, kept)
        answer["places"] = places
    answer["stats"] = {"found": len(found), "read": len(to_read), "cited_pool": len(kept),
                       "seconds": round(time.time() - t0), "model": (getattr(llm, "used", None) or [llm.name])[-1]}
    yield {"type": "answer", "answer": answer}
    yield {"type": "done"}
