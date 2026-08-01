from __future__ import annotations

import logging
import os
import time
from typing import Callable

import psycopg

from app.errors import JobError
from app.queue import Job, claim_job, complete_job, fail_job
from app.reaper import reap_expired_media_assets, reap_stale_jobs

log = logging.getLogger(__name__)

Handler = Callable[[psycopg.Connection, Job], None]


def run_once(
    conn: psycopg.Connection, worker_id: str, handlers: dict[str, Handler]
) -> bool:
    """Memproses paling banyak satu job. True bila ada job yang diproses."""
    job = claim_job(conn, worker_id)
    if job is None:
        return False

    handler = handlers.get(job.type)
    if handler is None:
        log.error("tidak ada handler untuk tipe job %s", job.type)
        fail_job(
            conn, job.id, "INTERNAL", f"handler tidak terdaftar: {job.type}", terminal=True
        )
        return True

    try:
        handler(conn, job)
        complete_job(conn, job.id)
    except JobError as e:
        log.warning("job %s gagal: %s", job.id, e.code)
        fail_job(conn, job.id, e.code, str(e), terminal=e.terminal)
    except Exception as e:  # noqa: BLE001 — jaring pengaman terakhir worker
        log.exception("job %s melempar exception tak terduga", job.id)
        fail_job(conn, job.id, "INTERNAL", str(e), terminal=False)
    return True


def main() -> None:
    # Diimpor di dalam fungsi: handler menarik boto3, httpx, dan yt-dlp,
    # sementara run_once diuji dengan handler suntikan tanpa perlu semua itu.
    from app.handlers.analyze import handle_analyze
    from app.handlers.fetch_segments import handle_fetch_segments
    from app.handlers.ingest import handle_ingest
    from app.handlers.probe_asset import handle_probe_asset
    from app.handlers.transcribe import handle_transcribe
    from app.storage import storage_from_env

    handlers: dict[str, Handler] = {
        "ingest": handle_ingest,
        "transcribe": handle_transcribe,
        "analyze": handle_analyze,
        "fetch_segments": handle_fetch_segments,
        "probe_asset": handle_probe_asset,
    }
    worker_id = os.environ.get("WORKER_ID", "worker-1")
    poll = float(os.environ.get("WORKER_POLL_INTERVAL_SEC", "2"))
    reap_every = 60.0
    last_reap = 0.0
    asset_reap_every = 60.0 * 60.0
    last_asset_reap = 0.0

    logging.basicConfig(level=logging.INFO)
    log.info("worker %s mulai", worker_id)

    with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
        storage = storage_from_env()
        while True:
            now = time.monotonic()
            if now - last_reap > reap_every:
                reaped = reap_stale_jobs(conn)
                if reaped:
                    log.warning("mengembalikan %d job basi ke antrian", reaped)
                last_reap = now
            if now - last_asset_reap > asset_reap_every:
                reaped_assets = reap_expired_media_assets(conn, storage)
                if reaped_assets:
                    log.info("menghapus %d upload media kedaluwarsa", reaped_assets)
                last_asset_reap = now
            if not run_once(conn, worker_id, handlers):
                time.sleep(poll)


if __name__ == "__main__":
    main()
