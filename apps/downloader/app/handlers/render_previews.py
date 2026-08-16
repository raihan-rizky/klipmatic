"""Render 9:16 face-cropped preview untuk top-10 kandidat sebuah project.

Alur per kandidat: download segment → extract frame sampel → deteksi wajah →
crop ke jendela 9:16 berpusat pada fokus → encode cepat → upload R2 → update
preview_status. Satu kegagalan tidak menghentikan batch; heartbeat dikirim
setelah tiap kandidat supaya reaper tidak menganggap job mati.
"""
from __future__ import annotations

import logging
import shutil
import tempfile
from collections.abc import Callable
from pathlib import Path

import psycopg

from app.errors import JobError
from app.face_focus import compute_focus_x as _default_compute_focus_x
from app.ffmpeg import crop_vertical as _default_crop_vertical
from app.ffmpeg import sha256_file
from app.queue import Job, heartbeat
from app.storage import Storage, storage_from_env
from app.ytdlp import download_section as _default_download_section

log = logging.getLogger(__name__)

FRAMES_PER_CANDIDATE_FPS = 0.5  # ~1 frame setiap 2 detik
MAX_FRAMES_PER_CANDIDATE = 16


def _extract_frames(src: Path, dest_dir: Path, fps: float = FRAMES_PER_CANDIDATE_FPS) -> list[Path]:
    """Ambil N frame JPEG dari video untuk analisis wajah."""
    from app.subprocesses import run_command

    dest_dir.mkdir(parents=True, exist_ok=True)
    pattern = str(dest_dir / "frame_%04d.jpg")
    proc = run_command(
        [
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
            "-i", str(src),
            "-vf", f"fps={fps}",
            "-frames:v", str(MAX_FRAMES_PER_CANDIDATE),
            "-q:v", "5",
            pattern,
        ],
        tool="ffmpeg",
        operation="extract_preview_frames",
        timeout_sec=300,
    )
    if proc.returncode != 0:
        log.warning("frame extraction gagal: %s", proc.stderr[-300:])
        return []
    return sorted(dest_dir.glob("frame_*.jpg"))


def handle_render_previews(
    conn: psycopg.Connection,
    job: Job,
    *,
    storage: Storage | None = None,
    download: Callable[..., Path] = _default_download_section,
    extract_frames: Callable[[Path, Path, float], list[Path]] = _extract_frames,
    compute_focus: Callable[[list[Path]], float] = _default_compute_focus_x,
    crop: Callable[..., Path] = _default_crop_vertical,
    workdir: Path | None = None,
) -> None:
    storage = storage or storage_from_env()
    project_id = str(job.payload.get("project_id") or "")

    owned = conn.execute(
        "select s.url_original from projects p join sources s on s.id = p.source_id "
        "where p.id = %s and p.user_id = %s",
        (project_id, job.user_id),
    ).fetchone()
    if owned is None:
        raise JobError("INTERNAL", "project/source tidak ditemukan", terminal=True)
    source_url = str(owned[0])

    rows = conn.execute(
        "select id, start_sec, end_sec from clip_candidates "
        "where project_id = %s order by score desc, start_sec asc limit 10",
        (project_id,),
    ).fetchall()
    if not rows:
        return

    owns_workdir = workdir is None
    root = workdir or Path(tempfile.mkdtemp(prefix="cc-renders-"))
    try:
        for index, (candidate_id, raw_start, raw_end) in enumerate(rows):
            cid = str(candidate_id)
            start, end = float(raw_start), float(raw_end)
            try:
                seg_dir = root / f"{cid}_seg"
                seg_dir.mkdir(exist_ok=True)
                segment = seg_dir / "segment.mp4"
                download(source_url, start, end, segment)

                frames_dir = root / f"{cid}_frames"
                frames = extract_frames(segment, frames_dir, FRAMES_PER_CANDIDATE_FPS)
                focus_x = compute_focus(frames)

                out_dir = root / f"{cid}_out"
                out_dir.mkdir(exist_ok=True)
                cropped = out_dir / "preview.mp4"
                crop(segment, cropped, focus_x)

                key = f"previews/{sha256_file(cropped)}.mp4"
                storage.put_file(key, cropped, "video/mp4")

                conn.execute(
                    "update clip_candidates set preview_status = 'ready', preview_r2_key = %s "
                    "where id = %s and project_id = %s",
                    (key, cid, project_id),
                )
                conn.commit()
            except Exception as exc:  # satu kandidat gagal tidak menghentikan batch
                error_code = exc.code if isinstance(exc, JobError) else "INTERNAL"
                log.exception(
                    "preview render gagal untuk kandidat %s", cid,
                    extra={"error_code": error_code},
                )
                try:
                    conn.execute(
                        "update clip_candidates set preview_status = 'failed', preview_r2_key = null "
                        "where id = %s and project_id = %s",
                        (cid, project_id),
                    )
                    conn.commit()
                except Exception:
                    log.exception("gagal mencatat status failed untuk kandidat %s", cid)
            heartbeat(conn, job.id, (index + 1) * 100 // len(rows))
    finally:
        if owns_workdir:
            shutil.rmtree(root, ignore_errors=True)
