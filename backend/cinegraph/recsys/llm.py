"""Pluggable LLM provider (LLM_PROVIDER in .env): anthropic (default) | openai_compat | ollama | none.

Only two small JSON tasks use it: parsing a natural-language query into filters, and
reranking ~30 candidates with a one-line explanation each. Every caller has a non-LLM
fallback, so the app works with LLM_PROVIDER=none.
"""
from __future__ import annotations

import json
import logging
from functools import lru_cache

import httpx

from ..config import get_settings

log = logging.getLogger(__name__)


class LLM:
    name = "none"

    def json(self, system: str, user: str, schema: dict) -> dict | None:  # pragma: no cover - interface
        return None


class AnthropicLLM(LLM):
    def __init__(self, model: str, api_key: str = ""):
        import anthropic

        self.name = f"anthropic:{model}"
        self.model = model
        # empty key -> SDK resolves ANTHROPIC_API_KEY / auth profile from the environment
        self.client = anthropic.Anthropic(api_key=api_key) if api_key else anthropic.Anthropic()

    def json(self, system: str, user: str, schema: dict) -> dict | None:
        import anthropic

        try:
            resp = self.client.beta.messages.create(
                model=self.model,
                max_tokens=8000,
                system=system,
                messages=[{"role": "user", "content": user}],
                thinking={"type": "adaptive"},
                output_config={"effort": "low", "format": {"type": "json_schema", "schema": schema}},
                # if a safety classifier declines, the API retries on a fallback model server-side
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",
            )
        except anthropic.APIStatusError as e:
            log.warning("LLM call failed (%s): %s", e.status_code, e.message)
            return None
        except anthropic.APIConnectionError as e:
            log.warning("LLM unreachable: %s", e)
            return None
        except Exception as e:  # noqa: BLE001 - e.g. no credentials configured
            log.warning("LLM unavailable: %s", e)
            return None
        if resp.stop_reason in ("refusal", "max_tokens"):
            log.warning("LLM stopped with %s", resp.stop_reason)
            return None
        text = next((b.text for b in resp.content if b.type == "text"), None)
        try:
            return json.loads(text) if text else None
        except json.JSONDecodeError:
            return None


class OpenAICompatLLM(LLM):
    """Any server speaking the /chat/completions dialect (LM Studio, vLLM, Mistral...)."""

    def __init__(self, model: str, base_url: str, api_key: str = ""):
        self.name = f"openai_compat:{model}"
        self.model, self.base_url, self.api_key = model, base_url.rstrip("/"), api_key

    def json(self, system: str, user: str, schema: dict) -> dict | None:
        try:
            r = httpx.post(
                f"{self.base_url}/chat/completions", timeout=120,
                headers={"Authorization": f"Bearer {self.api_key}"} if self.api_key else {},
                json={"model": self.model, "messages": [
                    {"role": "system", "content": system + "\nReply with JSON matching: " + json.dumps(schema)},
                    {"role": "user", "content": user}], "response_format": {"type": "json_object"}})
            r.raise_for_status()
            return json.loads(r.json()["choices"][0]["message"]["content"])
        except (httpx.HTTPError, KeyError, json.JSONDecodeError) as e:
            log.warning("LLM call failed: %s", e)
            return None


class OllamaLLM(LLM):
    def __init__(self, model: str, base_url: str):
        self.name = f"ollama:{model}"
        self.model, self.base_url = model, (base_url or "http://localhost:11434").rstrip("/")

    def json(self, system: str, user: str, schema: dict) -> dict | None:
        try:
            r = httpx.post(f"{self.base_url}/api/chat", timeout=180, json={
                "model": self.model, "stream": False, "format": schema,
                "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]})
            r.raise_for_status()
            return json.loads(r.json()["message"]["content"])
        except (httpx.HTTPError, KeyError, json.JSONDecodeError) as e:
            log.warning("LLM call failed: %s", e)
            return None


@lru_cache
def get_llm() -> LLM:
    s = get_settings()
    p = s.llm_provider.lower()
    try:
        if p == "anthropic":
            return AnthropicLLM(s.llm_model or "claude-opus-5-5", s.anthropic_api_key)
        if p == "openai_compat" and s.llm_base_url:
            return OpenAICompatLLM(s.llm_model, s.llm_base_url, s.llm_api_key)
        if p == "ollama":
            return OllamaLLM(s.llm_model, s.llm_base_url)
    except Exception as e:  # noqa: BLE001 - missing SDK / credentials -> run without LLM
        log.warning("LLM provider %s unavailable: %s", p, e)
    return LLM()
