"""Build a small *sample* Letterboxd export ZIP (same layout and columns as the real one)
for trying the import before downloading your own. Contents: the five titles from the
initial taste brief only.

    python tests/fixtures/make_sample_letterboxd_zip.py  ->  tests/fixtures/sample-letterboxd-export.zip
"""
import zipfile
from pathlib import Path

HERE = Path(__file__).parent

RATINGS = [
    ("2026-10-01", "Pulp Fiction", 1994, "https://boxd.it/29Ss", 5),
    ("2026-10-01", "Interstellar", 2014, "https://boxd.it/4VZ8", 5),
    ("2026-10-02", "Parasite", 2019, "https://boxd.it/hTha", 4),
    ("2026-10-02", "The Intouchables", 2011, "https://boxd.it/22Ny", 4),
    ("2026-10-03", "OSS 117: Cairo, Nest of Spies", 2006, "https://boxd.it/1Q0u", 4),
]

FILES = {
    "profile.csv": "Date Joined,Username,Given Name,Family Name,Email Address,Location,Website,Bio,Pronoun,"
                   "Favorite Films\n2026-01-01,sample,,,,,,,,\n",
    "ratings.csv": "Date,Name,Year,Letterboxd URI,Rating\n"
                   + "".join(f"{d},\"{n}\",{y},{u},{r}\n" for d, n, y, u, r in RATINGS),
    "watched.csv": "Date,Name,Year,Letterboxd URI\n"
                   + "".join(f"{d},\"{n}\",{y},{u}\n" for d, n, y, u, _ in RATINGS),
    "diary.csv": "Date,Name,Year,Letterboxd URI,Rating,Rewatch,Tags,Watched Date\n"
                 "2026-10-01,Pulp Fiction,1994,https://boxd.it/sample1,5,Yes,,2026-09-30\n",
    "reviews.csv": "Date,Name,Year,Letterboxd URI,Rating,Rewatch,Review,Tags,Watched Date\n",
    "watchlist.csv": "Date,Name,Year,Letterboxd URI\n2026-10-05,Reservoir Dogs,1992,https://boxd.it/29T4\n",
    "likes/films.csv": "Date,Name,Year,Letterboxd URI\n2026-10-01,Pulp Fiction,1994,https://boxd.it/29Ss\n"
                       "2026-10-01,Interstellar,2014,https://boxd.it/4VZ8\n",
}


def build(out: Path = HERE / "sample-letterboxd-export.zip") -> Path:
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, content in FILES.items():
            zf.writestr(name, content)
    return out


if __name__ == "__main__":
    print(build())
