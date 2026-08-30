from __future__ import annotations

import logging
import os
import time
from collections.abc import Mapping
from typing import Any

import httpx

from app.crypto import ApiKeyRecord
from app.errors import JobError
from app.observability import elapsed_ms, emit

log = logging.getLogger(__name__)

GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta"
ANTHROPIC_BASE = "https://api.anthropic.com/v1"
NEBIUS_BASE = "https://api.tokenfactory.nebius.com/v1"
NEBIUS_DEFAULT_MODEL = "meta-llama/Llama-3.3-70B-Instruct"
MAX_OUTPUT_TOKENS = 8192
TEMPERATURE = 0.4


def nebius_key_from_env(
    env: Mapping[str, str] | None = None,
) -> ApiKeyRecord | None:
    """Membuat credential server-side LLM dari environment.

    LLM_* adalah konfigurasi provider aktif. NEBIUS_* dipertahankan sebagai
    fallback kompatibilitas agar deployment lama tidak langsung rusak.
    """
    source = env if env is not None else os.environ
    legacy_nebius = bool(source.get("NEBIUS_API_KEY") and not source.get("LLM_API_KEY"))
    secret = (source.get("LLM_API_KEY") or source.get("NEBIUS_API_KEY") or "").strip()
    if not secret:
        return None
    base_url = (
        source.get("LLM_BASE_URL")
        or source.get("NEBIUS_BASE_URL")
        or NEBIUS_BASE
    ).strip() or NEBIUS_BASE
    model = (
        source.get("LLM_MODEL")
        or source.get("NEBIUS_MODEL")
        or NEBIUS_DEFAULT_MODEL
    ).strip() or NEBIUS_DEFAULT_MODEL
    return ApiKeyRecord(
        id="env:nebius" if legacy_nebius else "env:llm",
        provider="openai_compat",
        base_url=base_url,
        model=model,
        secret=secret,
    )


def _request(key: ApiKeyRecord, prompt: str) -> tuple[str, dict[str, str], dict[str, Any]]:
    """Menyusun URL, header, dan body untuk provider yang dipilih user."""
    if key.provider == "gemini":
        base = (key.base_url or GEMINI_BASE).rstrip("/")
        return (
            f"{base}/models/{key.model}:generateContent",
            {"x-goog-api-key": key.secret, "content-type": "application/json"},
            {
                "contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": {
                    "temperature": TEMPERATURE,
                    "maxOutputTokens": MAX_OUTPUT_TOKENS,
                    "responseMimeType": "application/json",
                },
            },
        )

    if key.provider == "openai_compat":
        if not key.base_url:
            raise JobError(
                "BYOK_INVALID", "base_url wajib diisi untuk openai_compat", terminal=True
            )
        return (
            f"{key.base_url.rstrip('/')}/chat/completions",
            {"authorization": f"Bearer {key.secret}", "content-type": "application/json"},
            {
                "model": key.model,
                "messages": [{"role": "user", "content": prompt}],
                "temperature": TEMPERATURE,
                "max_tokens": MAX_OUTPUT_TOKENS,
                "response_format": {"type": "json_object"},
            },
        )

    if key.provider == "anthropic_compat":
        base = (key.base_url or ANTHROPIC_BASE).rstrip("/")
        return (
            f"{base}/messages",
            {
                "x-api-key": key.secret,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            {
                "model": key.model,
                "max_tokens": MAX_OUTPUT_TOKENS,
                "temperature": TEMPERATURE,
                "messages": [{"role": "user", "content": prompt}],
            },
        )

    raise JobError("BYOK_INVALID", f"provider tidak dikenal: {key.provider}", terminal=True)


def _extract_text(provider: str, body: dict[str, Any]) -> str:
    """Mengambil teks dari tiga bentuk respons yang berbeda.

    Semua akses dibungkus: respons yang dihentikan safety filter membalas 200
    tanpa isi, dan pengaksesan indeks secara langsung akan melempar IndexError
    yang berujung ke kode INTERNAL alih-alih pesan yang berguna bagi user.
    """
    try:
        if provider == "gemini":
            return body["candidates"][0]["content"]["parts"][0]["text"]
        if provider == "openai_compat":
            return body["choices"][0]["message"]["content"]
        if provider == "anthropic_compat":
            return "".join(
                block["text"] for block in body["content"] if block.get("type") == "text"
            )
    except (KeyError, IndexError, TypeError):
        pass
    raise JobError("LLM_BAD_OUTPUT", f"respons {provider} tidak memuat teks", terminal=False)


def call_llm(key: ApiKeyRecord, prompt: str, *, http: httpx.Client | None = None) -> str:
    """Memanggil provider LLM milik user dan mengembalikan teks mentahnya.

    Badan respons error sengaja tidak pernah disertakan ke pesan exception:
    sebagian gateway memantulkan kembali kredensial di dalamnya.
    """
    url, headers, payload = _request(key, prompt)
    client = http or httpx.Client(timeout=180)
    started = time.monotonic()
    try:
        resp = client.post(url, headers=headers, json=payload, timeout=180)
    except Exception as error:
        emit(
            log,
            "provider.request.failed",
            level=logging.ERROR,
            provider=key.provider,
            operation="generate",
            error_code="TRANSPORT",
            error_class=type(error).__name__,
            duration_ms=elapsed_ms(started),
        )
        raise

    if resp.status_code in (401, 403, 429):
        # 429 di sini berarti kuota milik user habis, bukan sistem kita
        # kelebihan beban. Mencoba ulang hanya membuang percobaan dan menunda
        # pesan yang seharusnya user lihat.
        error = JobError(
            "BYOK_INVALID",
            f"provider {key.provider} menolak kredensial (HTTP {resp.status_code})",
            terminal=True,
        )
        emit(
            log,
            "provider.request.failed",
            level=logging.WARNING,
            provider=key.provider,
            operation="generate",
            status_code=resp.status_code,
            error_code=error.code,
            duration_ms=elapsed_ms(started),
        )
        raise error
    if resp.status_code != 200:
        error = JobError(
            "LLM_BAD_OUTPUT",
            f"provider {key.provider} membalas HTTP {resp.status_code}",
            terminal=False,
        )
        emit(
            log,
            "provider.request.failed",
            level=logging.WARNING,
            provider=key.provider,
            operation="generate",
            status_code=resp.status_code,
            error_code=error.code,
            duration_ms=elapsed_ms(started),
        )
        raise error

    try:
        text = _extract_text(key.provider, resp.json())
    except JobError as error:
        emit(
            log,
            "provider.request.failed",
            level=logging.WARNING,
            provider=key.provider,
            operation="generate",
            status_code=resp.status_code,
            error_code=error.code,
            duration_ms=elapsed_ms(started),
        )
        raise
    if not text or not text.strip():
        error = JobError(
            "LLM_BAD_OUTPUT", f"respons {key.provider} kosong", terminal=False
        )
        emit(
            log,
            "provider.request.failed",
            level=logging.WARNING,
            provider=key.provider,
            operation="generate",
            status_code=resp.status_code,
            error_code=error.code,
            duration_ms=elapsed_ms(started),
        )
        raise error
    emit(
        log,
        "provider.request.completed",
        provider=key.provider,
        operation="generate",
        status_code=resp.status_code,
        result_count=len(text),
        duration_ms=elapsed_ms(started),
    )
    return text
