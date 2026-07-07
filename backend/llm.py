"""
Provider-agnostic LLM helper (OpenAI-compatible /chat/completions).

Swap providers with env vars only — no code changes:

  Local Ollama (free, open-source — the default):
    1. Install Ollama  → https://ollama.com/download
    2. Pull a model    → `ollama pull llama3.1`   (or `qwen2.5:3b`, `gemma2:2b` for speed)
    3. Ollama serves an OpenAI-compatible API at http://localhost:11434/v1
    (no env needed — these are the defaults)

  Groq free tier (cloud, open models, very fast):
    LLM_BASE_URL=https://api.groq.com/openai/v1
    LLM_API_KEY=gsk_...            (free key from console.groq.com)
    LLM_MODEL=llama-3.1-8b-instant

  OpenAI / OpenRouter / any OpenAI-compatible endpoint:
    LLM_BASE_URL=https://api.openai.com/v1   (or https://openrouter.ai/api/v1)
    LLM_API_KEY=sk-...
    LLM_MODEL=gpt-4o-mini                     (or an openrouter model id)

Uses `requests` (already a dependency) run in a thread so it never blocks the
event loop. Never leaks keys; raises LLMError with a short message on failure.
"""
from __future__ import annotations

import asyncio
import logging
import os

import requests

logger = logging.getLogger(__name__)

LLM_BASE_URL = os.environ.get("LLM_BASE_URL", "http://localhost:11434/v1").rstrip("/")
LLM_API_KEY = os.environ.get("LLM_API_KEY", "ollama")  # Ollama ignores the value
LLM_MODEL = os.environ.get("LLM_MODEL", "llama3.1")
LLM_TIMEOUT = int(os.environ.get("LLM_TIMEOUT", "180"))


class LLMError(Exception):
    """Raised when the LLM call fails (connection refused, bad status, empty reply)."""


def _call(system: str, prompt: str, temperature: float) -> str:
    try:
        resp = requests.post(
            f"{LLM_BASE_URL}/chat/completions",
            headers={
                "Authorization": f"Bearer {LLM_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": LLM_MODEL,
                "temperature": temperature,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": prompt},
                ],
            },
            timeout=LLM_TIMEOUT,
        )
    except requests.exceptions.ConnectionError as e:
        raise LLMError(
            f"Could not reach the LLM at {LLM_BASE_URL}. Is Ollama running "
            f"(`ollama serve`) and the model pulled (`ollama pull {LLM_MODEL}`)?"
        ) from e
    except requests.exceptions.RequestException as e:
        raise LLMError(f"LLM request failed: {e}") from e

    if resp.status_code >= 400:
        raise LLMError(f"LLM returned {resp.status_code}: {resp.text[:200]}")

    try:
        data = resp.json()
        content = data["choices"][0]["message"]["content"]
    except (ValueError, KeyError, IndexError) as e:
        raise LLMError(f"Unexpected LLM response shape: {e}") from e

    if not content or not content.strip():
        raise LLMError("LLM returned an empty response.")
    return content.strip()


async def generate(system: str, prompt: str, temperature: float = 0.7) -> str:
    """Run one chat completion off the event loop. Raises LLMError on failure."""
    return await asyncio.to_thread(_call, system, prompt, temperature)


def describe() -> str:
    """Human-readable provider summary (no secrets)."""
    return f"{LLM_MODEL} @ {LLM_BASE_URL}"


def _chat(system: str, messages: list, temperature: float) -> str:
    msgs = [{"role": "system", "content": system}]
    for m in messages:
        role = m.get("role") if isinstance(m, dict) else None
        content = m.get("content") if isinstance(m, dict) else None
        if content:
            msgs.append({"role": "assistant" if role == "assistant" else "user", "content": content})
    try:
        resp = requests.post(
            f"{LLM_BASE_URL}/chat/completions",
            headers={"Authorization": f"Bearer {LLM_API_KEY}", "Content-Type": "application/json"},
            json={"model": LLM_MODEL, "temperature": temperature, "messages": msgs},
            timeout=LLM_TIMEOUT,
        )
    except requests.exceptions.ConnectionError as e:
        raise LLMError(
            f"Could not reach the LLM at {LLM_BASE_URL}. Is Ollama running "
            f"(`ollama serve`) and the model pulled (`ollama pull {LLM_MODEL}`)?"
        ) from e
    except requests.exceptions.RequestException as e:
        raise LLMError(f"LLM request failed: {e}") from e
    if resp.status_code >= 400:
        raise LLMError(f"LLM returned {resp.status_code}: {resp.text[:200]}")
    try:
        content = resp.json()["choices"][0]["message"]["content"]
    except (ValueError, KeyError, IndexError) as e:
        raise LLMError(f"Unexpected LLM response shape: {e}") from e
    if not content or not content.strip():
        raise LLMError("LLM returned an empty response.")
    return content.strip()


async def chat(system: str, messages: list, temperature: float = 0.4) -> str:
    """Multi-turn chat completion. `messages` is [{role, content}, ...]."""
    return await asyncio.to_thread(_chat, system, messages, temperature)
