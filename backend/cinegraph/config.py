"""Settings, read from environment / `.env` (never hard-code secrets)."""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(str(REPO_ROOT / ".env"), ".env"), extra="ignore"
    )

    database_url: str = "postgresql://cinegraph:cinegraph@127.0.0.1:5433/cinegraph"
    data_dir: Path = Field(default=REPO_ROOT / "data")

    tmdb_api_key: str = ""
    tmdb_region: str = "FR"
    tmdb_language: str = "en-US"
    tmdb_rate_limit: float = 30.0

    letterboxd_username: str = "polluxgnr"
    rss_poll_minutes: int = 30

    movielens_variant: str = "ml-latest-small"
    wikidata_contact: str = ""

    embedder: str = "fastembed"
    embed_model: str = "BAAI/bge-small-en-v1.5"

    llm_provider: str = "anthropic"
    llm_model: str = "claude-opus-5-5"
    anthropic_api_key: str = ""
    llm_base_url: str = ""
    llm_api_key: str = ""

    my_platforms: str = "Netflix,Prime Video,Disney+,HBO Max,Canal+,Apple TV+"
    nightly_retrain_hour: int = 4

    @property
    def platforms(self) -> list[str]:
        return [p.strip() for p in self.my_platforms.split(",") if p.strip()]

    @property
    def models_dir(self) -> Path:
        p = self.data_dir / "models"
        p.mkdir(parents=True, exist_ok=True)
        return p


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    s.data_dir.mkdir(parents=True, exist_ok=True)
    return s
