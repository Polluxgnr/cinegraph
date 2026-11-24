"""Loads config.toml (falls back to config.example.toml) and the personal profile."""
from __future__ import annotations

import tomllib
from functools import lru_cache
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = ROOT / "config.toml"
EXAMPLE_PATH = ROOT / "config.example.toml"
PROFILE_PATH = ROOT / "profile.md"
DATA_DIR = ROOT / "data"


@lru_cache(maxsize=1)
def load_config() -> dict[str, Any]:
    path = CONFIG_PATH if CONFIG_PATH.exists() else EXAMPLE_PATH
    with open(path, "rb") as f:
        cfg = tomllib.load(f)
    cfg.setdefault("models", {})
    cfg.setdefault("sources", {})
    cfg.setdefault("browser", {})
    cfg.setdefault("search", {})
    return cfg


def reload_config() -> dict[str, Any]:
    load_config.cache_clear()
    return load_config()


def source_config(name: str) -> dict[str, Any]:
    return load_config()["sources"].get(name, {})


def read_profile() -> str:
    return PROFILE_PATH.read_text(encoding="utf-8") if PROFILE_PATH.exists() else ""


def write_profile(text: str) -> None:
    PROFILE_PATH.write_text(text, encoding="utf-8")
