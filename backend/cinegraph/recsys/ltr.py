"""Learning-to-rank: a LightGBM LambdaRank model learns how to blend the signals
(embedding similarity, CF, graph paths, genre affinity, quality...) from your feedback.

Training examples come from two places:
  1. Your ratings / swipes, scored with k-fold leave-out profiles (features for a held-out
     title are computed from a profile that doesn't contain it, so there's no leakage).
  2. Logged impressions (features at serve time) that later got feedback.
Until there are enough labelled examples, `features.default_blend` is used instead.
"""
from __future__ import annotations

import json
import logging
from functools import lru_cache

import numpy as np

from .. import db
from ..config import get_settings
from .features import FEATURES

log = logging.getLogger(__name__)

MIN_EXAMPLES = 30
FOLDS = 5


def grade(rating: float | None, kind: str) -> int | None:
    """Relevance grade 0..3."""
    if kind == "love":
        return 3
    if kind == "like":
        return 2
    if kind in ("dislike", "hidden"):
        return 0
    if rating is None:
        return None
    if rating >= 4.5:
        return 3
    if rating >= 3.5:
        return 2
    if rating >= 2.5:
        return 1
    return 0


def _model_path():
    return get_settings().models_dir / "ltr.txt"


def build_training_set(seed: int = 0) -> tuple[np.ndarray, np.ndarray, list[int]]:
    from .pipeline import build_taste
    from .catalog import emb_index, titles_by_id
    from .features import compute
    from .catalog import mood_score, platforms_for
    from .profile import load_profile

    prof = load_profile()
    labelled = {t: g for t, s in prof.signals.items() if (g := grade(s.rating, s.kind)) is not None}
    Xs, ys, groups = [], [], []
    if len(labelled) >= MIN_EXAMPLES // 2:
        rng = np.random.default_rng(seed)
        ids = np.array(list(labelled))
        folds = rng.integers(0, FOLDS, size=len(ids))
        idx = emb_index()
        meta = titles_by_id(list(ids))
        for f in range(FOLDS):
            held = set(ids[folds == f].tolist())
            if not held:
                continue
            taste = build_taste(prof, exclude=held, candidate_ids=list(held))
            cands = {t: meta[t] for t in held if t in meta}
            cid, X = compute(cands, idx.vec, taste, mood_score, platforms_for)
            Xs.append(X)
            ys.append(np.array([labelled[t] for t in cid]))
            groups.append(len(cid))

    # impressions that later received feedback
    rows = db.fetchall(
        """SELECT i.request_id, i.title_id, i.features FROM impressions i
           WHERE i.shown_at > now() - interval '180 days' ORDER BY i.request_id, i.position""")
    by_req: dict[str, list] = {}
    for r in rows:
        s = prof.signals.get(r["title_id"])
        g = grade(s.rating, s.kind) if s else (1 if r["title_id"] in prof.watchlist else None)
        if g is None:
            continue
        by_req.setdefault(r["request_id"], []).append((r["features"], g))
    for items in by_req.values():
        if len(items) < 2:
            continue
        Xs.append(np.array([[f.get(k, np.nan) if f.get(k) is not None else np.nan for k in FEATURES]
                            for f, _ in items], dtype=np.float32))
        ys.append(np.array([g for _, g in items]))
        groups.append(len(items))
    if not Xs:
        return np.zeros((0, len(FEATURES))), np.zeros(0), []
    return np.vstack(Xs), np.concatenate(ys), groups


def train() -> dict:
    import lightgbm as lgb

    X, y, groups = build_training_set()
    if len(y) < MIN_EXAMPLES or len(set(y.tolist())) < 2:
        return {"trained": False, "examples": int(len(y)),
                "reason": f"need >= {MIN_EXAMPLES} labelled titles with mixed grades"}
    model = lgb.LGBMRanker(objective="lambdarank", n_estimators=150, learning_rate=0.05, num_leaves=15,
                           min_child_samples=5, subsample=0.9, colsample_bytree=0.9, random_state=0, verbose=-1)
    model.fit(X, y, group=groups)
    model.booster_.save_model(str(_model_path()))
    imp = dict(zip(FEATURES, model.booster_.feature_importance("gain").round(1).tolist()))
    db.set_job_state("ltr", {"examples": int(len(y)), "groups": len(groups), "importance": imp})
    load_model.cache_clear()
    log.info("LTR trained on %d examples / %d groups", len(y), len(groups))
    return {"trained": True, "examples": int(len(y)), "groups": len(groups), "importance": imp}


@lru_cache
def load_model():
    p = _model_path()
    if not p.exists():
        return None
    import lightgbm as lgb

    return lgb.Booster(model_file=str(p))


def predict(X: np.ndarray) -> np.ndarray | None:
    m = load_model()
    if m is None or len(X) == 0:
        return None
    return m.predict(X)


def feature_dict(row: np.ndarray) -> dict:
    return {f: (None if np.isnan(v) else round(float(v), 4)) for f, v in zip(FEATURES, row)}


def dumps_features(row: np.ndarray) -> str:
    return json.dumps(feature_dict(row))
