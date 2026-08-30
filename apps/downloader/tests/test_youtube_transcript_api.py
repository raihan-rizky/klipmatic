from dataclasses import dataclass
from typing import ClassVar

import pytest

from app.providers.youtube_transcript_api import (
    extract_video_id,
    fetch_youtube_transcript,
)


@dataclass
class Snippet:
    text: str
    start: float
    duration: float


class FakeTranscript:
    language_code = "id"
    snippets: ClassVar[list[Snippet]] = [
        Snippet("halo", 0.0, 1.0),
        Snippet("ini", 1.0, 1.0),
        Snippet("transkrip", 2.0, 1.0),
    ]


class FakeClient:
    def fetch(self, video_id, languages):
        assert video_id == "dQw4w9WgXcQ"
        assert languages == ["id", "en"]
        return FakeTranscript()


def test_extract_video_id_supports_watch_and_short_url():
    assert extract_video_id("https://www.youtube.com/watch?v=dQw4w9WgXcQ") == "dQw4w9WgXcQ"
    assert extract_video_id("https://youtu.be/dQw4w9WgXcQ?t=10") == "dQw4w9WgXcQ"


def test_fetch_returns_free_timestamped_transcript():
    result = fetch_youtube_transcript(
        "https://youtu.be/dQw4w9WgXcQ",
        duration_sec=3,
        env={"YOUTUBE_CAPTION_LANGS": "id,en", "YOUTUBE_TRANSCRIPT_MIN_WORDS": "3"},
        client=FakeClient(),
    )

    assert result is not None
    assert result.provider == "youtube_transcript_api"
    assert result.cost_usd == 0.0
    assert [word.text for word in result.words] == ["halo", "ini", "transkrip"]


def test_fetch_rejects_invalid_video_url():
    with pytest.raises(ValueError, match="video ID"):
        fetch_youtube_transcript("https://example.com/video", 10, client=FakeClient())


def test_fetch_returns_none_when_no_transcript():
    class EmptyClient:
        def fetch(self, video_id, languages):
            raise RuntimeError("no transcript")

    assert fetch_youtube_transcript("https://youtu.be/dQw4w9WgXcQ", 10, client=EmptyClient()) is None
