from __future__ import annotations

import logging
import shutil
import tempfile
from pathlib import Path
from typing import Callable

import psycopg

from app.errors import JobError
from app.ffmpeg import extract_thumbnail as _extract_thumbnail
from app.ffmpeg import sha256_file
from app.queue import Job, heartbeat
from app.storage import Storage, storage_from_env
from app.ytdlp import download_section as _download_section

log = logging.getLogger(__name__)


def thumbnail_time(start: float, end: float) -> float:
    return start + min(2.0, (end - start) * 0.20)


def handle_prepare_thumbnails(
    conn: psycopg.Connection,
    job: Job,
    *,
    storage: Storage | None = None,
    download: Callable[[str, float, float, Path], Path] = _download_section,
    extract: Callable[[Path, Path], Path] = _extract_thumbnail,
    workdir: Path | None = None,
) -> None:
    storage = storage or storage_from_env()
    source_id = str(job.payload.get("source_id") or "")
    owned = conn.execute(
        "select s.url_original from projects p join sources s on s.id = p.source_id "
        "where p.id = %s and s.id = %s and p.user_id = %s",
        (job.project_id, source_id, job.user_id),
    ).fetchone()
    if owned is None:
        raise JobError("INTERNAL", "project thumbnail tidak ditemukan", terminal=True)

    rows = conn.execute(
        "select id, start_sec, end_sec from clip_candidates where project_id = %s "
        "order by score desc, start_sec asc limit 10",
        (job.project_id,),
    ).fetchall()
    owns_workdir = workdir is None
    root = workdir or Path(tempfile.mkdtemp(prefix="cc-thumbnails-"))
    try:
        for index, (candidate_id, raw_start, raw_end) in enumerate(rows):
            start, end = float(raw_start), float(raw_end)
            capture = thumbnail_time(start, end)
            segment = root / f"{candidate_id}.mp4"
            thumbnail = root / f"{candidate_id}.webp"
            try:
                download(str(owned[0]), capture, min(capture + 1.0, end), segment)
                extract(segment, thumbnail)
                key = f"candidate-thumbnails/{sha256_file(thumbnail)}.webp"
                storage.put_file(key, thumbnail, "image/webp")
                conn.execute(
                    "update clip_candidates set thumbnail_status = 'ready', "
                    "thumbnail_r2_key = %s where id = %s and project_id = %s",
                    (key, candidate_id, job.project_id),
                )
            except Exception:  # noqa: BLE001 - satu thumbnail tidak membatalkan batch
                log.exception("gagal membuat thumbnail kandidat %s", candidate_id)
                conn.execute(
                    "update clip_candidates set thumbnail_status = 'failed', "
                    "thumbnail_r2_key = null where id = %s and project_id = %s",
                    (candidate_id, job.project_id),
                )
            conn.commit()
            heartbeat(conn, job.id, (index + 1) * 100 // max(1, len(rows)))
    finally:
        if owns_workdir:
            shutil.rmtree(root, ignore_errors=True)
