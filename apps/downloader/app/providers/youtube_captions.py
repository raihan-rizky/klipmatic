from __future__ import annotations

import json
import logging
import os
import re
import subprocess
from pathlib import Path
from typing import Any, Mapping

from app.providers.transcription import TranscriptResult, Word, cache_model

log = logging.getLogger(__name__)

DEFAULT_LANGUAGES = ("id", "id-ID")
DEFAULT_MIN_COVERAGE = 0.35
DEFAULT_MIN_WORDS = 20
_TOKEN_RE = re.compile(r"\S+")


def _env(source: Mapping[str, str] | None) -> Mapping[str, str]:
    return source if source is not None else os.environ


def caption_first_enabled(env: Mapping[str, str] | None = None) -> bool:
    return (_env(env).get("YOUTUBE_CAPTION_FIRST", "true").strip().lower()) not in {
        "0",
        "false",
        "no",
        "off",
    }


def preferred_languages(env: Mapping[str, str] | None = None) -> tuple[str, ...]:
    raw = _env(env).get("YOUTUBE_CAPTION_LANGS", ",".join(DEFAULT_LANGUAGES))
    languages = tuple(part.strip() for part in raw.split(",") if part.strip())
    return languages or DEFAULT_LANGUAGES


def _thresholds(env: Mapping[str, str] | None) -> tuple[float, int]:
    e = _env(env)
    try:
        coverage = float(e.get("YOUTUBE_CAPTION_MIN_COVERAGE", DEFAULT_MIN_COVERAGE))
    except (TypeError, ValueError):
        coverage = DEFAULT_MIN_COVERAGE
    try:
        words = int(e.get("YOUTUBE_CAPTION_MIN_WORDS", DEFAULT_MIN_WORDS))
    except (TypeError, ValueError):
        words = DEFAULT_MIN_WORDS
    return min(max(coverage, 0.0), 1.0), max(words, 1)


def _distribute(text: str, start: float, end: float) -> list[Word]:
    tokens = _TOKEN_RE.findall(text.replace("\n", " "))
    if not tokens or end <= start:
        return []

    # Pembagian berbobot panjang kata terasa lebih natural daripada membagi
    # rata: kata panjang biasanya memang memakan waktu ucap lebih lama.
    weights = [max(len(token.strip()), 1) for token in tokens]
    total = sum(weights)
    cursor = start
    words: list[Word] = []
    for index, (token, weight) in enumerate(zip(tokens, weights, strict=True)):
        token_end = end if index == len(tokens) - 1 else cursor + (end - start) * weight / total
        words.append(Word(token, cursor, token_end))
        cursor = token_end
    return words


def _cue_words(event: dict[str, Any], cue_end: float) -> list[Word]:
    start = max(float(event.get("tStartMs") or 0) / 1000.0, 0.0)
    segments = [
        segment
        for segment in event.get("segs") or []
        if isinstance(segment, dict) and str(segment.get("utf8") or "").strip()
    ]
    if not segments:
        return []

    words: list[Word] = []
    for index, segment in enumerate(segments):
        segment_start = start + float(segment.get("tOffsetMs") or 0) / 1000.0
        if index + 1 < len(segments):
            next_offset = float(segments[index + 1].get("tOffsetMs") or 0) / 1000.0
            segment_end = start + next_offset if next_offset > 0 else cue_end
        else:
            segment_end = cue_end
        words.extend(_distribute(str(segment["utf8"]), segment_start, max(segment_end, segment_start)))

    # Beberapa JSON3 memberi semua segmen offset 0. Dalam kasus itu hasil di
    # atas saling tumpang tindih; lebih aman interpolasi seluruh cue.
    if any(a.start < b.end and b.start < a.end for a, b in zip(words, words[1:])):
        return _distribute("".join(str(segment["utf8"]) for segment in segments), start, cue_end)
    return words


def _merged_coverage(intervals: list[tuple[float, float]]) -> float:
    if not intervals:
        return 0.0
    total = 0.0
    current_start, current_end = sorted(intervals)[0]
    for start, end in sorted(intervals)[1:]:
        if start <= current_end:
            current_end = max(current_end, end)
        else:
            total += current_end - current_start
            current_start, current_end = start, end
    return total + current_end - current_start


def parse_json3(
    body: dict[str, Any],
    *,
    language: str,
    duration_sec: int,
    env: Mapping[str, str] | None = None,
) -> TranscriptResult | None:
    events = [event for event in body.get("events") or [] if isinstance(event, dict)]
    words: list[Word] = []
    intervals: list[tuple[float, float]] = []

    for index, event in enumerate(events):
        start = max(float(event.get("tStartMs") or 0) / 1000.0, 0.0)
        duration = float(event.get("dDurationMs") or 0) / 1000.0
        if duration <= 0 and index + 1 < len(events):
            duration = max(float(events[index + 1].get("tStartMs") or 0) / 1000.0 - start, 0.0)
        end = min(start + duration, float(duration_sec)) if duration_sec > 0 else start + duration
        cue = _cue_words(event, end)
        if not cue:
            continue
        words.extend(cue)
        intervals.append((start, end))

    # Urutkan dan buang timestamp invalid agar parser LLM tidak menerima kata
    # yang bergerak mundur akibat track caption rusak.
    words = sorted(
        (word for word in words if word.text.strip() and word.end > word.start),
        key=lambda word: (word.start, word.end),
    )
    monotonic: list[Word] = []
    for word in words:
        start = max(word.start, monotonic[-1].end if monotonic else 0.0)
        if word.end > start:
            monotonic.append(Word(word.text.strip(), start, word.end))

    min_coverage, min_words = _thresholds(env)
    coverage = _merged_coverage(intervals) / duration_sec if duration_sec > 0 else 0.0
    if len(monotonic) < min_words or coverage < min_coverage:
        log.info(
            "caption YouTube ditolak: words=%d coverage=%.3f (minimum %d/%.3f)",
            len(monotonic),
            coverage,
            min_words,
            min_coverage,
        )
        return None

    return TranscriptResult(
        language=language,
        text=" ".join(word.text for word in monotonic),
        words=monotonic,
        provider="youtube_caption",
        model=cache_model(env),
        cost_usd=0.0,
        timing_precision="estimated",
    )


def _caption_language(path: Path, prefix: str) -> str:
    name = path.name
    start = f"{prefix}."
    return name[len(start) : -len(".json3")] if name.startswith(start) else ""


def fetch_youtube_caption(
    url: str,
    duration_sec: int,
    workdir: Path,
    *,
    env: Mapping[str, str] | None = None,
) -> TranscriptResult | None:
    """Mengambil caption manual/otomatis lewat yt-dlp, lalu memvalidasinya.

    Semua kegagalan di jalur ini menjadi cache miss yang aman. Audio pipeline
    tetap menjadi fallback dan akan menerjemahkan error yt-dlp ke JobError
    seperti sebelumnya.
    """
    languages = preferred_languages(env)
    prefix = "youtube-caption"
    workdir.mkdir(parents=True, exist_ok=True)
    output = workdir / f"{prefix}.%(ext)s"
    try:
        proc = subprocess.run(
            [
                "yt-dlp",
                "--skip-download",
                "--no-playlist",
                "--no-warnings",
                "--write-subs",
                "--write-auto-subs",
                "--sub-langs",
                ",".join(languages),
                "--sub-format",
                "json3",
                "-o",
                str(output),
                url,
            ],
            capture_output=True,
            text=True,
            timeout=300,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        log.info("caption YouTube gagal diambil; fallback ke audio (%s)", type(error).__name__)
        return None
    if proc.returncode != 0:
        log.info("caption YouTube tidak tersedia; fallback ke audio (yt-dlp %d)", proc.returncode)
        return None

    paths = list(workdir.glob(f"{prefix}.*.json3"))
    by_language = {_caption_language(path, prefix): path for path in paths}
    for language in languages:
        path = by_language.get(language)
        if path is None:
            continue
        try:
            body = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            log.warning("caption YouTube %s rusak; mencoba track berikutnya", language)
            continue
        try:
            result = parse_json3(body, language=language, duration_sec=duration_sec, env=env)
        except (TypeError, ValueError):
            log.warning("timestamp caption YouTube %s rusak; mencoba track berikutnya", language)
            continue
        if result is not None:
            return result
    return None
