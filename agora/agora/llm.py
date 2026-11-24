"""The model slot. Two providers cover nearly everything:

- "openai": any OpenAI-compatible endpoint. Ollama, LM Studio, llama.cpp, vLLM (local, free)
  and OpenRouter, Groq, Gemini, Mistral, OpenAI (hosted).
- "anthropic": Claude through the official SDK.

Add a provider by subclassing LLM and registering it in PROVIDERS.
"""
from __future__ import annotations

import asyncio
import json
import os
import re
from typing import Any

import httpx

from .config import load_config


class LLMError(RuntimeError):
    pass


class LLM:
    def __init__(self, name: str, cfg: dict[str, Any]):
        self.name = name
        self.cfg = cfg
        self.model = cfg.get("model", "")
        # How much scraped text we may feed this model in one go (characters, not tokens).
        self.context_chars = int(cfg.get("context_chars", 40_000))

    def api_key(self) -> str:
        if self.cfg.get("api_key"):
            return self.cfg["api_key"]
        env = self.cfg.get("api_key_env")
        return os.environ.get(env, "") if env else ""

    async def chat(self, system: str, user: str, max_tokens: int = 8000, json_mode: bool = False) -> str:
        raise NotImplementedError

    async def chat_json(self, system: str, user: str, max_tokens: int = 8000) -> dict[str, Any]:
        """Ask for JSON, tolerate the usual local-model mess (fences, prose around it), retry once."""
        text = await self.chat(system, user, max_tokens=max_tokens, json_mode=True)
        try:
            return extract_json(text)
        except ValueError:
            fix = await self.chat(
                "You repair malformed JSON. Reply with the corrected JSON object only.",
                text[-12_000:], max_tokens=max_tokens, json_mode=True,
            )
            return extract_json(fix)


class OpenAICompatible(LLM):
    async def chat(self, system, user, max_tokens=8000, json_mode=False):
        base = self.cfg.get("base_url", "http://localhost:11434/v1").rstrip("/")
        body: dict[str, Any] = {
            "model": self.model,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
            "max_tokens": max_tokens,
        }
        if "temperature" in self.cfg:
            body["temperature"] = self.cfg["temperature"]
        if json_mode and self.cfg.get("json_mode", True):
            body["response_format"] = {"type": "json_object"}
        body.update(self.cfg.get("extra_body", {}))  # provider-specific knobs, e.g. OpenRouter's reasoning switch
        headers = {"Authorization": f"Bearer {self.api_key()}"} if self.api_key() else {}
        async with httpx.AsyncClient(timeout=self.cfg.get("timeout", 600)) as client:
            for attempt in range(int(self.cfg.get("retries", 4)) + 1):
                try:
                    r = await client.post(f"{base}/chat/completions", json=body, headers=headers)
                except httpx.TransportError as e:
                    if attempt >= int(self.cfg.get("retries", 4)):
                        raise LLMError(f"{self.name}: connection failed: {e}") from e
                    await asyncio.sleep(2 ** attempt)
                    continue
                if r.status_code == 400 and "response_format" in body:
                    body.pop("response_format")  # endpoint doesn't do JSON mode; prompt asks for JSON anyway
                    continue
                # Free hosted models are often rate-limited or overloaded for a few seconds: wait and retry.
                if r.status_code in (429, 500, 502, 503, 504) and attempt < int(self.cfg.get("retries", 4)):
                    wait = r.headers.get("retry-after", "")
                    await asyncio.sleep(min(float(wait), 60) if wait.replace(".", "").isdigit() else 3 * 2 ** attempt)
                    continue
                break
        if r.status_code >= 400:
            raise LLMError(f"{self.name}: HTTP {r.status_code} {r.text[:300]}")
        data = r.json()
        if "choices" not in data:  # some gateways return errors with HTTP 200
            raise LLMError(f"{self.name}: {str(data.get('error', data))[:300]}")
        choice = data["choices"][0]
        text = strip_think(choice["message"].get("content") or "")
        if not text:
            raise LLMError(f"{self.name}: empty reply (finish_reason={choice.get('finish_reason')}). "
                           "Reasoning models sometimes do this; try extra_body = { reasoning = { enabled = false } }")
        return text


class Anthropic(LLM):
    async def chat(self, system, user, max_tokens=8000, json_mode=False):
        try:
            import anthropic
        except ImportError as e:
            raise LLMError("pip install anthropic to use Claude") from e
        client = anthropic.AsyncAnthropic(api_key=self.api_key() or None)
        kwargs: dict[str, Any] = dict(
            model=self.model or "claude-opus-5-5",
            max_tokens=max_tokens,
            system=system,
            messages=[{"role": "user", "content": user}],
            output_config={"effort": self.cfg.get("effort", "medium")},
        )
        try:
            if self.cfg.get("fallbacks", True):
                # If a safety classifier declines (e.g. security topics), the API retries on a
                # fallback model inside the same call instead of returning nothing.
                resp = await client.beta.messages.create(
                    betas=["server-side-fallback-2026-07-01"],
                    extra_body={"fallbacks": "default"},
                    **kwargs,
                )
            else:
                resp = await client.messages.create(**kwargs)
        except anthropic.APIStatusError as e:
            raise LLMError(f"{self.name}: HTTP {e.status_code} {str(e)[:300]}") from e
        except anthropic.APIConnectionError as e:
            raise LLMError(f"{self.name}: connection failed: {e}") from e
        if resp.stop_reason == "refusal":
            raise LLMError(f"{self.name}: the model declined this request")
        return "".join(b.text for b in resp.content if b.type == "text")


PROVIDERS: dict[str, type[LLM]] = {"openai": OpenAICompatible, "anthropic": Anthropic}


class ChainLLM(LLM):
    """A model plus backups (`fallbacks = ["other", ...]` in config). Each call tries them in order,
    so a rate-limited or misbehaving free model doesn't sink the whole search."""

    def __init__(self, members: list[LLM]):
        super().__init__(members[0].name, members[0].cfg)
        self.members = members
        # Size the context for the smallest member, since any of them may end up writing the answer.
        self.context_chars = min(m.context_chars for m in members)
        self.used: list[str] = []

    async def _try(self, method: str, *args, **kwargs):
        errors = []
        for m in self.members:
            try:
                out = await getattr(m, method)(*args, **kwargs)
                self.used.append(m.name)
                return out
            except (LLMError, ValueError, json.JSONDecodeError) as e:
                errors.append(f"{m.name}: {str(e)[:150]}")
        raise LLMError("all models failed: " + " | ".join(errors))

    async def chat(self, system, user, max_tokens=8000, json_mode=False):
        return await self._try("chat", system, user, max_tokens=max_tokens, json_mode=json_mode)

    async def chat_json(self, system, user, max_tokens=8000):
        return await self._try("chat_json", system, user, max_tokens=max_tokens)


def _build(name: str, models: dict[str, Any]) -> LLM:
    if name not in models:
        raise LLMError(f"Unknown model '{name}'. Configured: {', '.join(models)}")
    mcfg = models[name]
    provider = PROVIDERS.get(mcfg.get("provider", "openai"))
    if not provider:
        raise LLMError(f"Unknown provider '{mcfg.get('provider')}' for model '{name}'")
    return provider(name, mcfg)


def get_llm(name: str | None = None) -> LLM:
    cfg = load_config()
    models = cfg["models"]
    if not models:
        raise LLMError("No models configured. Add one under [models.<name>] in config.toml.")
    name = name or cfg.get("default_model") or next(iter(models))
    primary = _build(name, models)
    backups = primary.cfg.get("fallbacks")
    if isinstance(backups, list) and backups:  # (Claude's `fallbacks = true` is its own server-side switch)
        return ChainLLM([primary] + [_build(b, models) for b in backups if b != name])
    return primary


# ---------- helpers ----------

_THINK = re.compile(r"<think>.*?</think>", re.S)


def strip_think(text: str) -> str:
    """Reasoning models (Qwen3, DeepSeek-R1...) wrap their reasoning in <think> tags."""
    return _THINK.sub("", text).strip()


def extract_json(text: str) -> dict[str, Any]:
    text = strip_think(text)
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, re.S)
    if fence:
        text = fence.group(1)
    start = text.find("{")
    if start < 0:
        raise ValueError("no JSON object in model output")
    depth, in_str, esc = 0, False, False
    for i in range(start, len(text)):
        c = text[i]
        if in_str:
            if esc:
                esc = False
            elif c == "\\":
                esc = True
            elif c == '"':
                in_str = False
        elif c == '"':
            in_str = True
        elif c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return json.loads(text[start : i + 1])
    raise ValueError("unterminated JSON object in model output")
