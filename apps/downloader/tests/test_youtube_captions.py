import json
import subprocess

import pytest

from app.providers.youtube_captions import (
    caption_first_enabled,
    fetch_youtube_caption,
    parse_json3,
    preferred_languages,
)


def _body() -> dict:
    return {
        "events": [
            {
                "tStartMs": 0,
                "dDurationMs": 20000,
                "segs": [
                    {"utf8": "Ini adalah caption bahasa Indonesia ", "tOffsetMs": 0},
                    {"utf8": "dengan timestamp per segmen yang jelas", "tOffsetMs": 9000},
                ],
            },
            {
                "tStartMs": 20000,
                "dDurationMs": 20000,
                "segs": [
                    {
                        "utf8": "dan jumlah kata yang cukup untuk melewati validasi kualitas",
                        "tOffsetMs": 0,
                    }
                ],
            },
        ]
    }


def _env(**overrides: str) -> dict[str, str]:
    values = {
        "TRANSCRIBE_CACHE_MODEL": "hybrid-v1",
        "YOUTUBE_CAPTION_MIN_COVERAGE": "0.3",
        "YOUTUBE_CAPTION_MIN_WORDS": "10",
    }
    values.update(overrides)
    return values


def test_parse_json3_menjadi_transkrip_gratis_dengan_timestamp_monoton():
    result = parse_json3(_body(), language="id", duration_sec=60, env=_env())

    assert result is not None
    assert result.provider == "youtube_caption"
    assert result.model == "hybrid-v1"
    assert result.cost_usd == 0.0
    assert result.timing_precision == "estimated"
    assert len(result.words) >= 10
    assert all(a.end <= b.start for a, b in zip(result.words, result.words[1:]))


def test_caption_ditolak_bila_coverage_terlalu_rendah():
    result = parse_json3(
        _body(),
        language="id",
        duration_sec=600,
        env=_env(YOUTUBE_CAPTION_MIN_COVERAGE="0.5"),
    )
    assert result is None


def test_caption_ditolak_bila_katanya_terlalu_sedikit():
    result = parse_json3(
        _body(),
        language="id",
        duration_sec=60,
        env=_env(YOUTUBE_CAPTION_MIN_WORDS="100"),
    )
    assert result is None


def test_fetch_memilih_bahasa_sesuai_prioritas(tmp_path, monkeypatch):
    seen: list[str] = []

    def fake_run(args, **kwargs):
        seen.extend(args)
        output = args[args.index("-o") + 1]
        path = output.replace("%(ext)s", "id.json3")
        with open(path, "w", encoding="utf-8") as file:
            json.dump(_body(), file)
        return subprocess.CompletedProcess(args, 0, "", "")

    monkeypatch.setattr("app.providers.youtube_captions.subprocess.run", fake_run)
    result = fetch_youtube_caption(
        "https://youtu.be/x",
        60,
        tmp_path,
        env=_env(YOUTUBE_CAPTION_LANGS="id,en"),
    )

    assert result is not None
    assert result.language == "id"
    assert seen[seen.index("--sub-langs") + 1] == "id,en"
    assert "--write-subs" in seen
    assert "--write-auto-subs" in seen


def test_fetch_tanpa_file_caption_mengembalikan_none(tmp_path, monkeypatch):
    monkeypatch.setattr(
        "app.providers.youtube_captions.subprocess.run",
        lambda args, **kwargs: subprocess.CompletedProcess(args, 0, "", ""),
    )
    assert fetch_youtube_caption("https://youtu.be/x", 60, tmp_path, env=_env()) is None


def test_fetch_timeout_mengembalikan_none_agar_audio_jadi_fallback(tmp_path, monkeypatch):
    def timeout(*args, **kwargs):
        raise subprocess.TimeoutExpired("yt-dlp", 300)

    monkeypatch.setattr("app.providers.youtube_captions.subprocess.run", timeout)
    assert fetch_youtube_caption("https://youtu.be/x", 60, tmp_path, env=_env()) is None


@pytest.mark.parametrize("raw,expected", [("false", False), ("0", False), ("true", True)])
def test_caption_first_dapat_dimatikan_lewat_env(raw, expected):
    assert caption_first_enabled({"YOUTUBE_CAPTION_FIRST": raw}) is expected


def test_daftar_bahasa_dapat_dikonfigurasi():
    assert preferred_languages({"YOUTUBE_CAPTION_LANGS": "id,en-US"}) == ("id", "en-US")
