"""The offline evaluation must rank a real signal above chance: on synthetic taste clusters, collaborative
filtering and the hybrid beat "most popular"."""
import numpy as np

from cinegraph.recsys.evaluate import evaluate, make_split


def synthetic(n_users=600, n_items=300, clusters=6, seed=1):
    rng = np.random.default_rng(seed)
    item_c = rng.integers(0, clusters, n_items)
    user_c = rng.integers(0, clusters, n_users)
    vecs = np.eye(clusters)[item_c] + 0.3 * rng.normal(size=(n_items, clusters))
    vecs /= np.linalg.norm(vecs, axis=1, keepdims=True)
    us, it, ra = [], [], []
    for u in range(n_users):
        mine = np.nonzero(item_c == user_c[u])[0]
        liked = rng.choice(mine, size=min(30, len(mine)), replace=False)
        other = rng.choice(n_items, size=10, replace=False)
        for i in liked:
            us.append(u), it.append(i), ra.append(rng.choice([4.0, 4.5, 5.0]))
        for i in other:
            if i not in liked:
                us.append(u), it.append(i), ra.append(rng.choice([1.0, 2.0, 2.5]))
    return np.array(us), np.array(it), np.array(ra, dtype=np.float32), vecs


def test_split_hides_only_positives_of_test_users():
    u, i, r, _ = synthetic()
    s = make_split(u, i, r, 300, n_users=50)
    assert len(s.hidden) == 50
    for row, h in zip(s.test_rows, s.hidden):
        assert all(s.train[row, x] == 0 for x in h)  # hidden pairs never reach training


def test_models_beat_popularity_on_clustered_tastes():
    u, i, r, v = synthetic()
    res = evaluate(u, i, r, 300, v, n_users=200, factors=16, iterations=10)
    assert res["als"]["hr10"] > res["popular"]["hr10"]
    assert res["content"]["ndcg10"] > res["popular"]["ndcg10"]
    assert res["hybrid"]["ndcg10"] >= res["popular"]["ndcg10"]
