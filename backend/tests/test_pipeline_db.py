"""End-to-end ranking pipeline against a real Postgres (a throwaway `cinegraph_test` database).

Skipped when Postgres isn't reachable. Uses a synthetic catalogue so it runs in seconds:
two "taste regions" in embedding space plus shared directors/writers in the graph.
"""
import io
import os
import zipfile

import numpy as np
import pytest

psycopg = pytest.importorskip("psycopg")

ADMIN_URL = os.environ.get("TEST_ADMIN_DATABASE_URL", "postgresql://cinegraph:cinegraph@127.0.0.1:5433/cinegraph")
TEST_URL = ADMIN_URL.rsplit("/", 1)[0] + "/cinegraph_test"


@pytest.fixture(scope="module")
def testdb(tmp_path_factory):
    try:
        with psycopg.connect(ADMIN_URL, autocommit=True, connect_timeout=3) as c:
            c.execute("DROP DATABASE IF EXISTS cinegraph_test WITH (FORCE)")
            c.execute("CREATE DATABASE cinegraph_test")
    except psycopg.OperationalError:
        pytest.skip("Postgres not reachable")
    mp = pytest.MonkeyPatch()
    mp.setenv("DATABASE_URL", TEST_URL)
    mp.setenv("DATA_DIR", str(tmp_path_factory.mktemp("data")))
    mp.setenv("LLM_PROVIDER", "none")
    mp.setenv("TMDB_API_KEY", "")
    from cinegraph import config, db
    from cinegraph.recsys import bandit, catalog, cf, ltr

    config.get_settings.cache_clear()
    db._pool = None
    db.init_schema()
    catalog._cache.update(key=None, m=None)
    for f in (cf.load_model, ltr.load_model, bandit.load_clusters):
        f.cache_clear()
    yield db
    if db._pool:
        db._pool.close()
        db._pool = None
    config.get_settings.cache_clear()
    mp.undo()


def _seed_catalogue(db):
    rng = np.random.default_rng(1)
    crime, romcom = rng.normal(size=384), rng.normal(size=384)
    rows = []
    for i in range(1, 41):
        crime_side = i <= 20
        base = crime if crime_side else romcom
        v = base + 0.35 * rng.normal(size=384)
        v /= np.linalg.norm(v)
        genres = ["Crime", "Thriller"] if crime_side else ["Comedy", "Drama"]
        kind = "tv" if i % 2 == 0 else "movie"
        rows.append((i, kind, f"Title {i}", genres, v.astype(np.float32)))
    with db.connect() as conn:
        for i, kind, name, genres, v in rows:
            conn.execute(
                "INSERT INTO titles (id, kind, tmdb_id, title, norm_title, year, genres, popularity, vote_average, "
                "vote_count, source) VALUES (%s,%s,%s,%s,lower(%s),2000+%s,%s,%s,7,100,'tmdb')",
                (i, kind, 1000 + i, name, name, i % 20, genres, 50 - i))
            conn.execute("INSERT INTO title_embeddings VALUES (%s,'test',%s,'h')", (i, v))
        conn.execute("SELECT setval('titles_id_seq', 100)")
        # one writer shared by Title 1 (to be rated 5) and Title 3 (a candidate)
        conn.execute("INSERT INTO people (id, tmdb_person_id, name) VALUES (1, 1, 'Quentin Tarantino'), "
                     "(2, 2, 'Someone Else')")
        conn.execute("INSERT INTO credits VALUES (1,1,'writer',NULL,0), (3,1,'writer',NULL,0), (5,2,'cast',NULL,0)")
        conn.execute("INSERT INTO providers VALUES (3,'FR',8,'Netflix','flatrate',NULL)")
        conn.commit()


def _zip():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("ratings.csv", "Date,Name,Year,Letterboxd URI,Rating\n"
                                   "2026-01-01,Title 1,2001,u1,5\n2026-01-01,Title 7,2007,u7,4.5\n"
                                   "2026-01-01,Title 25,2005,u25,1\n2026-01-01,Unknown Film,1999,ux,3\n")
        zf.writestr("watchlist.csv", "Date,Name,Year,Letterboxd URI\n2026-01-02,Title 9,2009,u9\n")
    return buf.getvalue()


def test_end_to_end(testdb):
    db = testdb
    _seed_catalogue(db)
    from cinegraph import services
    from cinegraph.recsys import active, bandit, graph
    from cinegraph.recsys.pipeline import Constraints, recommend
    from cinegraph.userdata.letterboxd_export import fetch_records, render_csv
    from cinegraph.userdata.letterboxd_zip import import_zip
    from cinegraph.userdata.matcher import resolve

    rep = import_zip(_zip(), lambda n, y: resolve(n, y, "movie", allow_remote=False))
    assert rep.matched["ratings.csv"] == 3 and len(rep.unmatched) == 1
    assert db.fetchone("SELECT count(*) n FROM pending_matches")["n"] == 1

    assert graph.build()["edges"] > 0
    bandit.build_clusters(k=4)

    res = recommend(n=10, log_impressions=True)
    items = res["items"]
    ids = [i["id"] for i in items]
    assert res["model"] == "default-blend"
    assert not {1, 7, 25} & set(ids), "rated titles must not be recommended"
    # crime side (liked) dominates the top of the list
    assert sum(1 for i in items[:6] if i["id"] <= 20) >= 4
    # path-based explanation for the title sharing a writer with a 5-star rating
    t3 = next((i for i in items if i["id"] == 3), None)
    assert t3 is not None and "Quentin Tarantino" in t3["why"] and "Title 1" in t3["why"]
    assert db.fetchone("SELECT count(*) n FROM impressions")["n"] == len(items)

    # platform + kind constraints
    only = recommend(n=5, constraints=Constraints(kinds={"movie"}, platforms={"Netflix"}), log_impressions=False,
                     explore=False)
    assert [i["id"] for i in only["items"]] == [3]

    # swipe deck: a card, then feedback changes the profile immediately
    card = active.next_card(rng=np.random.default_rng(0))
    assert card and card["title"]["id"] not in (1, 7, 25)
    services.swipe(card["title"]["id"], "love")
    after = recommend(n=10, log_impressions=False, explore=False)
    assert card["title"]["id"] not in [i["id"] for i in after["items"]]
    assert after["profile_size"] == res["profile_size"] + 1

    # in-app rating flows into the Letterboxd CSV export (films only)
    services.rate(11, 4.5)
    [doc] = render_csv("ratings", fetch_records("ratings"))
    assert "Title 11" in doc and "Title 1," not in doc  # Letterboxd-sourced ratings aren't re-exported


def test_ltr_trains_from_swipes_and_takes_over(testdb):
    """After enough feedback the LightGBM ranker replaces the default blend."""
    from cinegraph import services
    from cinegraph.recsys import ltr
    from cinegraph.recsys.pipeline import recommend

    for tid in range(12, 41):
        if tid in (25,):
            continue
        services.swipe(tid, "love" if tid <= 20 else "dislike")
    res = ltr.train()
    assert res["trained"], res
    assert res["examples"] >= 30
    out = recommend(n=5, log_impressions=False, explore=False)
    assert out["model"] == "ltr"
