from __future__ import annotations

import json
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from app.errors import JobError

MAX_DURATION_SEC = 4 * 60 * 60  # Spec §9.1

# Urutan penting: pola paling spesifik lebih dulu.
_ERROR_PATTERNS: list[tuple[str, str, bool]] = [
    (r"not made this video available in your country|geo.?restrict", "SOURCE_GEOBLOCKED", True),
    (r"confirm your age|age.?restrict", "SOURCE_AGE_RESTRICTED", True),
    (r"not a bot|Sign in to confirm|too many requests|HTTP Error 429", "SOURCE_BLOCKED", False),
    (r"unable to extract|player response|nsig extraction", "SOURCE_BLOCKED", False),
    (
        r"private video|is private|removed by the uploader|Video unavailable|does not exist",
        "SOURCE_UNAVAILABLE",
        True,
    ),
]


@dataclass(frozen=True)
class SourceMeta:
    title: str
    channel: str | None
    duration_sec: int
    thumbnail_url: str | None
    availability: str


def classify_ytdlp_error(stderr: str) -> JobError:
    """Memetakan stderr yt-dlp ke kode stabil.

    Stderr mentah masuk ke pesan exception untuk log operator, tidak pernah
    ke user.
    """
    for pattern, code, terminal in _ERROR_PATTERNS:
        if re.search(pattern, stderr, re.IGNORECASE):
            return JobError(code, stderr[:500], terminal=terminal)
    return JobError("INTERNAL", stderr[:500], terminal=False)


def parse_meta(raw: dict[str, Any]) -> SourceMeta:
    duration = raw.get("duration")
    if not duration:
        # Siaran langsung dan sebagian sumber tidak melaporkan durasi. Tanpa
        # durasi kita tidak bisa menghitung biaya maupun memotong segmen.
        raise JobError("SOURCE_UNAVAILABLE", "durasi tidak diketahui", terminal=True)
    duration = int(duration)
    if duration > MAX_DURATION_SEC:
        raise JobError("SOURCE_TOO_LONG", f"durasi {duration}s", terminal=True)
    return SourceMeta(
        title=raw.get("title") or "Tanpa judul",
        channel=raw.get("uploader") or raw.get("channel"),
        duration_sec=duration,
        thumbnail_url=raw.get("thumbnail"),
        availability=raw.get("availability") or "public",
    )


def _run(args: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, capture_output=True, text=True, timeout=1800)


def probe(url: str) -> SourceMeta:
    proc = _run(["yt-dlp", "-J", "--no-warnings", "--no-playlist", url])
    if proc.returncode != 0:
        raise classify_ytdlp_error(proc.stderr)
    return parse_meta(json.loads(proc.stdout))


_PROGRESS_RE = re.compile(r"\[download\]\s+(\d+(?:\.\d+)?)%")


def download_audio(url: str, dest: Path, on_progress: Callable[[int], None]) -> Path:
    """Mengunduh trek audio saja (fase 1 dari download dua fase, spec §3.1)."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    proc = subprocess.Popen(
        [
            "yt-dlp",
            "-f",
            "bestaudio/best",
            "--no-playlist",
            "--no-warnings",
            "--newline",
            "-o",
            str(dest),
            url,
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    assert proc.stdout is not None
    for line in proc.stdout:
        m = _PROGRESS_RE.search(line)
        if m:
            on_progress(int(float(m.group(1))))
    proc.wait(timeout=3600)
    if proc.returncode != 0:
        raise classify_ytdlp_error(proc.stderr.read() if proc.stderr else "")
    if not dest.exists():
        raise JobError("INTERNAL", "yt-dlp selesai tanpa menghasilkan berkas")
    return dest


def download_section(url: str, start: float, end: float, dest: Path) -> Path:
    """Mengunduh satu rentang waktu saja (fase 2, spec §3.1).

    --force-keyframes-at-cuts memaksa yt-dlp memotong tepat di batas yang
    diminta alih-alih di keyframe terdekat, sehingga awal klip tidak meleset.

    Format dikunci ke H.264 (avc1) maksimal 1080p: WebCodecs mendekode H.264
    secara hardware di seluruh platform sedangkan AV1 belum merata, jadi
    pembatasan ini menghindari transcoding di server pada P2.
    """
    dest.parent.mkdir(parents=True, exist_ok=True)
    proc = _run(
        [
            "yt-dlp",
            "--download-sections",
            f"*{start:.3f}-{end:.3f}",
            "--force-keyframes-at-cuts",
            "-f",
            "bestvideo[height<=1080][vcodec^=avc1]+bestaudio/best[height<=1080]",
            "--merge-output-format",
            "mp4",
            "--no-playlist",
            "--no-warnings",
            "-o",
            str(dest),
            url,
        ]
    )
    if proc.returncode != 0:
        raise classify_ytdlp_error(proc.stderr)
    if not dest.exists():
        raise JobError("INTERNAL", "yt-dlp selesai tanpa menghasilkan segmen")
    return dest
