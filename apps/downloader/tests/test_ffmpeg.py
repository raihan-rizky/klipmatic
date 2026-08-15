import json
import logging
import subprocess
from pathlib import Path

import pytest

from app import ffmpeg
from app.ffmpeg import extract_audio, sha256_file


@pytest.fixture
def tone(tmp_path: Path) -> Path:
    """Membuat berkas WAV 2 detik dengan ffmpeg agar tes tidak butuh aset biner."""
    out = tmp_path / "tone.wav"
    subprocess.run(
        [
            "ffmpeg", "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
            "-ac", "2", "-ar", "44100", "-y", str(out),
        ],
        check=True,
        capture_output=True,
    )
    return out


def _probe(path: Path) -> dict:
    """Membaca properti stream audio berdasarkan nama.

    Output `default=` mengikuti urutan field di stream, bukan urutan yang
    diminta, sehingga pengaksesan berdasarkan posisi mudah salah.
    """
    out = subprocess.run(
        [
            "ffprobe", "-v", "error", "-select_streams", "a:0",
            "-show_entries", "stream=codec_name,channels,sample_rate",
            "-of", "json", str(path),
        ],
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    return json.loads(out)["streams"][0]


def test_extract_audio_menghasilkan_opus_mono(tone: Path, tmp_path: Path):
    dest = tmp_path / "out.opus"
    extract_audio(tone, dest)
    assert dest.exists() and dest.stat().st_size > 0

    stream = _probe(dest)
    assert stream["codec_name"] == "opus"
    assert stream["channels"] == 1

    # Opus selalu mendeklarasikan 48 kHz di container berapa pun laju input;
    # `-ar 16000` tetap bermakna karena libopus memakainya untuk memilih mode
    # pita sempit, tetapi laju itu tidak pernah muncul di metadata stream.
    assert stream["sample_rate"] == "48000"


def test_extract_audio_jauh_lebih_kecil_dari_sumber(tone: Path, tmp_path: Path):
    dest = tmp_path / "out.opus"
    extract_audio(tone, dest)
    assert dest.stat().st_size < tone.stat().st_size


def test_extract_audio_emits_safe_subprocess_events(
    tone: Path, tmp_path: Path, caplog
):
    caplog.set_level(logging.INFO)
    extract_audio(tone, tmp_path / "private-output.opus")
    events = [
        (record.event_name, record.event_fields)
        for record in caplog.records
        if hasattr(record, "event_name")
    ]
    assert [name for name, _fields in events] == [
        "subprocess.started",
        "subprocess.completed",
    ]
    assert events[-1][1]["tool"] == "ffmpeg"
    assert events[-1][1]["operation"] == "extract_audio"
    assert "private-output" not in caplog.text


def test_sha256_stabil_dan_membedakan_isi(tmp_path: Path):
    a, b = tmp_path / "a.bin", tmp_path / "b.bin"
    a.write_bytes(b"halo dunia")
    b.write_bytes(b"halo duniA")
    assert sha256_file(a) == sha256_file(a)
    assert sha256_file(a) != sha256_file(b)
    assert len(sha256_file(a)) == 64


def test_extract_thumbnail_menghasilkan_webp_16_9(tmp_path: Path):
    source = tmp_path / "source.mp4"
    subprocess.run(
        [
            "ffmpeg", "-f", "lavfi", "-i", "testsrc=size=320x240:duration=1",
            "-pix_fmt", "yuv420p", "-y", str(source),
        ],
        check=True,
        capture_output=True,
    )
    destination = tmp_path / "thumbnail.webp"

    ffmpeg.extract_thumbnail(source, destination)

    assert destination.exists() and destination.stat().st_size > 0
    dimensions = subprocess.run(
        [
            "ffprobe", "-v", "error", "-select_streams", "v:0",
            "-show_entries", "stream=width,height", "-of", "csv=p=0",
            str(destination),
        ],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    assert dimensions == "640,360"
