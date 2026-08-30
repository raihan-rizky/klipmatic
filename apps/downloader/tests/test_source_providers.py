from pathlib import Path
from unittest.mock import MagicMock

from app.errors import JobError
from app.providers.cobalt import CobaltProvider
from app.ytdlp import SourceMeta


def test_cobalt_probe_normalizes_metadata():
    client = MagicMock()
    client.post.return_value = {
        "status": "tunnel",
        "url": "http://cobalt/tunnel/file.mp4",
        "filename": "video.mp4",
    }
    provider = CobaltProvider("http://cobalt:9000", client=client)
    result = provider.probe("https://youtu.be/example")
    assert result.provider == "cobalt"
    assert result.media_url.endswith("file.mp4")


def test_cobalt_failure_becomes_source_blocked():
    client = MagicMock()
    client.post.side_effect = RuntimeError("blocked")
    provider = CobaltProvider("http://cobalt:9000", client=client)
    try:
        provider.probe("https://youtu.be/example")
    except JobError as error:
        assert error.code == "SOURCE_BLOCKED"
    else:
        raise AssertionError("expected provider failure")


def test_fixture_metadata_is_explicitly_non_original():
    meta = SourceMeta(
        "fixture",
        "Klipmatic Test",
        60,
        None,
        "fixture",
        provider="guest_fixture",
        is_fixture=True,
    )
    assert meta.is_fixture is True
    assert meta.availability == "fixture"
