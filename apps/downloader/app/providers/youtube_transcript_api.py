from __future__ import annotations

import logging
import os
import re
from collections.abc import Mapping
from urllib.parse import parse_qs, urlparse

from app.providers.transcription import TranscriptResult, Word, cache_model

log = logging.getLogger(__name__)
_VIDEO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")
DEFAULT_LANGUAGES = ("id", "id-ID", "en")
DEFAULT_MIN_WORDS = 20


def _env(source: Mapping[str, str] | None) -> Mapping[str, str]:
    return source if source is not None else os.environ


def extract_video_id(url: str) -> str:
    parsed = urlparse(url)
    host = parsed.netloc.lower().split(":", 1)[0]
    if host in {"youtu.be", "www.youtu.be"}:
        candidate = parsed.path.strip("/").split("/", 1)[0]
    elif host.endswith("youtube.com"):
        if parsed.path == "/watch":
            candidate = parse_qs(parsed.query).get("v", [""])[0]
        elif parsed.path.startswith("/shorts/") or parsed.path.startswith("/embed/"):
            candidate = parsed.path.split("/")[2]
        else:
            candidate = ""
    else:
        candidate = ""
    if not _VIDEO_ID_RE.fullmatch(candidate):
        raise ValueError("URL tidak berisi video ID YouTube yang valid")
    return candidate


def _languages(env: Mapping[str, str] | None) -> list[str]:
    raw = _env(env).get("YOUTUBE_CAPTION_LANGS", ",".join(DEFAULT_LANGUAGES))
    return [part.strip() for part in raw.split(",") if part.strip()] or list(DEFAULT_LANGUAGES)


def _min_words(env: Mapping[str, str] | None) -> int:
    try:
        return max(1, int(_env(env).get("YOUTUBE_TRANSCRIPT_MIN_WORDS", DEFAULT_MIN_WORDS)))
    except (TypeError, ValueError):
        return DEFAULT_MIN_WORDS


def _client():
    from youtube_transcript_api import YouTubeTranscriptApi

    return YouTubeTranscriptApi()


def fetch_youtube_transcript(
    url: str,
    duration_sec: int,
    *,
    env: Mapping[str, str] | None = None,
    client=None,
) -> TranscriptResult | None:
    """Fetch a free, self-hosted YouTube transcript with timestamped words."""
    video_id = extract_video_id(url)
    client = client or _client()
    languages = _languages(env)
    try:
        fetched = client.fetch(video_id, languages=languages)
    except Exception as error:  # noqa: BLE001 - exceptions vary by library version
        log.info("youtube transcript fallback unavailable: %s", type(error).__name__)
        return None

    snippets = getattr(fetched, "snippets", None)
    if snippets is None:
        snippets = fetched
    words: list[Word] = []
    for snippet in snippets or []:
        text = str(getattr(snippet, "text", "") or "").strip()
        start = max(float(getattr(snippet, "start", 0.0)), 0.0)
        end = start + max(float(getattr(snippet, "duration", 0.0)), 0.0)
        if text and end > start:
            words.append(Word(text, start, min(end, float(duration_sec)) if duration_sec else end))
    if len(words) < _min_words(env):
        return None

    return TranscriptResult(
        language=getattr(fetched, "language_code", None) or languages[0],
        text=" ".join(word.text for word in words),
        words=words,
        provider="youtube_transcript_api",
        model=cache_model(env),
        cost_usd=0.0,
        timing_precision="estimated",
    )
