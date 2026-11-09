"""Feature computation for ranking. Pure functions over already-loaded inputs, so the
ranking pipeline can be tested without a database."""
from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass, field

import numpy as np

FEATURES = [
    "emb_profile", "emb_max_pos", "emb_max_neg", "cf", "kg", "kg_paths", "kg_neg", "genre_aff",
    "log_pop", "vote_avg", "log_votes", "year", "is_tv", "runtime", "on_platform", "in_watchlist", "mood",
]

# hand-set blend used until the learning-to-rank model has enough feedback
DEFAULT_WEIGHTS = {
    "emb_profile": 0.20, "emb_max_pos": 0.22, "emb_max_neg": -0.12, "cf": 0.18, "kg": 0.18,
    "kg_neg": -0.05, "genre_aff": 0.10, "vote_avg": 0.06, "log_votes": 0.04, "mood": 0.15,
    "in_watchlist": 0.03, "on_platform": 0.02,
}


@dataclass
class TasteInputs:
    """Everything derived from the profile that features need."""
    profile_vec: np.ndarray | None
    pos_vecs: np.ndarray            # (k, d) embeddings of liked anchors
    pos_ids: list[int]
    neg_vecs: np.ndarray
    genre_aff: dict[str, float]
    cf: dict[int, float] = field(default_factory=dict)
    kg: dict[int, dict] = field(default_factory=dict)
    watchlist: set[int] = field(default_factory=set)
    platforms: set[str] = field(default_factory=set)
    mood: str | None = None


def profile_vectors(signals: dict[int, float], vec_of) -> tuple[np.ndarray | None, np.ndarray, list[int], np.ndarray]:
    """signals: {title_id: weight in [-1, 1]}; vec_of(tid) -> unit vector or None."""
    pos, pos_ids, neg, acc, tot = [], [], [], None, 0.0
    for tid, w in sorted(signals.items(), key=lambda x: -abs(x[1])):
        v = vec_of(tid)
        if v is None:
            continue
        if w > 0.1:
            pos.append(v)
            pos_ids.append(tid)
        elif w < -0.1:
            neg.append(v)
        contrib = w if w > 0 else 0.5 * w
        acc = v * contrib if acc is None else acc + v * contrib
        tot += abs(contrib)
    prof = None
    if acc is not None and tot > 0:
        n = np.linalg.norm(acc)
        prof = (acc / n).astype(np.float32) if n > 1e-9 else None
    d = acc.shape[0] if acc is not None else 384
    as_mat = lambda xs: np.vstack(xs).astype(np.float32) if xs else np.zeros((0, d), np.float32)  # noqa: E731
    return prof, as_mat(pos[:200]), pos_ids[:200], as_mat(neg[:100])


def genre_affinity(signals: dict[int, float], genres_of: dict[int, list[str]], prior: float = 3.0) -> dict[str, float]:
    """Shrunk mean of your weights per genre, in [-1, 1]."""
    acc: dict[str, list[float]] = defaultdict(list)
    for tid, w in signals.items():
        for g in genres_of.get(tid) or []:
            acc[g].append(w)
    return {g: sum(ws) / (len(ws) + prior) for g, ws in acc.items()}


def compute(cands: dict[int, dict], vec_of, taste: TasteInputs, mood_fn=None, platforms_fn=None
            ) -> tuple[list[int], np.ndarray]:
    """-> (ids, matrix[len(ids), len(FEATURES)]) with NaN for missing values."""
    ids = list(cands)
    X = np.full((len(ids), len(FEATURES)), np.nan, dtype=np.float32)
    col = {f: i for i, f in enumerate(FEATURES)}
    for r, tid in enumerate(ids):
        t = cands[tid]
        v = vec_of(tid)
        if v is not None:
            if taste.profile_vec is not None:
                X[r, col["emb_profile"]] = float(v @ taste.profile_vec)
            if len(taste.pos_vecs):
                sims = taste.pos_vecs @ v
                # ignore self-similarity (only matters in leave-out training)
                X[r, col["emb_max_pos"]] = float(np.max(np.where(np.asarray(taste.pos_ids) == tid, -1, sims)))
            if len(taste.neg_vecs):
                X[r, col["emb_max_neg"]] = float(np.max(taste.neg_vecs @ v))
        if tid in taste.cf:
            X[r, col["cf"]] = taste.cf[tid]
        kg = taste.kg.get(tid)
        X[r, col["kg"]] = kg["score"] if kg else 0.0
        X[r, col["kg_paths"]] = math.log1p(kg["n_paths"]) if kg else 0.0
        X[r, col["kg_neg"]] = kg["neg"] if kg else 0.0
        gs = t.get("genres") or []
        if gs:
            X[r, col["genre_aff"]] = float(np.mean([taste.genre_aff.get(g, 0.0) for g in gs]))
        X[r, col["log_pop"]] = math.log1p(t.get("popularity") or 0)
        if t.get("vote_average") and (t.get("vote_count") or 0) >= 20:
            X[r, col["vote_avg"]] = t["vote_average"] / 10.0
        X[r, col["log_votes"]] = math.log1p(t.get("vote_count") or 0) / 10.0
        if t.get("year"):
            X[r, col["year"]] = (t["year"] - 1995) / 30.0
        X[r, col["is_tv"]] = 1.0 if t.get("kind") == "tv" else 0.0
        if t.get("runtime"):
            X[r, col["runtime"]] = t["runtime"] / 120.0
        if platforms_fn is not None:
            X[r, col["on_platform"]] = 1.0 if set(platforms_fn(t)) & taste.platforms else 0.0
        X[r, col["in_watchlist"]] = 1.0 if tid in taste.watchlist else 0.0
        if taste.mood and mood_fn is not None:
            X[r, col["mood"]] = mood_fn(t, taste.mood)
    return ids, X


def rank_normalise(X: np.ndarray) -> np.ndarray:
    """Per-column percentile rank in [0,1]; NaN -> 0.5 (neutral). Makes the hand blend scale-free."""
    out = np.full_like(X, 0.5)
    n = X.shape[0]
    for j in range(X.shape[1]):
        colv = X[:, j]
        ok = ~np.isnan(colv)
        if ok.sum() <= 1 or np.nanmax(colv) == np.nanmin(colv):
            continue
        order = colv[ok].argsort().argsort()
        out[ok, j] = order / max(ok.sum() - 1, 1)
    return out if n else X


def default_blend(X: np.ndarray) -> np.ndarray:
    R = rank_normalise(X)
    s = np.zeros(X.shape[0], dtype=np.float32)
    for f, w in DEFAULT_WEIGHTS.items():
        j = FEATURES.index(f)
        if f in ("in_watchlist", "on_platform", "mood"):
            s += w * np.nan_to_num(X[:, j], nan=0.0)  # already in [0, 1]
        else:
            s += w * R[:, j]
    return s
