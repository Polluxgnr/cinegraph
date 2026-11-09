"""Active learning for the swipe deck: pick the card that teaches us the most.

Model: Bayesian linear regression of your taste y (love 1, like 0.6, dislike -1) on a
PCA-reduced embedding x. Posterior covariance S = (lambda*I + X^T X / sigma^2)^-1.

  next card = argmax  p_seen(x) * [ sqrt(x^T S x)              (uncertainty)
                                   + c * dist_to_swiped(x)       (coverage of the space)
                                   + e * |mu^T x| ]              (a little exploitation)

p_seen grows with popularity and adapts to your recent "not seen" rate, so the deck
starts with titles you probably know (a "not seen" swipe teaches nothing about taste).
Films and series alternate to keep the profile half and half. ~50 swipes give a profile.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from .. import db
from . import filters
from .catalog import emb_index, titles_by_id
from .profile import load_profile

Y_OF = {"love": 1.0, "like": 0.6, "dislike": -1.0}
PCA_DIM = 48
POOL = 3000
LAMBDA, SIGMA2 = 1.0, 0.5


@dataclass
class Deck:
    ids: np.ndarray
    Z: np.ndarray          # reduced, centred embeddings
    pop_pct: np.ndarray    # popularity percentile in pool
    kinds: np.ndarray


_deck_cache: dict = {}


def _build_deck() -> Deck | None:
    idx = emb_index()
    if len(idx) == 0:
        return None
    key = (len(idx), int(idx.ids[-1]))
    if _deck_cache.get("key") == key:
        return _deck_cache["deck"]
    rows = db.fetchall(
        """
        SELECT t.id, t.kind, t.title, t.genres, t.keywords FROM titles t JOIN title_embeddings e ON e.title_id = t.id
        WHERE t.kind IN ('movie', 'tv')
        ORDER BY COALESCE(t.popularity, 0) + ln(1 + COALESCE(t.vote_count, 0)) DESC
        LIMIT %s
        """, (POOL,))
    rows = [r for r in rows if filters.allowed(r)]
    ids = np.array([r["id"] for r in rows], dtype=np.int64)
    X = np.vstack([idx.vec(int(t)) for t in ids])
    Xc = X - X.mean(axis=0)
    # PCA via SVD on the pool
    _, _, vt = np.linalg.svd(Xc, full_matrices=False)
    Z = Xc @ vt[:PCA_DIM].T
    Z /= np.maximum(np.linalg.norm(Z, axis=1, keepdims=True), 1e-9)
    kinds = np.array([r["kind"] for r in rows])
    # popularity percentile within each kind (rows are popularity-ordered; film and series
    # popularity come from different sources before the TMDB crawl, so don't mix them)
    pop_pct = np.zeros(len(ids), dtype=np.float32)
    for k in ("movie", "tv"):
        sel = np.where(kinds == k)[0]
        if len(sel):
            pop_pct[sel] = 1.0 - np.arange(len(sel)) / max(len(sel) - 1, 1)
    deck = Deck(ids=ids, Z=Z.astype(np.float32), pop_pct=pop_pct, kinds=kinds)
    _deck_cache.update(key=key, deck=deck)
    return deck


def posterior(Zs: np.ndarray, ys: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    d = Zs.shape[1]
    A = LAMBDA * np.eye(d) + (Zs.T @ Zs) / SIGMA2
    S = np.linalg.inv(A)
    mu = S @ (Zs.T @ ys) / SIGMA2
    return mu, S


def p_seen(pop_pct: np.ndarray, unseen_rate: float) -> np.ndarray:
    # the more "not seen" swipes, the more we lean on very popular titles
    k = 4.0 + 10.0 * unseen_rate
    return 1.0 / (1.0 + np.exp(-k * (pop_pct - (0.35 + 0.5 * unseen_rate))))


def choose(deck: Deck, swiped: dict[int, str], rated: set[int], seen_titles: set[int],
           rng: np.random.Generator | None = None, kind: str | None = None) -> tuple[int, dict] | None:
    rng = rng or np.random.default_rng()
    pos = {int(t): i for i, t in enumerate(deck.ids)}
    lab = [(pos[t], Y_OF[a]) for t, a in swiped.items() if a in Y_OF and t in pos]
    lab += [(pos[t], 0.6) for t in rated if t in pos and t not in swiped]
    if lab:
        Zs = deck.Z[[i for i, _ in lab]]
        mu, S = posterior(Zs, np.array([y for _, y in lab]))
    else:
        Zs = np.zeros((0, deck.Z.shape[1]), np.float32)
        mu, S = np.zeros(deck.Z.shape[1]), np.eye(deck.Z.shape[1]) / LAMBDA
    unc = np.sqrt(np.einsum("ij,jk,ik->i", deck.Z, S, deck.Z))
    touched = [pos[t] for t in list(swiped) + list(seen_titles) if t in pos]
    if touched:
        sims = deck.Z @ deck.Z[touched].T
        cover = 1.0 - sims.max(axis=1)
    else:
        cover = np.ones(len(deck.ids))
    recent = list(swiped.values())[-20:]
    unseen_rate = (sum(a == "unseen" for a in recent) / len(recent)) if recent else 0.3
    ps = p_seen(deck.pop_pct, unseen_rate)
    score = ps * (unc + 0.6 * cover + 0.15 * np.abs(deck.Z @ mu))
    mask = np.ones(len(deck.ids), bool)
    for t in list(swiped) + list(rated) + list(seen_titles):
        if t in pos:
            mask[pos[t]] = False
    if kind:
        mask &= deck.kinds == kind
    if not mask.any():
        return None
    score = np.where(mask, score, -np.inf)
    # sample among the top 5 to avoid a deterministic, repetitive deck
    top = np.argsort(-score)[:5]
    top = top[np.isfinite(score[top])]
    w = np.exp((score[top] - score[top].max()) * 8)
    j = int(rng.choice(top, p=w / w.sum()))
    info = {"uncertainty": round(float(unc[j]), 3), "coverage": round(float(cover[j]), 3),
            "p_seen": round(float(ps[j]), 3), "predicted": round(float(deck.Z[j] @ mu), 3),
            "n_labels": len(lab)}
    return int(deck.ids[j]), info


def next_card(rng: np.random.Generator | None = None, exclude: set[int] | None = None) -> dict | None:
    deck = _build_deck()
    if deck is None:
        return None
    prof = load_profile()
    swipes = db.fetchall("SELECT DISTINCT ON (title_id) title_id, action, created_at FROM swipes "
                         "ORDER BY title_id, created_at DESC")
    swipes.sort(key=lambda r: r["created_at"])
    swiped = {r["title_id"]: r["action"] for r in swipes}
    for t in exclude or set():
        swiped.setdefault(t, "skip")
    # alternate films / series: pick the kind with fewer labelled swipes
    n_movie = sum(1 for t, a in swiped.items() if a in Y_OF and t in set(deck.ids[deck.kinds == "movie"].tolist()))
    n_tv = sum(1 for t, a in swiped.items() if a in Y_OF) - n_movie
    kind = "tv" if n_tv < n_movie else "movie"
    res = choose(deck, swiped, set(prof.rated), prof.seen, rng, kind) or choose(deck, swiped, set(prof.rated),
                                                                                prof.seen, rng, None)
    if res is None:
        return None
    tid, info = res
    t = titles_by_id([tid])[tid]
    labelled = sum(1 for a in swiped.values() if a in Y_OF) + len(prof.rated)
    return {"title": t, "why": info, "progress": {"labelled": labelled, "target": 50,
                                                  "swipes": len([a for a in swiped.values() if a != "skip"])}}


def expected_information(n_labels: int) -> float:
    """Rough share of the 50-swipe calibration target reached (UI progress bar)."""
    return min(1.0, math.sqrt(n_labels / 50.0))
