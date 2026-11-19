"""Offline evaluation: does the recommender find films people actually liked?

Protocol (leave-some-out on MovieLens):
  * positives = ratings >= 4; test users = up to `n_users` people with >= 15 positives
  * for each test user, 20 % of positives are hidden; everything else (all other users, and the rest of the
    test users' ratings) trains the models
  * each method ranks the catalogue films the user hasn't rated; we measure whether the hidden ones come back:
    HR@10 (at least one hidden film in the top 10), NDCG@10 (how high), Recall@20 (what share)

Methods: most popular, content (mean embedding of the user's known positives, cosine), ALS (implicit
collaborative filtering), and the hybrid the app uses (blend of the three). Hybrid weights are chosen on half
of the test users and reported on the other half, so the headline number isn't tuned on itself.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass

import numpy as np
import scipy.sparse as sp

log = logging.getLogger(__name__)
K = 10


@dataclass
class Split:
    train: sp.csr_matrix      # users x items confidence
    known: list[np.ndarray]   # per test user: item indices visible to the models
    known_r: list[np.ndarray]  # their ratings (for replaying the app engine)
    hidden: list[np.ndarray]  # per test user: held-out positive item indices
    test_rows: np.ndarray     # row of each test user in `train`


def make_split(users: np.ndarray, items: np.ndarray, ratings: np.ndarray, n_items: int, n_users: int = 2000,
               min_pos: int = 15, hide: float = 0.2, seed: int = 7) -> Split:
    rng = np.random.default_rng(seed)
    uid, urow = np.unique(users, return_inverse=True)
    conf = np.where(ratings >= 3.0, 1.0 + 4.0 * (ratings - 2.5), 0.0).astype(np.float32)
    pos = ratings >= 4.0
    counts = np.bincount(urow[pos], minlength=len(uid))
    eligible = np.nonzero(counts >= min_pos)[0]
    test = rng.choice(eligible, size=min(n_users, len(eligible)), replace=False)
    is_test = np.zeros(len(uid), dtype=bool)
    is_test[test] = True
    hide_mask = np.zeros(len(ratings), dtype=bool)
    order = np.argsort(urow, kind="stable")
    bounds = np.searchsorted(urow[order], np.arange(len(uid) + 1))
    known, known_r, hidden = [], [], []
    for u in test:
        idx = order[bounds[u]:bounds[u + 1]]
        p = idx[pos[idx]]
        h = rng.choice(p, size=max(1, int(len(p) * hide)), replace=False)
        hide_mask[h] = True
        hidden.append(items[h])
        k = idx[(conf[idx] > 0) & ~np.isin(idx, h)]
        known.append(items[k])
        known_r.append(ratings[k])
    keep = (conf > 0) & ~hide_mask
    train = sp.csr_matrix((conf[keep], (urow[keep], items[keep])), shape=(len(uid), n_items))
    return Split(train, known, known_r, hidden, test)


def _metrics(scores: np.ndarray, known: np.ndarray, hidden: np.ndarray) -> tuple[float, float, float]:
    s = scores.copy()
    s[known] = -np.inf
    top = np.argpartition(-s, 20)[:20]
    top = top[np.argsort(-s[top])]
    hits10 = np.isin(top[:K], hidden)
    hr = float(hits10.any())
    dcg = float((hits10 / np.log2(np.arange(2, K + 2))).sum())
    idcg = float((1 / np.log2(np.arange(2, min(len(hidden), K) + 2))).sum())
    rec = float(np.isin(top, hidden).sum() / min(len(hidden), 20))
    return hr, dcg / idcg, rec


def _z(x: np.ndarray) -> np.ndarray:
    return (x - x.mean()) / (x.std() + 1e-9)


def evaluate(users: np.ndarray, items: np.ndarray, ratings: np.ndarray, n_items: int,
             item_vecs: np.ndarray | None = None, n_users: int = 2000, factors: int = 64, iterations: int = 15,
             seed: int = 7) -> dict:
    """`items` are 0..n_items-1 indices; `item_vecs` (n_items x d, unit rows) enables content and hybrid."""
    from implicit.als import AlternatingLeastSquares

    split = make_split(users, items, ratings, n_items, n_users=n_users, seed=seed)
    model = AlternatingLeastSquares(factors=factors, regularization=0.05, iterations=iterations, random_state=seed,
                                    calculate_training_loss=False)
    model.fit(split.train, show_progress=False)
    U, V = np.asarray(model.user_factors), np.asarray(model.item_factors)
    popularity = np.asarray((split.train > 0).sum(axis=0)).ravel().astype(np.float32)
    pop_log = np.log1p(popularity)

    per: dict[str, list[tuple[float, float, float]]] = {"popular": [], "content": [], "als": []}
    raw: list[tuple[np.ndarray, np.ndarray | None, np.ndarray]] = []
    for i, row in enumerate(split.test_rows):
        known, hidden = split.known[i], split.hidden[i]
        als = V @ U[row]
        content = None
        if item_vecs is not None and len(known):
            prof = item_vecs[known].mean(axis=0)
            content = item_vecs @ (prof / (np.linalg.norm(prof) + 1e-9))
            per["content"].append(_metrics(content, known, hidden))
        per["popular"].append(_metrics(pop_log, known, hidden))
        per["als"].append(_metrics(als, known, hidden))
        raw.append((als, content, pop_log))

    # hybrid: pick blend weights on the first half of test users, report on the second half
    half = len(raw) // 2
    grid = [(1.0, c, p) for c in (0.0, 0.15, 0.3, 0.5) for p in (0.0, 0.1, 0.25)]

    def blend(w, j):
        als, content, pop = raw[j]
        x = w[0] * _z(als) + w[2] * _z(pop)
        return x + (w[1] * _z(content) if content is not None else 0)

    def score(w, rows):
        return np.mean([_metrics(blend(w, j), split.known[j], split.hidden[j])[1] for j in rows])

    best = max(grid, key=lambda w: score(w, range(half)))
    report = range(half, len(raw))
    per["hybrid"] = [_metrics(blend(best, j), split.known[j], split.hidden[j]) for j in report]
    for k in ("popular", "content", "als"):
        per[k] = [per[k][j] for j in report if j < len(per[k])]

    out = {"users": len(report), "items": n_items, "protocol": "20% of positives (>=4/5) hidden per user; metrics on held-out half",
           "hybrid_weights": {"als": best[0], "content": best[1], "popularity": best[2]}}
    for k, v in per.items():
        if v:
            a = np.asarray(v)
            out[k] = {"hr10": round(float(a[:, 0].mean()), 4), "ndcg10": round(float(a[:, 1].mean()), 4), "recall20": round(float(a[:, 2].mean()), 4)}
    log.info("evaluation: %s", {k: out[k] for k in ("popular", "content", "als", "hybrid") if k in out})
    return out


def run(n_users: int = 2000) -> dict:
    """Evaluate on the downloaded MovieLens ratings, restricted to catalogue films with embeddings."""
    import json

    from .. import db
    from ..config import get_settings

    s = get_settings()
    z = np.load(s.data_dir / "movielens" / s.movielens_variant / "ratings.npz")
    rows = db.fetchall("SELECT e.title_id, e.embedding FROM title_embeddings e")
    ids = np.array([r["title_id"] for r in rows], dtype=np.int64)
    vecs = np.vstack([np.asarray(r["embedding"].to_numpy() if hasattr(r["embedding"], "to_numpy") else r["embedding"], dtype=np.float32) for r in rows])
    vecs /= np.linalg.norm(vecs, axis=1, keepdims=True) + 1e-9
    lut = {int(t): i for i, t in enumerate(ids)}
    tid = z["title_id"].astype(np.int64)
    keep = np.isin(tid, ids)
    items = np.array([lut[int(t)] for t in tid[keep]], dtype=np.int64)
    res = evaluate(z["user"][keep], items, z["rating"][keep], len(ids), vecs, n_users=n_users)
    path = s.data_dir / "eval.json"
    path.write_text(json.dumps(res, indent=1))
    # held-out users for replaying the in-browser engine (kept in the CI workspace, never published)
    split = make_split(z["user"][keep], items, z["rating"][keep], len(ids), n_users=300, seed=11)
    users = [{"known": [[int(ids[i]), float(r)] for i, r in zip(k, kr)], "hidden": [int(ids[i]) for i in h]}
             for k, kr, h in zip(split.known, split.known_r, split.hidden)]
    (s.data_dir / "eval_users.json").write_text(json.dumps(users))
    return res
