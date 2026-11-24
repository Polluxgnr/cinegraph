"""Source plug-in contract and registry.

To add a platform: drop a module in agora/sources/ that defines a Source subclass with a
`name`. It is discovered automatically and shows up in the interface.
"""
from __future__ import annotations

import html
import importlib
import pkgutil
import re
from datetime import datetime, timezone
from typing import Any

from ..config import source_config
from ..models import Document

USER_AGENT = "agora-research/0.1 (personal research tool)"


class Source:
    name: str = ""          # id used in config and API
    label: str = ""         # shown in the interface
    group: str = "open"     # open | browser | local
    description: str = ""

    def __init__(self) -> None:
        self.cfg: dict[str, Any] = source_config(self.name)

    @property
    def enabled(self) -> bool:
        return bool(self.cfg.get("enabled", True))

    def available(self) -> tuple[bool, str]:
        """(usable right now?, reason if not)."""
        return True, ""

    async def search(self, query: str, limit: int) -> list[Document]:
        raise NotImplementedError

    async def enrich(self, doc: Document, max_comments: int) -> Document:
        """Fetch the full text and comments of one result. Default: nothing more to fetch."""
        return doc

    def info(self) -> dict[str, Any]:
        ok, why = self.available()
        return {"name": self.name, "label": self.label, "group": self.group,
                "description": self.description, "enabled": self.enabled,
                "available": ok, "reason": why}


_registry: dict[str, Source] | None = None


def all_sources(refresh: bool = False) -> dict[str, Source]:
    global _registry
    if _registry is None or refresh:
        from .. import sources as pkg
        for mod in pkgutil.iter_modules(pkg.__path__):
            if mod.name != "base":
                importlib.import_module(f"{pkg.__name__}.{mod.name}")
        found: dict[str, Source] = {}
        for cls in _subclasses(Source):
            if cls.name:
                found[cls.name] = cls()
        _registry = dict(sorted(found.items(), key=lambda kv: (["open", "browser", "local"].index(kv[1].group), kv[0])))
    return _registry


def _subclasses(cls: type) -> list[type]:
    out = []
    for sub in cls.__subclasses__():
        out.append(sub)
        out.extend(_subclasses(sub))
    return out


# ---------- small helpers shared by sources ----------

_TAG = re.compile(r"<[^>]+>")


def html_to_text(s: str | None) -> str:
    if not s:
        return ""
    s = re.sub(r"<(br|p|/p|li)[^>]*>", "\n", s, flags=re.I)
    return html.unescape(_TAG.sub("", s)).strip()


def iso_from_epoch(ts: float | int | None) -> str | None:
    if ts is None:
        return None
    return datetime.fromtimestamp(float(ts), tz=timezone.utc).strftime("%Y-%m-%d")


def clip(s: str, n: int) -> str:
    s = (s or "").strip()
    return s if len(s) <= n else s[: n - 1].rstrip() + "…"
