"""Collaborative filtering: implicit-feedback ALS (Hu, Koren & Volinsky 2008) trained on
MovieLens ratings plus your own, via the `implicit` library.

Your user vector is *folded in* at request time from the saved item factors, so every new
rating or swipe changes CF scores immediately; the item factors are retrained nightly.
MovieLens only covers films, so series get no CF score (the ranker treats it as missing).
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from functools import lru_cache

import numpy as np
import scipy.sparse as sp

from .. import db
from ..config import get_settings

log = logging.getLogger(__name__)

FACTORS = 64
REG = 0.05


def confidence(r: np.ndarray) -> np.ndarray:
    """Explicit 0.5-5 stars -> implicit confidence; below 3 stars is not a positive signal."""
    return np.where(r >= 3.0, 1.0 + 4.0 * (r - 2.5), 0.0).astype(np.float32)


def train(iterations: int = 15, factors: int = FACTORS) -> dict:
    from implicit.als import AlternatingLeastSquares

    from .profile import load_profile

    s = get_settings()
    variant = db.get_job_state("movielens").get("variant", s.movielens_variant)
    path = s.data_dir / "movielens" / variant / "ratings.npz"
    if not path.exists():
        raise FileNotFoundError(f"{path} missing; run `cinegraph ingest movielens` first")
    z = np.load(path)
    users, items, ratings = z["user"], z["title_id"], z["rating"]

    # append the app user as one more row
    prof = load_profile()
    mine = [(tid, sig.rating) for tid, sig in prof.signals.items() if sig.rating is not None and sig.rating >= 3]
    me = int(users.max()) + 1 if len(users) else 0
    if mine:
        users = np.concatenate([users, np.full(len(mine), me, dtype=users.dtype)])
        items = np.concatenate([items, np.asarray([m[0] for m in mine], dtype=items.dtype)])
        ratings = np.concatenate([ratings, np.asarray([m[1] for m in mine], dtype=ratings.dtype)])

    conf = confidence(ratings)
    keep = conf > 0
    item_ids, item_idx = np.unique(items[keep], return_inverse=True)
    user_ids, user_idx = np.unique(users[keep], return_inverse=True)
    m = sp.csr_matrix((conf[keep], (user_idx, item_idx)), shape=(len(user_ids), len(item_ids)))
    model = AlternatingLeastSquares(factors=factors, regularization=REG, iterations=iterations,
                                    random_state=42, calculate_training_loss=False)
    model.fit(m, show_progress=False)
    item_factors = np.asarray(model.item_factors)
    if hasattr(item_factors, "to_numpy"):
        item_factors = item_factors.to_numpy()
    out = s.models_dir / "als.npz"
    np.savez_compressed(out, item_ids=item_ids.astype(np.int64), item_factors=item_factors.astype(np.float32),
                        reg=np.float32(REG))
    load_model.cache_clear()
    log.info("ALS trained: %d users x %d items, %d interactions", m.shape[0], m.shape[1], m.nnz)
    return {"users": int(m.shape[0]), "items": int(m.shape[1]), "nnz": int(m.nnz)}


@dataclass
class CFModel:
    item_ids: np.ndarray
    Y: np.ndarray          # item factors (n_items, f)
    YtY: np.ndarray
    reg: float
    index: dict[int, int]

    def fold_in(self, rated: dict[int, float]) -> np.ndarray | None:
        """Least-squares user vector from {title_id: stars}."""
        idx, conf = [], []
        for tid, r in rated.items():
            j = self.index.get(tid)
            c = float(confidence(np.asarray([r]))[0])
            if j is not None and c > 0:
                idx.append(j)
                conf.append(c)
        if not idx:
            return None
        Yu = self.Y[idx]
        cu = np.asarray(conf, dtype=np.float32)
        A = self.YtY + (Yu.T * (cu - 1.0)) @ Yu + self.reg * np.eye(self.Y.shape[1], dtype=np.float32)
        b = (Yu.T * cu).sum(axis=1)
        return np.linalg.solve(A, b).astype(np.float32)

    def scores(self, user_vec: np.ndarray, title_ids: list[int]) -> dict[int, float]:
        out = {}
        for tid in title_ids:
            j = self.index.get(tid)
            if j is not None:
                out[tid] = float(self.Y[j] @ user_vec)
        return out

    def top(self, user_vec: np.ndarray, n: int, exclude: set[int]) -> list[tuple[int, float]]:
        s = self.Y @ user_vec
        order = np.argsort(-s)
        res = []
        for j in order:
            tid = int(self.item_ids[j])
            if tid not in exclude:
                res.append((tid, float(s[j])))
                if len(res) >= n:
                    break
        return res

    def nearest_anchor(self, tid: int, anchors: list[int]) -> tuple[int, float] | None:
        j = self.index.get(tid)
        if j is None:
            return None
        v = self.Y[j] / (np.linalg.norm(self.Y[j]) + 1e-9)
        best = None
        for a in anchors:
            k = self.index.get(a)
            if k is None or a == tid:
                continue
            sim = float(v @ (self.Y[k] / (np.linalg.norm(self.Y[k]) + 1e-9)))
            if best is None or sim > best[1]:
                best = (a, sim)
        return best


@lru_cache
def load_model() -> CFModel | None:
    path = get_settings().models_dir / "als.npz"
    if not path.exists():
        return None
    z = np.load(path)
    Y = z["item_factors"].astype(np.float32)
    ids = z["item_ids"]
    return CFModel(item_ids=ids, Y=Y, YtY=Y.T @ Y, reg=float(z["reg"]),
                   index={int(t): i for i, t in enumerate(ids)})
