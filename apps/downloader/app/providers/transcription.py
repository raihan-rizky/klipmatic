from __future__ import annotations

import logging
import os
import time
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

import httpx

from app.errors import JobError
from app.observability import elapsed_ms, emit

log = logging.getLogger(__name__)

DEFAULT_CACHE_MODEL = "whisper-large-v3-turbo"


@dataclass(frozen=True)
class ProviderConfig:
    """Satu penyedia transkripsi OpenAI-compatible.

    Seluruhnya berasal dari environment; tidak ada nama penyedia yang
    di-hardcode di source. Mengganti atau menambah penyedia adalah perubahan
    konfigurasi, bukan perubahan kode. Lihat
    docs/adr/0001-transcription-provider.md.
    """

    name: str
    url: str
    key: str
    model: str
    usd_per_min: float


@dataclass(frozen=True)
class Word:
    text: str
    start: float
    end: float


@dataclass(frozen=True)
class TranscriptResult:
    language: str
    text: str
    words: list[Word]
    provider: str
    model: str
    cost_usd: float
    timing_precision: str = "word"


def _env(source: Mapping[str, str] | None) -> Mapping[str, str]:
    return source if source is not None else os.environ


def cache_model(env: Mapping[str, str] | None = None) -> str:
    """Nama model logis yang dicatat di tabel transcripts.

    Kunci cache transkrip adalah (source_id, model). Bila nilainya mengikuti
    id model masing-masing penyedia, fallback ke penyedia lain akan meleset
    dari cache dan menagih ulang untuk sumber yang sama. Karena itu dipakai
    satu nama logis yang stabil lintas penyedia.
    """
    return _env(env).get("TRANSCRIBE_CACHE_MODEL") or DEFAULT_CACHE_MODEL


def load_providers(env: Mapping[str, str] | None = None) -> list[ProviderConfig]:
    e = _env(env)
    names = [n.strip() for n in e.get("TRANSCRIBE_PROVIDERS", "").split(",") if n.strip()]

    out: list[ProviderConfig] = []
    for name in names:
        prefix = f"TRANSCRIBE_{name.upper()}_"
        url, key, model = e.get(f"{prefix}URL"), e.get(f"{prefix}KEY"), e.get(f"{prefix}MODEL")
        if not (url and key and model):
            # Dilewati, bukan digagalkan: lazim menyiapkan beberapa penyedia
            # di .env tetapi baru mengisi kredensial sebagian.
            log.warning("provider transkripsi %s dilewati, konfigurasinya belum lengkap", name)
            continue
        try:
            usd_per_min = float(e.get(f"{prefix}USD_PER_MIN", "0") or 0)
        except ValueError:
            usd_per_min = 0.0
        out.append(
            ProviderConfig(name=name, url=url, key=key, model=model, usd_per_min=usd_per_min)
        )

    if not out:
        raise JobError(
            "TRANSCRIBE_FAILED",
            "tidak ada penyedia transkripsi yang terkonfigurasi; "
            "isi TRANSCRIBE_PROVIDERS beserta URL, KEY, dan MODEL masing-masing",
            terminal=False,
        )
    return out


def estimate_cost(cfg: ProviderConfig, duration_sec: int) -> float:
    return cfg.usd_per_min * duration_sec / 60.0


def parse_response(provider: str, body: dict, model: str) -> TranscriptResult:
    raw_words = body.get("words")
    if not raw_words:
        # Tanpa word timestamp, caption karaoke (P2) dan Editor C (P3) tidak
        # mungkin dibangun. Lebih baik gagal di sini dan mencoba penyedia lain
        # daripada menyimpan transkrip yang tidak dapat dipakai tahap berikutnya.
        raise JobError(
            "TRANSCRIBE_FAILED",
            f"{provider} tidak mengembalikan word-level timestamp",
            terminal=False,
        )
    words = [
        Word(text=w["word"], start=float(w["start"]), end=float(w["end"]))
        for w in raw_words
        if w.get("word") is not None
    ]
    return TranscriptResult(
        language=body.get("language") or "id",
        text=body.get("text") or "".join(w.text for w in words),
        words=words,
        provider=provider,
        model=model,
        cost_usd=0.0,  # diisi transcribe() dari tarif penyedia yang dipakai
    )


def _call(cfg: ProviderConfig, audio: Path, model: str, http: httpx.Client) -> TranscriptResult:
    resp = http.post(
        cfg.url,
        headers={"Authorization": f"Bearer {cfg.key}"},
        files={"file": (audio.name, audio.read_bytes(), "audio/ogg")},
        data={
            "model": cfg.model,
            "response_format": "verbose_json",
            "timestamp_granularities[]": "word",
            "language": "id",
        },
        timeout=600,
    )
    if resp.status_code != 200:
        # Badan respons sengaja tidak disertakan: sebagian gateway memantulkan
        # kembali header permintaan, termasuk Authorization.
        raise JobError(
            "TRANSCRIBE_FAILED",
            f"{cfg.name} membalas HTTP {resp.status_code}",
            terminal=False,
        )
    return parse_response(cfg.name, resp.json(), model)


def transcribe(
    audio: Path,
    duration_sec: int,
    *,
    http: httpx.Client | None = None,
    providers: list[ProviderConfig] | None = None,
    env: Mapping[str, str] | None = None,
    local_fn=None,
) -> TranscriptResult:
    """Transcribe locally by default; use HTTP providers only when explicit.

    The legacy HTTP provider chain remains available for explicit migration
    compatibility, but a free deployment needs no URL, key, or subscription.
    """
    e = _env(env)
    configured_names = e.get("TRANSCRIBE_PROVIDERS", "").strip()
    if providers is None and not configured_names:
        if local_fn is None:
            from app.providers.local_transcription import transcribe_local

            local_fn = transcribe_local
        started = time.monotonic()
        result = local_fn(audio, duration_sec, env=e)
        emit(
            log,
            "provider.request.completed",
            provider=result.provider,
            operation="transcribe",
            attempt=1,
            result_count=len(result.words),
            duration_ms=elapsed_ms(started),
        )
        return result

    chain = providers if providers is not None else load_providers(e)
    model = cache_model(env)
    client = http or httpx.Client(timeout=600)

    errors: list[str] = []
    for attempt, cfg in enumerate(chain, start=1):
        started = time.monotonic()
        try:
            result = _call(cfg, audio, model, client)
            final = TranscriptResult(
                language=result.language,
                text=result.text,
                words=result.words,
                provider=cfg.name,
                model=model,
                cost_usd=estimate_cost(cfg, duration_sec),
            )
            emit(
                log,
                "provider.request.completed",
                provider=cfg.name,
                operation="transcribe",
                attempt=attempt,
                result_count=len(final.words),
                duration_ms=elapsed_ms(started),
            )
            return final
        except JobError as error:
            emit(
                log,
                "provider.request.failed",
                level=logging.WARNING,
                provider=cfg.name,
                operation="transcribe",
                attempt=attempt,
                error_code=error.code,
                duration_ms=elapsed_ms(started),
            )
            errors.append(f"{cfg.name}: {error}")

    raise JobError("TRANSCRIBE_FAILED", "; ".join(errors), terminal=False)
