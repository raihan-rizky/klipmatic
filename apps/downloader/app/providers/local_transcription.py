from __future__ import annotations

import logging
import os
from collections.abc import Mapping
from functools import lru_cache
from pathlib import Path

from app.providers.transcription import TranscriptResult, Word, cache_model

log = logging.getLogger(__name__)
DEFAULT_MODEL = "small"


def _env(source: Mapping[str, str] | None) -> Mapping[str, str]:
    return source if source is not None else os.environ


@lru_cache(maxsize=2)
def _load_model(model_name: str, device: str, compute_type: str):
    from faster_whisper import WhisperModel

    return WhisperModel(model_name, device=device, compute_type=compute_type)


def _distribute(text: str, start: float, end: float) -> list[Word]:
    tokens = text.split()
    if not tokens or end <= start:
        return []
    width = (end - start) / len(tokens)
    return [
        Word(token, start + index * width, start + (index + 1) * width)
        for index, token in enumerate(tokens)
    ]


def transcribe_local(
    audio: Path,
    duration_sec: int,
    *,
    env: Mapping[str, str] | None = None,
    model=None,
) -> TranscriptResult:
    """Transcribe locally with faster-whisper; no API key or hosted service."""
    e = _env(env)
    model_name = e.get("LOCAL_WHISPER_MODEL", DEFAULT_MODEL)
    device = e.get("LOCAL_WHISPER_DEVICE", "cpu")
    compute_type = e.get("LOCAL_WHISPER_COMPUTE_TYPE", "int8")
    whisper = model or _load_model(model_name, device, compute_type)
    segments, info = whisper.transcribe(
        str(audio),
        language=e.get("LOCAL_WHISPER_LANGUAGE", "id"),
        word_timestamps=True,
        vad_filter=True,
    )

    words: list[Word] = []
    text_parts: list[str] = []
    for segment in segments:
        text = str(getattr(segment, "text", "") or "").strip()
        if text:
            text_parts.append(text)
        segment_start = max(float(getattr(segment, "start", 0.0)), 0.0)
        segment_end = max(float(getattr(segment, "end", segment_start)), segment_start)
        segment_words = getattr(segment, "words", None) or []
        parsed = [
            Word(
                str(getattr(word, "word", "") or "").strip(),
                max(float(getattr(word, "start", segment_start)), 0.0),
                max(float(getattr(word, "end", segment_end)), segment_start),
            )
            for word in segment_words
            if str(getattr(word, "word", "") or "").strip()
        ]
        words.extend(parsed or _distribute(text, segment_start, segment_end))

    if not words:
        raise RuntimeError("local Whisper tidak menghasilkan word timestamp")
    return TranscriptResult(
        language=getattr(info, "language", None) or e.get("LOCAL_WHISPER_LANGUAGE", "id"),
        text=" ".join(text_parts) or " ".join(word.text for word in words),
        words=words,
        provider="local_whisper",
        model=cache_model(e),
        cost_usd=0.0,
        timing_precision="word",
    )
