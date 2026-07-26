import json
from pathlib import Path

import pytest

from app.errors import JobError
from app.ytdlp import SourceMeta, classify_ytdlp_error, parse_meta

FIXTURES = Path(__file__).parent / "fixtures"


def test_parse_meta_membaca_field_yang_dipakai():
    raw = json.loads((FIXTURES / "ytdlp_youtube_ok.json").read_text(encoding="utf-8"))
    meta = parse_meta(raw)
    assert isinstance(meta, SourceMeta)
    assert meta.title
    assert meta.duration_sec > 0
    assert meta.availability == "public"


def test_parse_meta_menolak_durasi_melebihi_batas():
    with pytest.raises(JobError) as e:
        parse_meta({"title": "x", "duration": 5 * 3600, "availability": "public"})
    assert e.value.code == "SOURCE_TOO_LONG"
    assert e.value.terminal is True


def test_parse_meta_menolak_durasi_tidak_diketahui():
    with pytest.raises(JobError) as e:
        parse_meta({"title": "siaran langsung", "availability": "public"})
    assert e.value.code == "SOURCE_UNAVAILABLE"


@pytest.mark.parametrize(
    "stderr,code,terminal",
    [
        ("ERROR: Sign in to confirm you're not a bot", "SOURCE_BLOCKED", False),
        ("ERROR: Video unavailable. This video is private", "SOURCE_UNAVAILABLE", True),
        ("ERROR: This video has been removed by the uploader", "SOURCE_UNAVAILABLE", True),
        (
            "ERROR: Video unavailable. The uploader has not made this video available in your country",
            "SOURCE_GEOBLOCKED",
            True,
        ),
        ("ERROR: Sign in to confirm your age", "SOURCE_AGE_RESTRICTED", True),
        ("ERROR: Unable to extract player response", "SOURCE_BLOCKED", False),
        ("ERROR: sesuatu yang belum pernah terjadi", "INTERNAL", False),
    ],
)
def test_classify_ytdlp_error(stderr, code, terminal):
    err = classify_ytdlp_error(stderr)
    assert err.code == code
    assert err.terminal is terminal


def test_pesan_error_tidak_membocorkan_stderr_mentah_ke_kode():
    err = classify_ytdlp_error("ERROR: /home/rahasia/path/bocor.txt not found")
    assert err.code == "INTERNAL"
