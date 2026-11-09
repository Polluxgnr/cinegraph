"""Natural-language queries: "like Fauda but funnier, under 2h, on Netflix".

1. parse  -> Intent (LLM with a JSON schema, or the regex parser below as fallback)
2. resolve the anchor titles, embed the free-text "vibe"
3. run the normal ranking pipeline with those constraints, boosting titles close to the
   anchors / vibe
4. LLM rerank of the top ~30 with a one-line explanation each (fallback: pipeline order
   and its path-based explanation)
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field

import numpy as np

from .. import db
from ..textnorm import strip_accents
from ..userdata.matcher import match_local
from .catalog import MOODS, PLATFORM_ALIASES, emb_index, titles_by_id
from .llm import get_llm
from .pipeline import Constraints, recommend
from .profile import load_profile

log = logging.getLogger(__name__)

MOOD_WORDS = {
    "laugh": ["funnier", "funny", "comedy", "comedic", "laugh", "hilarious", "drole", "drôle", "marrant", "humour",
              "humor", "rire"],
    "horror": ["horror", "scary", "scarier", "creepy", "horreur", "peur", "flippant"],
    "tense": ["tense", "thriller", "suspense", "gripping", "intense", "haletant", "tendu"],
    "mind": ["mind-bending", "mind bending", "twist", "brain", "trippy", "cerebral", "mindfuck", "retourne"],
    "epic": ["epic", "épique", "epique", "grand", "sweeping"],
}


@dataclass
class Intent:
    anchors: list[dict] = field(default_factory=list)   # [{"title": str, "year": int|None}]
    kinds: list[str] = field(default_factory=list)
    mood: str | None = None
    max_runtime: int | None = None
    platforms: list[str] = field(default_factory=list)
    include_genres: list[str] = field(default_factory=list)
    exclude_genres: list[str] = field(default_factory=list)
    min_year: int | None = None
    max_year: int | None = None
    vibe: str = ""
    language: str = "en"


INTENT_SCHEMA = {
    "type": "object",
    "properties": {
        "anchors": {"type": "array", "items": {"type": "object", "properties": {
            "title": {"type": "string"}, "year": {"type": ["integer", "null"]}},
            "required": ["title", "year"], "additionalProperties": False}},
        "kinds": {"type": "array", "items": {"type": "string", "enum": ["movie", "tv"]}},
        "mood": {"type": ["string", "null"], "enum": list(MOODS) + [None]},
        "max_runtime": {"type": ["integer", "null"]},
        "platforms": {"type": "array", "items": {"type": "string", "enum": list(PLATFORM_ALIASES)}},
        "include_genres": {"type": "array", "items": {"type": "string"}},
        "exclude_genres": {"type": "array", "items": {"type": "string"}},
        "min_year": {"type": ["integer", "null"]},
        "max_year": {"type": ["integer", "null"]},
        "vibe": {"type": "string"},
        "language": {"type": "string"},
    },
    "required": ["anchors", "kinds", "mood", "max_runtime", "platforms", "include_genres", "exclude_genres",
                 "min_year", "max_year", "vibe", "language"],
    "additionalProperties": False,
}

PARSE_SYSTEM = f"""You turn a film/TV request into search filters for a personal recommender.
- anchors: titles the user compares to ("like X"), with year if stated or obvious.
- kinds: "movie" and/or "tv" only if the user restricts it, else [].
- mood: one of {list(MOODS)} if the request implies it ("funnier" -> "laugh"), else null.
- max_runtime in minutes ("under 2h" -> 120). For series this applies to episode length.
- platforms: only from the allowed list, only if named.
- genres use TMDB names (Comedy, Thriller, Science Fiction, Horror, Crime, Drama, War, ...).
- vibe: one English sentence describing what the user wants, for semantic search.
- language: ISO code of the user's request (e.g. "fr", "en")."""


def _platforms_in(text: str) -> list[str]:
    t = strip_accents(text.lower())
    found = []
    pats = {"Netflix": r"netflix", "Prime Video": r"prime|amazon", "Disney+": r"disney",
            "HBO Max": r"\bhbo\b|\bmax\b", "Canal+": r"canal", "Apple TV+": r"apple"}
    for k, p in pats.items():
        if re.search(p, t):
            found.append(k)
    return found


def rule_parse(q: str) -> Intent:
    it = Intent()
    low = q.lower()
    m = re.search(r"(?:like|comme|similar to|à la|a la|genre|style)\s+(.+?)(?=\s+(?:but|mais|with|avec|under|"
                  r"moins|on|sur|in|en|from|des|of the|that|qui)\b|[,;.!?]|$)", q, re.I)
    if m:
        name = m.group(1).strip(" \"'«»")
        ym = re.search(r"\((\d{4})\)", name)
        it.anchors.append({"title": re.sub(r"\s*\(\d{4}\)", "", name), "year": int(ym.group(1)) if ym else None})
    r = re.search(r"(?:under|less than|moins de|max(?:imum)?|<)\s*(\d+(?:[.,]\d+)?)\s*(h|hours?|heures?|min|minutes?|mn)?",
                  low)
    if r:
        v = float(r.group(1).replace(",", "."))
        unit = r.group(2) or ("h" if v <= 5 else "min")
        it.max_runtime = int(v * 60) if unit.startswith("h") else int(v)
    elif re.search(r"\b(\d)h(\d{2})?\b", low):
        h = re.search(r"\b(\d)h(\d{2})?\b", low)
        it.max_runtime = int(h.group(1)) * 60 + int(h.group(2) or 0)
    if re.search(r"\b(series|série|series|show|tv|séries|serie)\b", low):
        it.kinds = ["tv"]
    elif re.search(r"\b(film|movie|films|movies)\b", low):
        it.kinds = ["movie"]
    for mood, words in MOOD_WORDS.items():
        if any(w in low for w in words):
            it.mood = mood
            break
    it.platforms = _platforms_in(q)
    y = re.search(r"\b(?:after|après|since|depuis)\s+(\d{4})\b", low)
    if y:
        it.min_year = int(y.group(1))
    y = re.search(r"\b(?:before|avant)\s+(\d{4})\b", low)
    if y:
        it.max_year = int(y.group(1))
    if re.search(r"\b(ans|avec|sur|mais|comme|drôle|série)\b", low):
        it.language = "fr"
    it.vibe = q
    return it


def parse(q: str) -> tuple[Intent, str]:
    llm = get_llm()
    if llm.name != "none":
        d = llm.json(PARSE_SYSTEM, q, INTENT_SCHEMA)
        if d:
            try:
                return Intent(**{k: d.get(k, getattr(Intent(), k)) for k in INTENT_SCHEMA["properties"]}), llm.name
            except TypeError:
                pass
    return rule_parse(q), "rules"


RERANK_SCHEMA = {
    "type": "object",
    "properties": {"picks": {"type": "array", "items": {"type": "object", "properties": {
        "id": {"type": "integer"}, "why": {"type": "string"}}, "required": ["id", "why"],
        "additionalProperties": False}}},
    "required": ["picks"], "additionalProperties": False,
}


def _rerank(q: str, intent: Intent, items: list[dict], taste: list[str], n: int) -> list[dict] | None:
    llm = get_llm()
    if llm.name == "none" or not items:
        return None
    lines = []
    for it in items:
        lines.append(f"- id={it['id']} | {it['title']} ({it['year']}) | {it['kind']} | "
                     f"{', '.join(it['genres'][:3])} | {it['runtime'] or '?'} min | "
                     f"{', '.join(it['platforms']) or 'no FR streaming'} | signal: {it['why']} | "
                     f"{(it.get('overview') or '')[:220]}")
    system = (
        "You rerank recommendation candidates for one person. Pick the best matches for the request, "
        f"best first, at most {n}. Only use ids from the list. For each, write ONE short line (max 20 words) "
        f"in language '{intent.language}' explaining why it fits the request and this person's taste; "
        "be concrete (tone, premise, people), no spoilers, no hype words. "
        "Respect hard constraints (runtime, platform, kind) strictly.")
    user = (f"Request: {q}\n\nTheir favourites: {', '.join(taste[:15]) or 'unknown yet'}\n\n"
            f"Candidates:\n" + "\n".join(lines))
    d = llm.json(system, user, RERANK_SCHEMA)
    if not d:
        return None
    by_id = {it["id"]: it for it in items}
    out = []
    for p in d.get("picks", []):
        it = by_id.get(p.get("id"))
        if it and it not in out:
            out.append({**it, "why": p.get("why") or it["why"], "why_signal": it["why"]})
    return out[:n] or None


def query(q: str, n: int = 10) -> dict:
    intent, parser = parse(q)
    idx = emb_index()
    anchor_ids, anchor_titles = [], []
    for a in intent.anchors:
        m = match_local(a.get("title") or "", a.get("year"))
        if m:
            anchor_ids.append(m.candidate.id)
            anchor_titles.append(m.candidate.title)
    kinds = set(intent.kinds) or None
    if anchor_ids and not kinds:
        # "like Fauda" implies a series unless said otherwise
        kinds = {titles_by_id(anchor_ids)[anchor_ids[0]]["kind"]}
    boost: dict[int, float] = {}
    extra: list[int] = []
    vecs = [v for t in anchor_ids if (v := idx.vec(t)) is not None]
    if intent.vibe:
        try:
            from .embeddings import get_embedder

            qv = get_embedder().embed_query(intent.vibe)
            vecs.append(qv / (np.linalg.norm(qv) + 1e-9))
        except Exception as e:  # noqa: BLE001
            log.debug("vibe embedding failed: %s", e)
    if vecs and len(idx):
        centre = np.mean(vecs, axis=0)
        centre /= np.linalg.norm(centre) + 1e-9
        sims = idx.m @ centre
        for j in np.argsort(-sims)[:300]:
            tid = int(idx.ids[j])
            if tid not in anchor_ids:
                extra.append(tid)
                boost[tid] = 0.6 * float(sims[j])
    notes = []
    platforms = set(intent.platforms) or None
    if platforms and not db.fetchone("SELECT EXISTS (SELECT 1 FROM providers) e")["e"]:
        platforms = None
        notes.append("No streaming data yet (needs the TMDB crawl), so the platform filter was ignored.")
    c = Constraints(kinds=kinds, mood=intent.mood, platforms=platforms,
                    max_runtime=intent.max_runtime, min_year=intent.min_year, max_year=intent.max_year,
                    include_genres=set(intent.include_genres), exclude_genres=set(intent.exclude_genres))
    res = recommend(n=max(30, n * 3), constraints=c, surface="query", extra_candidates=extra, boost=boost,
                    explore=False)
    items = [i for i in res["items"] if i["id"] not in anchor_ids]
    prof = load_profile()
    taste = [s.title for _, s in sorted(prof.signals.items(), key=lambda x: -x[1].weight) if s.weight > 0.5]
    reranked = _rerank(q, intent, items, taste, n)
    if not reranked and anchor_ids:
        from .pipeline import GENERIC_KEYWORDS

        a_kw = set(titles_by_id(anchor_ids)[anchor_ids[0]]["keywords"] or [])
        for it in items[:n]:
            shared = [k for k in it.get("keywords") or [] if k in a_kw and k.lower() not in GENERIC_KEYWORDS][:2]
            it["why_signal"] = it["why"]
            detail = f" ({', '.join(shared)})" if shared else ""
            it["why"] = f"Close to {anchor_titles[0]}{detail} · {it['why']}"
    return {
        "query": q, "parser": parser, "intent": intent.__dict__, "anchors": anchor_titles,
        "reranked_by": get_llm().name if reranked else None,
        "items": reranked or items[:n],
        "notes": notes,
        "request_id": res["request_id"],
    }
