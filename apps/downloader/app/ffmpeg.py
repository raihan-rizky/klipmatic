from __future__ import annotations

import hashlib
import json
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from app.errors import JobError

# Whisper mengharapkan 16 kHz mono. Menghasilkannya di sini membuat berkas
# kecil (~40 MB per jam) dan menghemat kerja di sisi penyedia transkripsi.
SAMPLE_RATE = 16000
BITRATE = "24k"


@dataclass(frozen=True)
class MediaProbe:
    media_type: Literal["image", "audio", "video"]
    duration_sec: float | None
    width: int | None
    height: int | None
    has_audio: bool


def _positive_float(value: object) -> float | None:
    try:
        number = float(str(value))
    except (TypeError, ValueError):
        return None
    return number if number > 0 else None


def probe_media(path: Path) -> MediaProbe:
    """Read trusted media metadata with ffprobe, never from upload headers."""
    proc = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_streams",
            "-show_format",
            "-of",
            "json",
            str(path),
        ],
        capture_output=True,
        text=True,
        timeout=60,
    )
    if proc.returncode != 0:
        raise JobError("ASSET_INVALID", f"ffprobe gagal: {proc.stderr[-500:]}", terminal=True)
    try:
        payload = json.loads(proc.stdout)
    except json.JSONDecodeError as error:
        raise JobError("ASSET_INVALID", "hasil ffprobe tidak valid", terminal=True) from error

    streams = payload.get("streams") if isinstance(payload, dict) else None
    streams = streams if isinstance(streams, list) else []
    visual = next(
        (stream for stream in streams if isinstance(stream, dict) and stream.get("codec_type") == "video"),
        None,
    )
    audio = next(
        (stream for stream in streams if isinstance(stream, dict) and stream.get("codec_type") == "audio"),
        None,
    )
    if visual is None and audio is None:
        raise JobError("ASSET_INVALID", "file tidak memiliki stream media", terminal=True)

    format_data = payload.get("format") if isinstance(payload, dict) else {}
    format_data = format_data if isinstance(format_data, dict) else {}
    durations = [_positive_float(format_data.get("duration"))]
    durations.extend(
        _positive_float(stream.get("duration"))
        for stream in streams
        if isinstance(stream, dict)
    )
    duration = max((value for value in durations if value is not None), default=None)

    if visual is None:
        return MediaProbe("audio", duration, None, None, True)

    format_name = str(format_data.get("format_name") or "")
    codec_name = str(visual.get("codec_name") or "")
    still_image = (
        any(marker in format_name for marker in ("image2", "png_pipe", "jpeg_pipe", "webp_pipe"))
        or (duration is None and codec_name in {"png", "mjpeg", "webp"})
    )
    media_type: Literal["image", "video"] = "image" if still_image else "video"
    if media_type == "video" and duration is None:
        raise JobError("ASSET_INVALID", "durasi video tidak ditemukan", terminal=True)
    return MediaProbe(
        media_type,
        duration,
        int(visual["width"]) if visual.get("width") else None,
        int(visual["height"]) if visual.get("height") else None,
        audio is not None,
    )


def extract_audio(src: Path, dest: Path) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    proc = subprocess.run(
        [
            "ffmpeg", "-i", str(src), "-vn",
            "-ac", "1", "-ar", str(SAMPLE_RATE),
            "-c:a", "libopus", "-b:a", BITRATE,
            "-y", str(dest),
        ],
        capture_output=True,
        text=True,
        timeout=1800,
    )
    if proc.returncode != 0 or not dest.exists():
        raise JobError("INTERNAL", f"ffmpeg gagal: {proc.stderr[-500:]}")
    return dest


def extract_thumbnail(src: Path, dest: Path) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    proc = subprocess.run(
        [
            "ffmpeg",
            "-i",
            str(src),
            "-frames:v",
            "1",
            "-vf",
            "scale=640:360:force_original_aspect_ratio=increase,crop=640:360",
            "-c:v",
            "libwebp",
            "-quality",
            "78",
            "-y",
            str(dest),
        ],
        capture_output=True,
        text=True,
        timeout=120,
    )
    if proc.returncode != 0 or not dest.exists():
        raise JobError("INTERNAL", f"thumbnail ffmpeg gagal: {proc.stderr[-500:]}")
    return dest


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()
