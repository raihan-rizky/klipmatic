from __future__ import annotations

import logging
import os
import time
from collections.abc import Callable

import psycopg

from app.errors import JobError
from app.observability import (
    bind_context,
    configure_logging,
    elapsed_ms,
    emit,
    reset_context,
    reset_progress_milestones,
)
from app.queue import (
    BACKOFF_BASE_SEC,
    BACKOFF_FACTOR,
    Job,
    claim_job,
    complete_job,
    fail_job,
)
from app.reaper import reap_expired_media_assets, reap_stale_jobs

log = logging.getLogger(__name__)

Handler = Callable[[psycopg.Connection, Job], None]


def _retry_delay(attempt: int) -> int:
    return BACKOFF_BASE_SEC * BACKOFF_FACTOR ** max(attempt - 1, 0)


def run_once(
    conn: psycopg.Connection, worker_id: str, handlers: dict[str, Handler]
) -> bool:
    """Memproses paling banyak satu job. True bila ada job yang diproses."""
    job = claim_job(conn, worker_id)
    if job is None:
        return False

    started = time.monotonic()
    token = bind_context(
        worker_id=worker_id,
        job_id=job.id,
        job_type=job.type,
        project_id=job.project_id,
        attempt=job.attempts,
    )
    reset_progress_milestones()
    try:
        emit(log, "job.claimed")
        handler = handlers.get(job.type)
        if handler is None:
            fail_job(
                conn,
                job.id,
                "INTERNAL",
                f"handler tidak terdaftar: {job.type}",
                terminal=True,
            )
            emit(
                log,
                "job.failed",
                level=logging.ERROR,
                error_code="INTERNAL",
                duration_ms=elapsed_ms(started),
            )
            return True

        emit(log, "job.handler.started")
        handler(conn, job)
        complete_job(conn, job.id)
        emit(log, "job.completed", duration_ms=elapsed_ms(started))
    except JobError as error:
        fail_job(
            conn,
            job.id,
            error.code,
            str(error),
            terminal=error.terminal,
        )
        terminal = error.terminal or job.attempts >= job.max_attempts
        if terminal:
            emit(
                log,
                "job.failed",
                level=logging.WARNING,
                error_code=error.code,
                duration_ms=elapsed_ms(started),
            )
        else:
            emit(
                log,
                "job.retry_scheduled",
                level=logging.WARNING,
                error_code=error.code,
                next_attempt=job.attempts + 1,
                retry_delay_sec=_retry_delay(job.attempts),
                duration_ms=elapsed_ms(started),
            )
    except Exception as error:  # noqa: BLE001 - last-resort worker boundary
        fail_job(conn, job.id, "INTERNAL", str(error), terminal=False)
        terminal = job.attempts >= job.max_attempts
        fields: dict[str, object] = {
            "error_code": "INTERNAL",
            "error_class": type(error).__name__,
            "duration_ms": elapsed_ms(started),
        }
        if not terminal:
            fields["next_attempt"] = job.attempts + 1
            fields["retry_delay_sec"] = _retry_delay(job.attempts)
        emit(
            log,
            "job.failed" if terminal else "job.retry_scheduled",
            level=logging.ERROR,
            exception=error,
            **fields,
        )
    finally:
        reset_context(token)
    return True


def default_handlers() -> dict[str, Handler]:
    # Diimpor di dalam fungsi: handler menarik boto3, httpx, dan yt-dlp,
    # sementara run_once diuji dengan handler suntikan tanpa perlu semua itu.
    from app.handlers.analyze import handle_analyze
    from app.handlers.fetch_segments import handle_fetch_segments
    from app.handlers.ingest import handle_ingest
    from app.handlers.prepare_thumbnails import handle_prepare_thumbnails
    from app.handlers.probe_asset import handle_probe_asset
    from app.handlers.render_previews import handle_render_previews
    from app.handlers.transcribe import handle_transcribe

    return {
        "ingest": handle_ingest,
        "transcribe": handle_transcribe,
        "analyze": handle_analyze,
        "prepare_thumbnails": handle_prepare_thumbnails,
        "fetch_segments": handle_fetch_segments,
        "probe_asset": handle_probe_asset,
        "render_previews": handle_render_previews,
    }


def main() -> None:
    from app.storage import storage_from_env

    handlers = default_handlers()
    worker_id = os.environ.get("WORKER_ID", "worker-1")
    poll = float(os.environ.get("WORKER_POLL_INTERVAL_SEC", "2"))
    reap_every = 60.0
    last_reap = 0.0
    asset_reap_every = 60.0 * 60.0
    last_asset_reap = 0.0

    configure_logging()
    emit(log, "worker.started", worker_id=worker_id)

    with psycopg.connect(
        os.environ["DATABASE_URL"], prepare_threshold=None
    ) as conn:
        storage = storage_from_env()
        while True:
            now = time.monotonic()
            if now - last_reap > reap_every:
                reap_stale_jobs(conn)
                last_reap = now
            if now - last_asset_reap > asset_reap_every:
                reap_expired_media_assets(conn, storage)
                last_asset_reap = now
            if not run_once(conn, worker_id, handlers):
                time.sleep(poll)


if __name__ == "__main__":
    main()
