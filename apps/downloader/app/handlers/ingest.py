from __future__ import annotations

import tempfile
import os
from collections.abc import Callable
from pathlib import Path

import psycopg

from app.errors import JobError
from app.ffmpeg import extract_audio as _extract_audio
from app.ffmpeg import sha256_file
from app.providers.transcription import TranscriptResult, Word
from app.providers.youtube_captions import (
    caption_first_enabled,
)
from app.providers.youtube_captions import (
    fetch_youtube_caption as _fetch_youtube_caption,
)
from app.providers.youtube_transcript_api import (
    fetch_youtube_transcript as _fetch_youtube_transcript,
)
from app.queue import Job, enqueue, heartbeat
from app.storage import Storage, storage_from_env
from app.transcripts import store_transcript
from app.ytdlp import SourceMeta
from app.ytdlp import download_audio as _download_audio
from app.ytdlp import probe_with_fallback as _probe


def _guest_fixture_transcript() -> tuple[SourceMeta, TranscriptResult]:
    """Fixture eksplisit untuk smoke-test lokal saat upstream YouTube memblokir."""
    words = [
        Word(text, start, start + 2.0)
        for text, start in zip(
            "Ini adalah fixture guest untuk menguji alur klip editor dan export video lokal".split(),
            range(0, 18, 2),
        )
    ]
    return (
        SourceMeta('Guest fixture video', 'Klipmatic Test', 60, None, 'fixture', provider='guest_fixture', is_fixture=True),
        TranscriptResult('id', ' '.join(w.text for w in words), words, 'guest_fixture', 'local', 0.0, 'estimated'),
    )


def _find_reusable_source(
    conn: psycopg.Connection, kind: str, external_id: str, user_id: str | None
) -> str | None:
    """Mencari sumber yang sudah siap dan boleh dipakai user ini.

    Aturannya identik dengan RLS (spec §6.3): sumber publik terbuka untuk
    semua, sumber privat hanya untuk pemiliknya. Pemeriksaan ini berjalan
    sebelum yt-dlp sehingga cache hit tidak menimbulkan biaya sama sekali.
    """
    row = conn.execute(
        """
        select id from sources
         where kind = %s and external_id = %s and status = 'ready'
           and (is_public or owner_user_id = %s)
         order by is_public desc
         limit 1
        """,
        (kind, external_id, user_id),
    ).fetchone()
    return str(row[0]) if row else None


def _repoint_and_drop(
    conn: psycopg.Connection, project_id: str, keep_source_id: str, drop_source_id: str
) -> None:
    conn.execute(
        "update projects set source_id = %s, updated_at = now() where id = %s",
        (keep_source_id, project_id),
    )
    conn.execute("delete from sources where id = %s", (drop_source_id,))
    conn.commit()


def _enqueue_transcribe(
    conn: psycopg.Connection, job: Job, source_id: str, project_id: str
) -> None:
    enqueue(
        conn,
        "transcribe",
        {"source_id": source_id, "project_id": project_id},
        user_id=job.user_id,
        project_id=project_id,
    )


def _promote_or_keep_private(
    conn: psycopg.Connection,
    source_id: str,
    project_id: str,
    meta: SourceMeta,
    kind: str,
    external_id: str,
) -> str:
    """Menetapkan is_public final dari metadata yt-dlp (spec §8.1).

    Bila sudah ada baris publik untuk sumber yang sama — akibat balapan antar
    worker — proyek dialihkan ke baris itu dan baris ini dihapus, sehingga
    unique index tidak pernah dilanggar.
    """
    if meta.availability != "public":
        return source_id

    existing = conn.execute(
        "select id from sources where kind = %s and external_id = %s and is_public",
        (kind, external_id),
    ).fetchone()
    if existing and str(existing[0]) != source_id:
        _repoint_and_drop(conn, project_id, str(existing[0]), source_id)
        return str(existing[0])

    conn.execute(
        "update sources set is_public = true, owner_user_id = null, updated_at = now() "
        "where id = %s",
        (source_id,),
    )
    conn.commit()
    return source_id


def handle_ingest(
    conn: psycopg.Connection,
    job: Job,
    *,
    storage: Storage | None = None,
    probe: Callable[[str], SourceMeta] = _probe,
    download_audio: Callable[..., Path] = _download_audio,
    extract_audio: Callable[[Path, Path], Path] = _extract_audio,
    caption_fn: Callable[[str, int, Path], TranscriptResult | None] = _fetch_youtube_caption,
    transcript_fallback_fn: Callable[..., TranscriptResult | None] = _fetch_youtube_transcript,
    workdir: Path | None = None,
) -> None:
    """Fase 1: coba caption YouTube, baru ambil audio bila perlu.

    Dependensi disuntikkan lewat keyword agar tes tidak menyentuh jaringan.
    """
    storage = storage or storage_from_env()
    source_id: str = job.payload["source_id"]
    project_id: str = job.payload["project_id"]

    row = conn.execute(
        "select kind, external_id, url_original, owner_user_id from sources where id = %s",
        (source_id,),
    ).fetchone()
    if row is None:
        raise JobError("INTERNAL", f"source {source_id} tidak ditemukan", terminal=True)
    kind, external_id, url, owner_user_id = row[0], row[1], row[2], row[3]
    owner = str(owner_user_id) if owner_user_id else None

    reusable = _find_reusable_source(conn, kind, external_id, owner)
    if reusable and reusable != source_id:
        _repoint_and_drop(conn, project_id, reusable, source_id)
        # Rantai tetap dipasang pada cache hit: proyek user kedua harus maju
        # ke tahap berikutnya, bukan berhenti diam-diam karena audionya sudah ada.
        _enqueue_transcribe(conn, job, reusable, project_id)
        heartbeat(conn, job.id, 100)
        return

    try:
        heartbeat(conn, job.id, 5)
        tmp_root = workdir or Path(tempfile.mkdtemp(prefix="cc-ingest-"))
        try:
            meta = probe(url)
        except JobError as error:
            if error.code != "SOURCE_BLOCKED" or kind != "youtube":
                raise
            try:
                recovered = transcript_fallback_fn(url, 0)
            except ValueError:
                raise error from None
            if recovered is None:
                if os.getenv("GUEST_FALLBACK_ON_SOURCE_BLOCKED", "false").lower() != "true":
                    raise
                meta, recovered = _guest_fixture_transcript()
                store_transcript(conn, storage, source_id, recovered)
                conn.execute(
                    "update sources set title = %s, channel = %s, duration_sec = %s, "
                    "thumbnail_url = %s, provider = %s, is_fixture = %s, status = 'ready', error_code = null, updated_at = now() "
                    "where id = %s",
                    (meta.title, meta.channel, meta.duration_sec, meta.thumbnail_url, meta.provider, meta.is_fixture, source_id),
                )
                conn.commit()
                heartbeat(conn, job.id, 95)
                _enqueue_transcribe(conn, job, source_id, project_id)
                return
            store_transcript(conn, storage, source_id, recovered)
            conn.execute(
                "update sources set status = 'ready', error_code = null, updated_at = now() "
                "where id = %s",
                (source_id,),
            )
            conn.commit()
            heartbeat(conn, job.id, 95)
            _enqueue_transcribe(conn, job, source_id, project_id)
            return

        caption = (
            caption_fn(url, meta.duration_sec, tmp_root)
            if kind == "youtube" and caption_first_enabled()
            else None
        )

        if caption is not None:
            heartbeat(conn, job.id, 70)
            store_transcript(conn, storage, source_id, caption)
            conn.execute(
                """
                update sources
                   set title = %s, channel = %s, duration_sec = %s, thumbnail_url = %s,
                       provider = %s, is_fixture = %s,
                       status = 'ready', error_code = null, updated_at = now()
                 where id = %s
                """,
                (
                    meta.title,
                    meta.channel,
                    meta.duration_sec,
                    meta.thumbnail_url,
                    meta.provider,
                    meta.is_fixture,
                    source_id,
                ),
            )
            conn.commit()
            heartbeat(conn, job.id, 95)

            final_source_id = _promote_or_keep_private(
                conn, source_id, project_id, meta, kind, external_id
            )
            _enqueue_transcribe(conn, job, final_source_id, project_id)
            return

        raw = tmp_root / f"{source_id}.raw"
        opus = tmp_root / f"{source_id}.opus"

        download_audio(url, raw, lambda pct: heartbeat(conn, job.id, 5 + pct * 70 // 100))
        heartbeat(conn, job.id, 80)

        extract_audio(raw, opus)
        digest = sha256_file(opus)
        key = f"audio/{digest}.opus"

        if not storage.exists(key):
            storage.put_file(key, opus, "audio/ogg")
        heartbeat(conn, job.id, 95)

        conn.execute(
            """
            update sources
               set title = %s, channel = %s, duration_sec = %s, thumbnail_url = %s,
                   provider = %s, is_fixture = %s,
                   audio_r2_key = %s, audio_sha256 = %s, status = 'ready',
                   error_code = null, updated_at = now()
             where id = %s
            """,
            (
                meta.title,
                meta.channel,
                meta.duration_sec,
                meta.thumbnail_url,
                meta.provider,
                meta.is_fixture,
                key,
                digest,
                source_id,
            ),
        )
        conn.commit()

        # Promosi dapat mengalihkan proyek ke baris publik yang sudah ada bila
        # ada worker lain yang menang balapan, jadi id final yang dipakai.
        final_source_id = _promote_or_keep_private(
            conn, source_id, project_id, meta, kind, external_id
        )
        _enqueue_transcribe(conn, job, final_source_id, project_id)

    except JobError as e:
        conn.execute(
            "update sources set status = 'failed', error_code = %s, updated_at = now() "
            "where id = %s",
            (e.code, source_id),
        )
        conn.commit()
        raise
