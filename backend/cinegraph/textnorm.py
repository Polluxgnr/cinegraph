"""Title normalisation shared by every matcher (Letterboxd, seed list, RSS, NL queries)."""
from __future__ import annotations

import re
import unicodedata

_PUNCT = re.compile(r"[^\w\s]", re.UNICODE)
_SPACES = re.compile(r"\s+")
_LEADING_ARTICLES = ("the ", "a ", "an ", "le ", "la ", "les ", "l ", "un ", "une ", "el ", "il ", "lo ", "der ", "die ", "das ")
_ROMAN = {" ii": " 2", " iii": " 3", " iv": " 4", " v": " 5"}


def strip_accents(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))


def norm_title(s: str | None) -> str:
    """Lower-case, accent-free, punctuation-free, single-spaced, leading article dropped.

    "L'Histoire de Souleymane" -> "histoire de souleymane"
    "LOL : Qui rit sort !"      -> "lol qui rit sort"
    "I, Robot"                  -> "i robot"
    """
    if not s:
        return ""
    s = strip_accents(s).lower().replace("&", " and ")
    s = s.replace("'", " ").replace("’", " ")
    s = _PUNCT.sub(" ", s)
    s = _SPACES.sub(" ", s).strip()
    for art in _LEADING_ARTICLES:
        if s.startswith(art) and len(s) > len(art) + 2:
            s = s[len(art):]
            break
    for k, v in _ROMAN.items():
        if s.endswith(k):
            s = s[: -len(k)] + v
    return s


_YEAR_IN_TITLE = re.compile(r"^(.*?)\s*\((\d{4})\)\s*$")


def split_title_year(s: str) -> tuple[str, int | None]:
    """"Toy Story (1995)" -> ("Toy Story", 1995). MovieLens style, also seed list."""
    m = _YEAR_IN_TITLE.match(s.strip())
    if m:
        return m.group(1).strip(), int(m.group(2))
    return s.strip(), None


def movielens_title(s: str) -> str:
    """MovieLens moves articles to the end: "Matrix, The" -> "The Matrix"."""
    m = re.match(r"^(.*), (The|A|An|Les|Le|La|L'|Il|El|Das|Der|Die)$", s)
    if m:
        art = m.group(2)
        return f"{art}{'' if art.endswith(chr(39)) else ' '}{m.group(1)}"
    return s
