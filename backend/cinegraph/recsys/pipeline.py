"""The ranking pipeline:

  candidates (embeddings kNN + CF top-N + graph neighbours + quality fallback)
  -> hard filters, constraints (kind / mood / platform / runtime), drop seen
  -> features (features.py) -> LTR model, or the default blend until it is trained
  -> diversity (MMR) -> exploration slots (bandit) -> explanations -> impression log
"""
from __future__ import annotations

import json
import logging
import uuid
from dataclasses import dataclass, field

import numpy as np

from .. import db
from ..config import get_settings
from . import bandit, cf, filters, graph, ltr
from .catalog import emb_index, mood_score, my_platforms, platforms_for, titles_by_id
from .features import FEATURES, TasteInputs, compute, default_blend, genre_affinity, profile_vectors
from .profile import Profile, load_profile

log = logging.getLogger(__name__)


@dataclass
class Constraints:
    kinds: set[str] | None = None            # {"movie"}, {"tv"} or None
    mood: str | None = None
    platforms: set[str] | None = None        # only titles streaming on these (FR)
    max_runtime: int | None = None
    min_year: int | None = None
    max_year: int | None = None
    include_genres: set[str] = field(default_factory=set)
    exclude_genres: set[str] = field(default_factory=set)
    include_watchlist: bool = True


def build_taste(prof: Profile, exclude: set[int] | None = None, candidate_ids: list[int] | None = None,
                mood: str | None = None, platforms: set[str] | None = None) -> TasteInputs:
    exclude = exclude or set()
    idx = emb_index()
    weights = {t: s.weight for t, s in prof.signals.items() if t not in exclude}
    pvec, pos, pos_ids, neg = profile_vectors(weights, idx.vec)
    genres_of = {t: m["genres"] for t, m in titles_by_id(list(weights)).items()}
    taste = TasteInputs(profile_vec=pvec, pos_vecs=pos, pos_ids=pos_ids, neg_vecs=neg,
                        genre_aff=genre_affinity(weights, genres_of), watchlist=prof.watchlist,
                        platforms=platforms or set(my_platforms()), mood=mood)
    model = cf.load_model()
    rated = {t: r for t, r in prof.rated.items() if t not in exclude}
    if model is not None and candidate_ids:
        uvec = model.fold_in(rated)
        if uvec is not None:
            taste.cf = model.scores(uvec, candidate_ids)
    if candidate_ids:
        anchors = {t: a for t, a in prof.anchors().items() if t not in exclude}
        taste.kg = graph.score_paths(candidate_ids, anchors)
    return taste


def _graph_candidates(prof: Profile, limit: int = 250) -> list[int]:
    pos = [str(t) for t, s in prof.signals.items() if s.weight >= 0.5]
    if not pos:
        return []
    rows = db.fetchall(
        """
        SELECT tn.key::int tid, sum(1.0 / ln(2 + m.degree)) s
        FROM kg_nodes an JOIN kg_edges e1 ON e1.src = an.id
        JOIN kg_nodes m ON m.id = e1.dst AND m.type IN ('person', 'series', 'work', 'award', 'subject', 'title')
                         AND m.degree <= 400
        JOIN kg_edges e2 ON e2.dst = m.id JOIN kg_nodes tn ON tn.id = e2.src AND tn.type = 'title'
        WHERE an.type = 'title' AND an.key = ANY(%s) AND (e1.rel <> 'stars' OR e1.weight >= 0.7)
        GROUP BY 1 ORDER BY 2 DESC LIMIT %s
        """, (pos, limit))
    return [r["tid"] for r in rows]


def generate_candidates(prof: Profile, n_emb: int = 400, extra: list[int] | None = None) -> list[int]:
    idx = emb_index()
    out: dict[int, None] = {t: None for t in (extra or [])}
    weights = {t: s.weight for t, s in prof.signals.items()}
    pvec, pos, pos_ids, _ = profile_vectors(weights, idx.vec)
    if len(idx):
        if pvec is not None:
            sims = idx.m @ pvec
            for j in np.argsort(-sims)[:n_emb]:
                out[int(idx.ids[j])] = None
        for k in range(min(len(pos_ids), 15)):
            sims = idx.m @ pos[k]
            for j in np.argsort(-sims)[1:25]:
                out[int(idx.ids[j])] = None
    model = cf.load_model()
    if model is not None:
        uvec = model.fold_in(prof.rated)
        if uvec is not None:
            for tid, _ in model.top(uvec, 250, prof.seen):
                out[tid] = None
    for tid in _graph_candidates(prof):
        out[tid] = None
    # quality / popularity fallback (cold start, and keeps well-known titles in play)
    for r in db.fetchall(
            """(SELECT id FROM titles WHERE kind = 'movie' ORDER BY COALESCE(vote_count, 0) * COALESCE(vote_average, 6)
                DESC, popularity DESC NULLS LAST LIMIT 150)
               UNION ALL
               (SELECT id FROM titles WHERE kind = 'tv' ORDER BY COALESCE(vote_count, 0) * COALESCE(vote_average, 6)
                DESC, popularity DESC NULLS LAST LIMIT 150)"""):
        out[r["id"]] = None
    return list(out)


def passes(t: dict, c: Constraints, prof: Profile) -> bool:
    if not filters.allowed(t):
        return False
    if t["id"] in prof.seen:
        return False
    if not c.include_watchlist and t["id"] in prof.watchlist:
        return False
    if c.kinds and t["kind"] not in c.kinds:
        return False
    if c.max_runtime and t.get("runtime") and t["runtime"] > c.max_runtime:
        return False
    if c.min_year and (t.get("year") or 0) < c.min_year:
        return False
    if c.max_year and (t.get("year") or 9999) > c.max_year:
        return False
    g = set(t.get("genres") or [])
    if c.include_genres and not (g & c.include_genres):
        return False
    if c.exclude_genres and g & c.exclude_genres:
        return False
    if c.platforms and not (set(platforms_for(t)) & c.platforms):
        return False
    if c.mood and mood_score(t, c.mood) <= 0:
        return False
    return True


def _mmr(ids: list[int], scores: np.ndarray, vec_of, n: int, lam: float = 0.8) -> list[int]:
    if not ids:
        return []
    s = (scores - scores.min()) / (np.ptp(scores) + 1e-9)
    chosen: list[int] = []
    chosen_vecs: list[np.ndarray] = []
    pool = list(range(len(ids)))
    while pool and len(chosen) < n:
        best, best_val = None, -1e9
        for i in pool[: 4 * n]:
            v = vec_of(ids[i])
            sim = max((float(v @ cv) for cv in chosen_vecs), default=0.0) if v is not None else 0.0
            val = lam * s[i] - (1 - lam) * sim
            if val > best_val:
                best, best_val = i, val
        pool.remove(best)
        chosen.append(ids[best])
        v = vec_of(ids[best])
        if v is not None:
            chosen_vecs.append(v)
    return chosen


def explain(tid: int, t: dict, taste: TasteInputs, prof: Profile, feats: dict) -> str:
    kg = taste.kg.get(tid)
    if kg and kg["best"] is not None and kg["best"].contribution >= 0.08:
        return kg["best"].explain()
    model = cf.load_model()
    pos_anchors = [a for a, s in prof.signals.items() if s.weight >= 0.5]
    if model is not None and (feats.get("cf") or 0) > 0.15:
        near = model.nearest_anchor(tid, pos_anchors)
        if near and near[1] > 0.25:
            a = prof.signals[near[0]]
            return f"Viewers who loved {a.title} rate this highly"
    if len(taste.pos_vecs):
        idx = emb_index()
        v = idx.vec(tid)
        if v is not None:
            sims = taste.pos_vecs @ v
            k = int(np.argmax(sims))
            a_id = taste.pos_ids[k]
            a = prof.signals[a_id]
            a_meta = titles_by_id([a_id]).get(a_id, {})
            shared = [kw for kw in (t.get("keywords") or []) if kw in set(a_meta.get("keywords") or [])][:2]
            if shared:
                return f"Like {a.title}: {', '.join(shared)}"
            return f"Close in tone and themes to {a.title}"
    if t.get("genres"):
        return f"Highly rated {t['genres'][0].lower()} pick"
    return "Popular pick to calibrate your taste"


def recommend(n: int = 20, constraints: Constraints | None = None, surface: str = "recs",
              extra_candidates: list[int] | None = None, boost: dict[int, float] | None = None,
              balance_kinds: bool = False, log_impressions: bool = True, explore: bool = True,
              rng: np.random.Generator | None = None) -> dict:
    c = constraints or Constraints()
    prof = load_profile()
    cand_ids = generate_candidates(prof, extra=extra_candidates)
    meta = titles_by_id(cand_ids)
    cands = {t: m for t, m in meta.items() if passes(m, c, prof)}
    if c.platforms or c.mood or c.kinds:
        # constrained surfaces: widen the pool with direct DB matches so they don't run dry
        more = _constrained_pool(c, prof, exclude=set(cands))
        cands.update(more)
    taste = build_taste(prof, candidate_ids=list(cands), mood=c.mood,
                        platforms=c.platforms or set(my_platforms()))
    idx = emb_index()
    ids, X = compute(cands, idx.vec, taste, mood_score, platforms_for)
    learned = ltr.predict(X)
    scores = learned if learned is not None else default_blend(X)
    if boost:
        scores = scores + np.asarray([boost.get(t, 0.0) for t in ids], dtype=np.float32)
    order = np.argsort(-scores)
    ranked = [ids[i] for i in order]
    score_of = {ids[i]: float(scores[i]) for i in range(len(ids))}

    n_explore = int(round(n * bandit.EXPLORE_SHARE)) if explore and n >= 6 else 0
    n_exploit = n - n_explore
    top_pool = ranked[: max(4 * n, 60)]
    if balance_kinds and not c.kinds:
        movies = [t for t in top_pool if cands[t]["kind"] == "movie"]
        tvs = [t for t in top_pool if cands[t]["kind"] == "tv"]
        half = n_exploit // 2
        picked = (_mmr(movies, np.array([score_of[t] for t in movies]), idx.vec, n_exploit - min(half, len(tvs)))
                  if movies else [])
        picked += _mmr(tvs, np.array([score_of[t] for t in tvs]), idx.vec, n_exploit - len(picked)) if tvs else []
        picked.sort(key=lambda t: -score_of[t])
    else:
        picked = _mmr(top_pool, np.array([score_of[t] for t in top_pool]), idx.vec, n_exploit)

    explore_picks = bandit.pick_explore(ranked[n_exploit:], score_of, n_explore, set(picked), rng)
    results = []
    request_id = uuid.uuid4().hex
    feat_rows = {t: X[ids.index(t)] for t in picked + [e for e, _ in explore_picks]}
    final = [(t, False, None) for t in picked]
    # interleave exploration picks at fixed positions (4, 9, ...)
    for k, (t, arm) in enumerate(explore_picks):
        final.insert(min(len(final), 3 + k * 5), (t, True, arm))
    for pos, (tid, is_explore, arm) in enumerate(final):
        t = cands[tid]
        fd = ltr.feature_dict(feat_rows[tid])
        why = explain(tid, t, taste, prof, fd)
        if is_explore:
            why = f"Exploring: {why[0].lower() + why[1:]}"
        results.append({**_public(t), "score": round(score_of[tid], 4), "why": why, "explore": is_explore,
                        "features": fd, "position": pos})
    if log_impressions and results:
        with db.connect() as conn:
            for r, (tid, is_explore, arm) in zip(results, final):
                conn.execute(
                    "INSERT INTO impressions (request_id, surface, title_id, position, features, explore, arm) "
                    "VALUES (%s,%s,%s,%s,%s::jsonb,%s,%s)",
                    (request_id, surface, tid, r["position"], json.dumps(r["features"]), is_explore, arm))
            conn.commit()
    return {"request_id": request_id, "model": "ltr" if learned is not None else "default-blend",
            "profile_size": len(prof.signals), "candidates": len(cands), "items": results}


def _constrained_pool(c: Constraints, prof: Profile, exclude: set[int], limit: int = 600) -> dict[int, dict]:
    where, params = ["true"], []
    if c.kinds:
        where.append("t.kind = ANY(%s)")
        params.append(list(c.kinds))
    if c.platforms:
        where.append("EXISTS (SELECT 1 FROM providers p WHERE p.title_id = t.id AND p.offer_type IN "
                     "('flatrate','free','ads'))")
    if c.mood:
        from .catalog import MOODS

        where.append("(t.genres && %s OR t.keywords && %s)")
        params += [list(MOODS[c.mood]["genres"]), list(MOODS[c.mood]["keywords"])]
    rows = db.fetchall(
        f"SELECT t.id FROM titles t WHERE {' AND '.join(where)} "
        f"ORDER BY COALESCE(t.vote_count, 0) * COALESCE(t.vote_average, 6) DESC, t.popularity DESC NULLS LAST "
        f"LIMIT {int(limit)}", params)
    ids = [r["id"] for r in rows if r["id"] not in exclude]
    return {t: m for t, m in titles_by_id(ids).items() if passes(m, c, prof)}


def _public(t: dict) -> dict:
    return {
        "id": t["id"], "kind": t["kind"], "tmdb_id": t["tmdb_id"], "title": t["title"], "year": t["year"],
        "genres": t["genres"], "runtime": t["runtime"], "seasons": t.get("number_of_seasons"),
        "poster_path": t["poster_path"], "backdrop_path": t.get("backdrop_path"),
        "overview": t.get("overview"), "vote_average": t["vote_average"], "platforms": platforms_for(t),
        "keywords": (t.get("keywords") or [])[:8],
    }


def feature_names() -> list[str]:
    return FEATURES
