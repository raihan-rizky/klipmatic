from __future__ import annotations

import logging
import time

import psycopg

from app.observability import elapsed_ms, emit
from app.storage import Storage

log = logging.getLogger(__name__)


def reap_stale_jobs(conn: psycopg.Connection, older_than_sec: int = 300) -> int:
    """Mengembalikan job yang worker-nya mati mendadak ke antrian.

    Deteksinya adalah lock yang tidak diperbarui: heartbeat menyegarkan
    locked_at setiap 30 detik, jadi lock yang lebih tua dari older_than_sec
    berarti worker sudah tidak hidup.
    """
    started = time.monotonic()
    try:
        rows = conn.execute(
            """
            update jobs
               set status = case when attempts >= max_attempts then 'dead' else 'queued' end,
                   locked_at = null,
                   locked_by = null,
                   error_code = 'WORKER_LOST',
                   updated_at = now()
             where status = 'running'
               and locked_at < now() - make_interval(secs => %s)
            returning id
            """,
            (older_than_sec,),
        ).fetchall()
        conn.commit()
    except Exception as error:
        emit(
            log,
            "reaper.jobs.failed",
            level=logging.ERROR,
            operation="stale_jobs",
            error_class=type(error).__name__,
            duration_ms=elapsed_ms(started),
        )
        raise
    count = len(rows)
    emit(
        log,
        "reaper.jobs.completed",
        operation="stale_jobs",
        reaped_count=count,
        duration_ms=elapsed_ms(started),
    )
    return count


def reap_expired_media_assets(
    conn: psycopg.Connection, storage: Storage, *, limit: int = 100
) -> int:
    """Delete expired uploads and abandon uploads left incomplete for one hour."""
    started = time.monotonic()
    try:
        rows = conn.execute(
            """
            select id, storage_key
              from media_assets
             where source = 'upload'
               and status <> 'expired'
               and (
                 expires_at <= now()
                 or (status = 'uploading' and created_at <= now() - interval '1 hour')
               )
             order by expires_at, created_at, id
             for update skip locked
             limit %s
            """,
            (limit,),
        ).fetchall()
        for asset_id, storage_key in rows:
            storage.delete(str(storage_key))
            conn.execute(
                """
                update media_assets
                   set status = 'expired', expires_at = now(), updated_at = now()
                 where id = %s and status <> 'expired'
                """,
                (asset_id,),
            )
        conn.commit()
    except Exception as error:
        emit(
            log,
            "reaper.assets.failed",
            level=logging.ERROR,
            operation="expired_assets",
            error_class=type(error).__name__,
            duration_ms=elapsed_ms(started),
        )
        raise
    count = len(rows)
    emit(
        log,
        "reaper.assets.completed",
        operation="expired_assets",
        reaped_count=count,
        duration_ms=elapsed_ms(started),
    )
    return count
