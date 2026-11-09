"""Load docs/seed_watchlist.md into the watchlist."""
from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

from .. import db
from ..config import REPO_ROOT
from .matcher import resolve

LINE = re.compile(r"^\s*[-*]\s+(?P<title>.+?)(?:\s+\((?P<year>\d{4})\))?(?:\s+\[(?P<kind>film|series)\])?"
                  r"(?:\s+—\s+(?P<note>.*))?\s*$")


@dataclass
class SeedItem:
    title: str
    year: int | None
    kind: str          # movie | tv
    status: str        # want | watching
    note: str | None = None


def parse(md: str) -> list[SeedItem]:
    items: list[SeedItem] = []
    section_kind, status = None, "want"
    for raw in md.splitlines():
        h = raw.strip().lower()
        if h.startswith("## "):
            section_kind = "movie" if "film" in h else "tv" if "series" in h else None
            status = "watching" if "watching" in h else "want"
            continue
        if not h.startswith(("- ", "* ")) or (section_kind is None and status == "want"):
            continue
        m = LINE.match(raw)
        if not m:
            continue
        kind = {"film": "movie", "series": "tv"}.get(m.group("kind") or "", section_kind)
        items.append(SeedItem(title=m.group("title").strip(), year=int(m.group("year")) if m.group("year") else None,
                              kind=kind or "movie", status=status, note=m.group("note")))
    return items


def default_path() -> Path:
    for p in (REPO_ROOT / "docs" / "seed_watchlist.md", Path("/app/docs/seed_watchlist.md"),
              Path("docs/seed_watchlist.md")):
        if p.exists():
            return p
    raise FileNotFoundError("docs/seed_watchlist.md")


def load(path: Path | None = None, allow_remote: bool = True) -> dict:
    items = parse((path or default_path()).read_text(encoding="utf-8"))
    matched, pending = [], []
    for it in items:
        m = resolve(it.title, it.year, kind_hint=it.kind, allow_remote=allow_remote)
        # a film with the same name as the wanted series (or vice versa) is not a match
        if m is None or m.candidate.kind != it.kind:
            pending.append(it.title)
            db.execute(
                "INSERT INTO pending_matches (source, name, year, kind_hint, payload) "
                "VALUES ('seed', %s, %s, %s, jsonb_build_object('status', %s::text)) ON CONFLICT DO NOTHING",
                (it.title, it.year, it.kind, it.status))
            continue
        db.execute(
            """INSERT INTO watchlist (title_id, status, source, note) VALUES (%s, %s, 'seed', %s)
               ON CONFLICT (title_id) DO UPDATE SET status = EXCLUDED.status""",
            (m.candidate.id, it.status, it.note))
        db.execute("DELETE FROM pending_matches WHERE source = 'seed' AND name = %s", (it.title,))
        matched.append({"seed": it.title, "matched": m.candidate.title, "year": m.candidate.year,
                        "score": m.score})
    return {"total": len(items), "matched": matched, "pending": pending}
