from cinegraph.textnorm import movielens_title, norm_title, split_title_year
from cinegraph.userdata.matcher import Candidate, best_match
from cinegraph.userdata.seed_watchlist import parse


def test_norm_title():
    assert norm_title("L'Histoire de Souleymane") == "histoire de souleymane"
    assert norm_title("LOL : Qui rit sort !") == "lol qui rit sort"
    assert norm_title("I, Robot") == "i robot"
    assert norm_title("Présumé coupable") == "presume coupable"
    assert norm_title("The Usual Suspects") == norm_title("Usual Suspects")
    assert norm_title("Rocky II") == "rocky 2"
    assert norm_title("Fast & Furious") == "fast and furious"


def test_movielens_helpers():
    assert split_title_year("Toy Story (1995)") == ("Toy Story", 1995)
    assert movielens_title("Matrix, The") == "The Matrix"
    assert movielens_title("Usual Suspects, The") == "The Usual Suspects"
    assert movielens_title("Amelie") == "Amelie"


CANDS = [
    Candidate(1, "movie", "Man on Fire", year=1987, popularity=5),
    Candidate(2, "movie", "Man on Fire", year=2004, popularity=40),
    Candidate(3, "tv", "Man on Fire", year=2025, popularity=30),
    Candidate(4, "movie", "Shaun of the Dead", year=2004, popularity=20),
    Candidate(5, "movie", "Les Intouchables", original_title="Intouchables", year=2011, popularity=30,
              aliases=("untouchable",)),
    Candidate(6, "movie", "OSS 117: Cairo, Nest of Spies", original_title="OSS 117 : Le Caire, nid d'espions",
              year=2006),
]


def test_exact_title_and_year():
    m = best_match("Man on Fire", 2004, CANDS, kind_hint="movie")
    assert m and m.candidate.id == 2 and m.score > 0.95


def test_year_disambiguates_remake():
    assert best_match("Man on Fire", 1987, CANDS).candidate.id == 1


def test_kind_hint_prefers_series():
    assert best_match("Man on Fire", None, CANDS, kind_hint="tv").candidate.id == 3


def test_year_off_by_one_is_ok():
    m = best_match("Shaun of the Dead", 2005, CANDS)
    assert m and m.candidate.id == 4


def test_wrong_year_rejected():
    assert best_match("Shaun of the Dead", 1980, CANDS) is None


def test_original_title_and_alias():
    assert best_match("Intouchables", 2011, CANDS).candidate.id == 5
    assert best_match("Untouchable", 2011, CANDS).candidate.id == 5
    assert best_match("OSS 117: Le Caire, nid d'espions", 2006, CANDS).candidate.id == 6


def test_fuzzy_typo():
    m = best_match("Shawn of the Dead", 2004, CANDS)
    assert m and m.candidate.id == 4 and m.score < 1


def test_unrelated_rejected():
    assert best_match("Interstellar", 2014, CANDS) is None


def test_seed_watchlist_parse():
    md = """# x\n## Films\n- Climbing (2020) — Korean animated film\n- Jamais sans mon psy\n
## Series\n- LOL : Qui rit sort (2021)\n## Currently watching\n- The Brothers Sun (2024) [series]\n- Click (2006) [film]\n"""
    items = parse(md)
    assert [(i.title, i.year, i.kind, i.status) for i in items] == [
        ("Climbing", 2020, "movie", "want"),
        ("Jamais sans mon psy", None, "movie", "want"),
        ("LOL : Qui rit sort", 2021, "tv", "want"),
        ("The Brothers Sun", 2024, "tv", "watching"),
        ("Click", 2006, "movie", "watching"),
    ]
    assert items[0].note == "Korean animated film"


def test_repo_seed_file_parses():
    from cinegraph.userdata.seed_watchlist import default_path

    items = parse(default_path().read_text(encoding="utf-8"))
    kinds = {k: sum(1 for i in items if i.kind == k) for k in ("movie", "tv")}
    assert len(items) == 52 and kinds == {"movie": 28, "tv": 24}
    assert sum(i.status == "watching" for i in items) == 3


def test_subset_title_is_not_a_match():
    cands = [Candidate(1, "tv", "Lupin", year=2021, popularity=50)]
    assert best_match("Lupin III", None, cands, kind_hint="tv") is None
    # ...but a short name matching the main title before a subtitle is fine
    m = best_match("Big Vape", None, [Candidate(2, "tv", "Big Vape: The Rise and Fall of Juul", year=2023)])
    assert m and m.candidate.id == 2
    assert best_match("Vape", None, [Candidate(2, "tv", "Big Vape: The Rise and Fall of Juul", year=2023)]) is None
