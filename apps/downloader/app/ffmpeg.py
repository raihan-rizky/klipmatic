from __future__ import annotations

import hashlib
import subprocess
from pathlib import Path

from app.errors import JobError

# Whisper mengharapkan 16 kHz mono. Menghasilkannya di sini membuat berkas
# kecil (~40 MB per jam) dan menghemat kerja di sisi penyedia transkripsi.
SAMPLE_RATE = 16000
BITRATE = "24k"


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


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()
