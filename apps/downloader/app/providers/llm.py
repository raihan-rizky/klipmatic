from __future__ import annotations

from typing import Any

import httpx

from app.crypto import ApiKeyRecord
from app.errors import JobError

GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta"
ANTHROPIC_BASE = "https://api.anthropic.com/v1"
MAX_OUTPUT_TOKENS = 8192
TEMPERATURE = 0.4


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
    resp = client.post(url, headers=headers, json=payload, timeout=180)

    if resp.status_code in (401, 403, 429):
        # 429 di sini berarti kuota milik user habis, bukan sistem kita
        # kelebihan beban. Mencoba ulang hanya membuang percobaan dan menunda
        # pesan yang seharusnya user lihat.
        raise JobError(
            "BYOK_INVALID",
            f"provider {key.provider} menolak kredensial (HTTP {resp.status_code})",
            terminal=True,
        )
    if resp.status_code != 200:
        raise JobError(
            "LLM_BAD_OUTPUT",
            f"provider {key.provider} membalas HTTP {resp.status_code}",
            terminal=False,
        )

    text = _extract_text(key.provider, resp.json())
    if not text or not text.strip():
        raise JobError("LLM_BAD_OUTPUT", f"respons {key.provider} kosong", terminal=False)
    return text
