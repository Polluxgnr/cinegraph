import csv
import datetime as dt
import io
import zipfile

from cinegraph.userdata import letterboxd_export as ex
from cinegraph.userdata.letterboxd_rss import parse_feed
from cinegraph.userdata.letterboxd_zip import read_zip

# Column names accepted by https://letterboxd.com/about/importing-data/
LETTERBOXD_IMPORT_COLUMNS = {"LetterboxdURI", "tmdbID", "imdbID", "Title", "Year", "Directors", "WatchedDate",
                             "Rating", "Rating10", "Tags", "Review", "Rewatch"}

REC = {"kind": "movie", "tmdb_id": 680, "imdb_id": "tt0110912", "title": "Pulp Fiction", "year": 1994,
       "directors": ["Quentin Tarantino"], "rating": 5.0, "watched_date": dt.date(2026, 11, 1), "rewatch": True,
       "tags": "rewatch, cinema", "review": 'Royale with "cheese", still perfect.'}


def _parse(doc: str) -> list[dict]:
    return list(csv.DictReader(io.StringIO(doc)))


def test_columns_are_letterboxd_importer_columns():
    for cols in ex.COLUMNS.values():
        assert set(cols) <= LETTERBOXD_IMPORT_COLUMNS
        assert "tmdbID" in cols and "Title" in cols and "Year" in cols


def test_rating_half_steps():
    assert ex.lb_rating(4.0) == "4"
    assert ex.lb_rating(3.74) == "3.5"
    assert ex.lb_rating(3.76) == "4"
    assert ex.lb_rating(0.1) == "0.5"
    assert ex.lb_rating(7) == "5"
    assert ex.lb_rating(None) == ""


def test_diary_row_round_trip():
    [doc] = ex.render_csv("diary", [REC])
    assert doc.splitlines()[0] == "tmdbID,imdbID,Title,Year,Directors,WatchedDate,Rating,Rewatch,Tags,Review"
    [row] = _parse(doc)
    assert row == {"tmdbID": "680", "imdbID": "tt0110912", "Title": "Pulp Fiction", "Year": "1994",
                   "Directors": "Quentin Tarantino", "WatchedDate": "2026-11-01", "Rating": "5", "Rewatch": "Yes",
                   "Tags": "rewatch, cinema", "Review": 'Royale with "cheese", still perfect.'}


def test_series_are_left_out():
    tv = {**REC, "kind": "tv", "title": "Fauda", "tmdb_id": 64464}
    [doc] = ex.render_csv("watchlist", [REC, tv])
    assert [r["Title"] for r in _parse(doc)] == ["Pulp Fiction"]


def test_watched_has_no_rating():
    [doc] = ex.render_csv("watched", [REC])
    assert "Rating" not in _parse(doc)[0]


def test_split_under_importer_size_limit(monkeypatch):
    monkeypatch.setattr(ex, "MAX_BYTES", 400)
    recs = [{**REC, "tmdb_id": i, "title": f"Film {i}"} for i in range(40)]
    docs = ex.render_csv("ratings", recs)
    assert len(docs) > 1
    rows = [r for d in docs for r in _parse(d)]
    assert len(rows) == 40 and all(len(d.encode()) <= 400 + 200 for d in docs)
    assert all(d.startswith("tmdbID,") for d in docs)


def _zip(files: dict[str, str]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, content in files.items():
            zf.writestr(name, content)
    return buf.getvalue()


def test_read_letterboxd_zip_ignores_deleted_folder():
    data = _zip({
        "ratings.csv": "Date,Name,Year,Letterboxd URI,Rating\n2026-01-02,Pulp Fiction,1994,https://boxd.it/a,5\n",
        "likes/films.csv": "Date,Name,Year,Letterboxd URI\n2026-01-02,Interstellar,2014,https://boxd.it/b\n",
        "deleted/ratings.csv": "Date,Name,Year,Letterboxd URI,Rating\n2020-01-01,Bad,2000,x,1\n",
    })
    files = read_zip(data)
    assert files["ratings.csv"] == [{"Date": "2026-01-02", "Name": "Pulp Fiction", "Year": "1994",
                                     "Letterboxd URI": "https://boxd.it/a", "Rating": "5"}]
    assert files["likes/films.csv"][0]["Name"] == "Interstellar"


RSS = """<?xml version='1.0' encoding='utf-8'?>
<rss version="2.0" xmlns:letterboxd="https://letterboxd.com" xmlns:tmdb="https://themoviedb.org">
<channel><title>Letterboxd - polluxgnr</title>
<item><title>Parasite, 2019 - ★★★★</title><link>https://letterboxd.com/polluxgnr/film/parasite-2019/</link>
<guid isPermaLink="false">letterboxd-review-123</guid>
<letterboxd:watchedDate>2026-11-02</letterboxd:watchedDate><letterboxd:rewatch>No</letterboxd:rewatch>
<letterboxd:filmTitle>Parasite</letterboxd:filmTitle><letterboxd:filmYear>2019</letterboxd:filmYear>
<letterboxd:memberRating>4.0</letterboxd:memberRating><tmdb:movieId>496243</tmdb:movieId></item>
<item><title>Seen: Interstellar</title><guid isPermaLink="false">letterboxd-watch-456</guid>
<letterboxd:filmTitle>Interstellar</letterboxd:filmTitle><letterboxd:filmYear>2014</letterboxd:filmYear>
<letterboxd:rewatch>Yes</letterboxd:rewatch><tmdb:movieId>157336</tmdb:movieId></item>
<item><title>My list</title><guid isPermaLink="false">letterboxd-list-9</guid></item>
</channel></rss>"""


def test_parse_rss_feed():
    entries = parse_feed(RSS)
    assert len(entries) == 2
    p, i = entries
    assert (p.title, p.year, p.rating, p.watched_date, p.tmdb_movie_id, p.rewatch) == \
        ("Parasite", 2019, 4.0, "2026-11-02", 496243, False)
    assert i.rating is None and i.rewatch and i.tmdb_movie_id == 157336


def test_parse_empty_feed():
    assert parse_feed("<rss><channel><title>x</title></channel></rss>") == []
