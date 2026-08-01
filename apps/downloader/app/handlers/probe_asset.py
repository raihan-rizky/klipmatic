from __future__ import annotations

import shutil
import tempfile
from pathlib import Path
from typing import Callable

import psycopg

from app.errors import JobError
from app.ffmpeg import MediaProbe, probe_media
from app.queue import Job
from app.storage import Storage, storage_from_env


def handle_probe_asset(
    conn: psycopg.Connection,
    job: Job,
    *,
    storage: Storage | None = None,
    probe: Callable[[Path], MediaProbe] = probe_media,
    workdir: Path | None = None,
) -> None:
    storage = storage or storage_from_env()
    asset_id = job.payload.get("asset_id")
    row = conn.execute(
        """
        select ma.storage_key, ma.media_type, ma.status
          from media_assets ma
          join projects p on p.id = ma.project_id
         where ma.id = %s
           and ma.project_id = %s
           and ma.user_id = %s
           and p.user_id = %s
           and ma.source = 'upload'
         for update
        """,
        (asset_id, job.project_id, job.user_id, job.user_id),
    ).fetchone()
    if row is None:
        raise JobError("ASSET_INVALID", "asset upload tidak ditemukan", terminal=True)
    storage_key, expected_type, status = str(row[0]), str(row[1]), str(row[2])
    if status == "ready":
        conn.commit()
        return
    if status != "uploading":
        raise JobError("ASSET_INVALID", f"status asset tidak dapat diproses: {status}", terminal=True)

    owns_temp = workdir is None
    root = workdir or Path(tempfile.mkdtemp(prefix="cc-probe-asset-"))
    root.mkdir(parents=True, exist_ok=True)
    suffix = Path(storage_key).suffix or ".media"
    local_path = root / f"{asset_id}{suffix}"
    try:
        storage.download_to(storage_key, local_path)
        metadata = probe(local_path)
        if metadata.media_type != expected_type:
            raise JobError(
                "ASSET_INVALID",
                f"tipe terdeteksi {metadata.media_type}, bukan {expected_type}",
                terminal=True,
            )
        conn.execute(
            """
            update media_assets
               set status = 'ready', duration_sec = %s, width = %s, height = %s,
                   has_audio = %s, last_used_at = now(),
                   expires_at = now() + interval '3 days', updated_at = now()
             where id = %s
            """,
            (
                metadata.duration_sec,
                metadata.width,
                metadata.height,
                metadata.has_audio,
                asset_id,
            ),
        )
        conn.commit()
    except JobError:
        conn.execute(
            "update media_assets set status = 'failed', updated_at = now() where id = %s",
            (asset_id,),
        )
        conn.commit()
        raise
    finally:
        local_path.unlink(missing_ok=True)
        if owns_temp:
            shutil.rmtree(root, ignore_errors=True)
