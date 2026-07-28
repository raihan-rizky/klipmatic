from __future__ import annotations

import tempfile
from pathlib import Path
from typing import Callable

import psycopg

from app.errors import JobError
from app.providers.transcription import TranscriptResult, cache_model
from app.providers.transcription import transcribe as _transcribe
from app.queue import Job, enqueue, heartbeat
from app.storage import Storage, storage_from_env
from app.transcripts import store_transcript


def _enqueue_analyze(conn: psycopg.Connection, job: Job) -> None:
    enqueue(
        conn,
        "analyze",
        {"source_id": job.payload["source_id"], "project_id": job.payload["project_id"]},
        user_id=job.user_id,
        project_id=job.payload["project_id"],
    )


def handle_transcribe(
    conn: psycopg.Connection,
    job: Job,
    *,
    storage: Storage | None = None,
    transcribe_fn: Callable[..., TranscriptResult] = _transcribe,
    workdir: Path | None = None,
) -> None:
    storage = storage or storage_from_env()
    source_id: str = job.payload["source_id"]
    model = cache_model()

    row = conn.execute(
        "select status, audio_r2_key, duration_sec from sources where id = %s", (source_id,)
    ).fetchone()
    if row is None:
        raise JobError("INTERNAL", f"source {source_id} tidak ditemukan", terminal=True)
    status, audio_key, duration_sec = row
    if status != "ready":
        raise JobError("INTERNAL", f"source {source_id} belum siap ditranskrip", terminal=True)

    # Cache lapis transkrip (spec §8). Pemeriksaan ini yang membuat user kedua
    # pada video yang sama tidak menimbulkan biaya API sama sekali. Rantai ke
    # analyze tetap dipasang, karena proyek user kedua tetap harus maju ke
    # tahap berikutnya meski transkripnya dipakai ulang.
    existing = conn.execute(
        "select id from transcripts where source_id = %s and model = %s", (source_id, model)
    ).fetchone()
    if existing:
        _enqueue_analyze(conn, job)
        heartbeat(conn, job.id, 100)
        return
    if not audio_key:
        # Sumber caption-first memang tidak punya audio, tetapi seharusnya
        # selalu punya baris transcript sehingga sudah return di atas.
        raise JobError(
            "INTERNAL",
            f"source {source_id} tidak punya caption maupun audio fallback",
            terminal=True,
        )

    heartbeat(conn, job.id, 10)
    tmp_root = workdir or Path(tempfile.mkdtemp(prefix="cc-transcribe-"))
    audio = tmp_root / f"{source_id}.opus"
    storage.download_to(audio_key, audio)

    heartbeat(conn, job.id, 30)
    result = transcribe_fn(audio, duration_sec or 0)

    heartbeat(conn, job.id, 85)
    store_transcript(conn, storage, source_id, result)

    _enqueue_analyze(conn, job)
