"""Ranking pipeline tests on synthetic data (no database)."""
import numpy as np
import pytest

from cinegraph.recsys import active, bandit, features as F
from cinegraph.recsys.catalog import mood_score, platform_of
from cinegraph.recsys.filters import blocked_reason
from cinegraph.recsys.graph import Path

rng = np.random.default_rng(0)
D = 32


def unit(v):
    return (v / np.linalg.norm(v)).astype(np.float32)


# two taste directions: "tense crime" (liked) and "romcom-ish" (disliked)
LIKED_DIR, DISLIKED_DIR = unit(rng.normal(size=D)), unit(rng.normal(size=D))


class Emb:
    def __init__(self):
        self.vecs = {}

    def add(self, tid, base, noise=0.15):
        self.vecs[tid] = unit(base + noise * rng.normal(size=D))

    def vec(self, tid):
        return self.vecs.get(tid)


@pytest.fixture
def world():
    e = Emb()
    for t in range(1, 6):        # anchors you liked
        e.add(t, LIKED_DIR)
    for t in range(6, 9):        # anchors you disliked
        e.add(t, DISLIKED_DIR)
    e.add(100, LIKED_DIR)        # candidate near liked
    e.add(101, DISLIKED_DIR)     # candidate near disliked
    e.add(102, unit(rng.normal(size=D)), noise=0)  # unrelated
    signals = {**{t: 1.0 for t in range(1, 6)}, **{t: -1.0 for t in range(6, 9)}}
    meta = {t: {"id": t, "kind": "movie", "genres": ["Crime"] if t <= 5 else ["Romance"]} for t in range(1, 9)}
    cands = {
        100: {"id": 100, "kind": "movie", "genres": ["Crime", "Thriller"], "popularity": 10, "vote_average": 7.5,
              "vote_count": 500, "year": 2010, "runtime": 110},
        101: {"id": 101, "kind": "movie", "genres": ["Romance"], "popularity": 50, "vote_average": 7.0,
              "vote_count": 900, "year": 2015, "runtime": 100},
        102: {"id": 102, "kind": "tv", "genres": ["Documentary"], "popularity": 30, "vote_average": 7.2,
              "vote_count": 300, "year": 2020, "runtime": 45},
    }
    return e, signals, meta, cands


def taste_for(e, signals, meta, **kw):
    prof, pos, pos_ids, neg = F.profile_vectors(signals, e.vec)
    return F.TasteInputs(profile_vec=prof, pos_vecs=pos, pos_ids=pos_ids, neg_vecs=neg,
                         genre_aff=F.genre_affinity(signals, {t: m["genres"] for t, m in meta.items()}), **kw)


def test_profile_points_towards_liked(world):
    e, signals, meta, _ = world
    prof, pos, _, neg = F.profile_vectors(signals, e.vec)
    assert prof @ LIKED_DIR > 0.5 > prof @ DISLIKED_DIR
    assert len(pos) == 5 and len(neg) == 3


def test_genre_affinity_sign(world):
    _, signals, meta, _ = world
    ga = F.genre_affinity(signals, {t: m["genres"] for t, m in meta.items()})
    assert ga["Crime"] > 0 > ga["Romance"]


def test_default_blend_ranks_liked_neighbour_first(world):
    e, signals, meta, cands = world
    taste = taste_for(e, signals, meta, cf={100: 0.9, 101: 0.1})
    ids, X = F.compute(cands, e.vec, taste)
    assert X.shape == (3, len(F.FEATURES))
    order = [ids[i] for i in np.argsort(-F.default_blend(X))]
    assert order[0] == 100 and order[-1] in (101, 102)
    # missing CF for the series is NaN, not 0
    assert np.isnan(X[ids.index(102), F.FEATURES.index("cf")])


def test_kg_paths_feed_features(world):
    e, signals, meta, cands = world
    p = Path(1, "Pulp Fiction", "which you rated 5", "written_by", "Quentin Tarantino", "person", 0.9)
    taste = taste_for(e, signals, meta, kg={102: {"score": 0.9, "n_paths": 3, "best": p, "neg": 0.0}})
    ids, X = F.compute(cands, e.vec, taste)
    assert X[ids.index(102), F.FEATURES.index("kg")] == pytest.approx(0.9)
    assert p.explain() == "Same writer (Quentin Tarantino) as Pulp Fiction, which you rated 5"


def test_rank_normalise_neutral_nan():
    X = np.array([[1.0, np.nan], [3.0, np.nan], [2.0, 5.0]], dtype=np.float32)
    R = F.rank_normalise(X)
    assert list(R[:, 0]) == [0.0, 1.0, 0.5]
    assert list(R[:, 1]) == [0.5, 0.5, 0.5]


def test_ltr_learns_a_signal():
    lgb = pytest.importorskip("lightgbm")
    n = 300
    X = rng.normal(size=(n, len(F.FEATURES))).astype(np.float32)
    y = np.clip(np.round(1.5 + 1.5 * X[:, F.FEATURES.index("kg")] + 0.2 * rng.normal(size=n)), 0, 3).astype(int)
    m = lgb.LGBMRanker(objective="lambdarank", n_estimators=60, min_child_samples=5, verbose=-1)
    m.fit(X, y, group=[60] * 5)
    s = m.predict(X)
    assert np.corrcoef(s, X[:, F.FEATURES.index("kg")])[0, 1] > 0.8


def test_hard_filters():
    assert blocked_reason({"kind": "movie", "title": "Love Actually", "genres": ["Comedy", "Romance", "Drama"]}) == "romance"
    assert blocked_reason({"kind": "movie", "title": "Notebook", "genres": ["Romance", "Drama"]}) == "romance"
    # a thriller with a love story is fine
    assert blocked_reason({"kind": "movie", "title": "X", "genres": ["Thriller", "Romance", "Crime"]}) is None
    assert blocked_reason({"kind": "movie", "title": "La La", "genres": ["Drama"], "keywords": ["musical"]}) == "musical"
    assert blocked_reason({"kind": "tv", "title": "Friends", "genres": ["Comedy"]}) == "laugh-track sitcom"
    assert blocked_reason({"kind": "tv", "title": "Y", "genres": ["Comedy"], "keywords": ["laugh track"]}) is not None
    # single-camera comedies stay
    assert blocked_reason({"kind": "tv", "title": "Fleabag", "genres": ["Comedy", "Drama"], "keywords": ["sitcom"]}) is None
    assert blocked_reason({"kind": "movie", "title": "Pulp Fiction", "genres": ["Thriller", "Crime"]}) is None


def test_moods_and_platforms():
    assert mood_score({"genres": ["Comedy"], "keywords": ["dark comedy"]}, "laugh") > 0.7
    assert mood_score({"genres": ["Drama"], "keywords": []}, "laugh") == 0
    assert mood_score({"genres": ["Horror"], "keywords": []}, "horror") > 0
    assert mood_score({"genres": ["Science Fiction"], "keywords": ["time travel"]}, "mind") > 0.7
    assert platform_of("Netflix Standard with Ads") == "Netflix"
    assert platform_of("Amazon Prime Video") == "Prime Video"
    assert platform_of("Disney Plus") == "Disney+"
    assert platform_of("Max") == "HBO Max"
    assert platform_of("Canal+ Séries") == "Canal+"
    assert platform_of("Apple TV Plus") == "Apple TV+"
    assert platform_of("Apple TV") is None   # the rental store, not the subscription


def test_active_learning_prefers_uncertain_and_uncovered():
    n, d = 400, 8
    Z = rng.normal(size=(n, d)).astype(np.float32)
    Z /= np.linalg.norm(Z, axis=1, keepdims=True)
    deck = active.Deck(ids=np.arange(1, n + 1), Z=Z, pop_pct=np.ones(n, np.float32), kinds=np.array(["movie"] * n))
    # label 30 cards all clustered around one direction
    d0 = Z[0]
    near = np.argsort(-(Z @ d0))[:30]
    swiped = {int(i + 1): "like" for i in near}
    picks = [active.choose(deck, swiped, set(), set(), np.random.default_rng(s))[0] for s in range(10)]
    sims = [float(Z[p - 1] @ d0) for p in picks]
    # next cards should be far from the explored region
    assert np.mean(sims) < 0.2
    assert not set(picks) & set(swiped)


def test_active_learning_posterior_shrinks():
    Z = np.eye(4, dtype=np.float32)
    _, S0 = active.posterior(np.zeros((0, 4), np.float32), np.zeros(0))
    _, S1 = active.posterior(Z[:1], np.array([1.0]))
    assert S1[0, 0] < S0[0, 0] and S1[1, 1] == pytest.approx(S0[1, 1])


def test_p_seen_leans_popular_after_unseen_swipes():
    pop = np.array([0.1, 0.9])
    assert active.p_seen(pop, 0.8)[0] < active.p_seen(pop, 0.0)[0]
    assert active.p_seen(pop, 0.8)[1] > 0.5


def test_bandit_pick_explore(monkeypatch):
    monkeypatch.setattr(bandit, "load_clusters", lambda: {1: 0, 2: 0, 3: 1, 4: 2})
    monkeypatch.setattr(bandit, "sample_arms", lambda rng=None: [2, 1, 0])
    picks = bandit.pick_explore([1, 2, 3, 4], {}, 2, exclude={4})
    assert picks == [(3, 1), (1, 0)]
