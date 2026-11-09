"""Exploration budget: Thompson sampling over clusters of the embedding space.

Each cluster is an arm with a Beta(alpha, beta) posterior of "you like what I show you from
here". A small share of each recommendation list (EXPLORE_SHARE) is filled by sampling arms,
so the recommender keeps probing corners of the catalogue it knows little about.
"""
from __future__ import annotations

import logging
from functools import lru_cache

import numpy as np

from .. import db
from ..config import get_settings

log = logging.getLogger(__name__)

N_CLUSTERS = 24
EXPLORE_SHARE = 0.12


def build_clusters(k: int = N_CLUSTERS) -> dict:
    from sklearn.cluster import MiniBatchKMeans

    from .embeddings import load_matrix

    ids, m = load_matrix()
    if len(ids) < k * 3:
        return {"clusters": 0}
    km = MiniBatchKMeans(n_clusters=k, random_state=0, n_init=3, batch_size=2048).fit(m)
    np.savez_compressed(get_settings().models_dir / "clusters.npz", ids=ids, labels=km.labels_,
                        centroids=km.cluster_centers_.astype(np.float32))
    with db.connect() as conn:
        for a in range(k):
            conn.execute("INSERT INTO bandit_arms (arm) VALUES (%s) ON CONFLICT DO NOTHING", (a,))
        conn.execute("DELETE FROM bandit_arms WHERE arm >= %s", (k,))
        conn.commit()
    load_clusters.cache_clear()
    return {"clusters": k, "titles": int(len(ids))}


@lru_cache
def load_clusters() -> dict[int, int]:
    p = get_settings().models_dir / "clusters.npz"
    if not p.exists():
        return {}
    z = np.load(p)
    return {int(t): int(c) for t, c in zip(z["ids"], z["labels"])}


def arm_of(title_id: int) -> int | None:
    return load_clusters().get(title_id)


def sample_arms(rng: np.random.Generator | None = None) -> list[int]:
    """Arms ordered by a Thompson draw (best first)."""
    rng = rng or np.random.default_rng()
    rows = db.fetchall("SELECT arm, alpha, beta FROM bandit_arms")
    if not rows:
        return []
    draws = [(rng.beta(r["alpha"], r["beta"]), r["arm"]) for r in rows]
    return [a for _, a in sorted(draws, reverse=True)]


def update(title_id: int, reward: float) -> None:
    """reward in [0, 1]; fractional rewards split between alpha and beta."""
    arm = arm_of(title_id)
    if arm is None:
        return
    db.execute("UPDATE bandit_arms SET alpha = alpha + %s, beta = beta + %s WHERE arm = %s",
               (reward, 1.0 - reward, arm))


def pick_explore(ranked: list[int], scores: dict[int, float], n_slots: int, exclude: set[int],
                 rng: np.random.Generator | None = None) -> list[tuple[int, int]]:
    """Choose up to n_slots (title_id, arm) from below the exploit cut, one per sampled arm."""
    clusters = load_clusters()
    if not clusters or n_slots <= 0:
        return []
    by_arm: dict[int, list[int]] = {}
    for tid in ranked:
        if tid in exclude:
            continue
        a = clusters.get(tid)
        if a is not None:
            by_arm.setdefault(a, []).append(tid)  # ranked order => best first within arm
    out = []
    for arm in sample_arms(rng):
        if arm in by_arm:
            out.append((by_arm[arm][0], arm))
            if len(out) >= n_slots:
                break
    return out
