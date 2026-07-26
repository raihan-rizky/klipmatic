from __future__ import annotations

import logging
import os
import time
from typing import Callable

import psycopg

from app.errors import JobError
from app.queue import Job, claim_job, complete_job, fail_job
from app.reaper import reap_stale_jobs

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
    from app.handlers.ingest import handle_ingest

    handlers: dict[str, Handler] = {"ingest": handle_ingest}
    worker_id = os.environ.get("WORKER_ID", "worker-1")
    poll = float(os.environ.get("WORKER_POLL_INTERVAL_SEC", "2"))
    reap_every = 60.0
    last_reap = 0.0

    logging.basicConfig(level=logging.INFO)
    log.info("worker %s mulai", worker_id)

    with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
        while True:
            now = time.monotonic()
            if now - last_reap > reap_every:
                reaped = reap_stale_jobs(conn)
                if reaped:
                    log.warning("mengembalikan %d job basi ke antrian", reaped)
                last_reap = now
            if not run_once(conn, worker_id, handlers):
                time.sleep(poll)


if __name__ == "__main__":
    main()
