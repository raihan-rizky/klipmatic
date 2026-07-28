from __future__ import annotations

import json
import logging
import shutil
import tempfile
from datetime import datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path
from typing import Any, Callable

import psycopg

from app.errors import JobError
from app.ffmpeg import extract_audio as _extract_audio
from app.ffmpeg import sha256_file
from app.providers.transcription import TranscriptResult
from app.providers.transcription import transcribe as _transcribe
from app.queue import Job, heartbeat
from app.storage import Storage, storage_from_env
from app.transcripts import serialize_transcript
from app.ytdlp import download_section as _download_section

log = logging.getLogger(__name__)

SEGMENT_TTL_DAYS = 7  # Spec §8.2
_SKALA = Decimal("0.001")  # media_segments.start_sec/end_sec = numeric(10,3)


def _bulatkan(nilai: Any) -> Decimal:
    """Membulatkan ke skala kolom sebelum angkanya dipakai untuk apa pun.

    Kalau pembulatan diserahkan ke Postgres, nilai yang dicari (10.0005) tidak
    pernah sama dengan nilai yang tersimpan (10.001), sehingga cache tidak
    pernah kena dan rentang yang sama diunduh ulang selamanya.
    """
    return Decimal(str(float(nilai))).quantize(_SKALA, rounding=ROUND_HALF_UP)


def _validate(ranges: list[dict[str, Any]], duration_sec: int) -> list[tuple[Decimal, Decimal]]:
    """Memeriksa seluruh rentang sebelum satu byte pun diunduh.

    Job gagal utuh, bukan separuh: kalau rentang kedua tidak masuk akal,
    mengunduh rentang pertama hanya membuang bandwidth dan menyisakan cache
    yang tidak pernah dipakai.
    """
    if not ranges:
        raise JobError("INTERNAL", "daftar rentang kosong", terminal=True)

    out: list[tuple[Decimal, Decimal]] = []
    for r in ranges:
        start, end = _bulatkan(r["start_sec"]), _bulatkan(r["end_sec"])
        if end <= start or start < 0 or (duration_sec and end > duration_sec):
            raise JobError(
                "INTERNAL",
                f"rentang {start}-{end} di luar durasi {duration_sec}",
                terminal=True,
            )
        out.append((start, end))
    return out


def _maybe_refine_caption(
    conn: psycopg.Connection,
    job: Job,
    storage: Storage,
    segment: Path,
    duration_sec: int,
    *,
    transcribe: Callable[..., TranscriptResult],
    extract_audio: Callable[[Path, Path], Path],
) -> None:
    clip_id = job.payload.get("clip_id")
    if not clip_id:
        return
    # Payload worker tidak dipercaya. Clip, project, dan user harus cocok
    # sebelum satu panggilan provider berbayar dilakukan.
    row = conn.execute(
        """
        select t.r2_key
         from clips cl
          join projects p on p.id = cl.project_id
          join transcripts t on t.source_id = p.source_id
         where cl.id = %s and cl.project_id = %s and p.user_id = %s
           and p.source_id = %s
         order by t.created_at desc limit 1
        """,
        (clip_id, job.project_id, job.user_id, job.payload["source_id"]),
    ).fetchone()
    if row is None:
        return

    transcript = json.loads(storage.get_bytes(row[0]).decode("utf-8"))
    if transcript.get("timing_precision") != "estimated":
        return
    key = f"clip-transcripts/{clip_id}.json"
    if storage.exists(key):
        return

    audio = segment.with_suffix(".caption.opus")
    try:
        extract_audio(segment, audio)
        result = transcribe(audio, duration_sec)
        storage.put_bytes(key, serialize_transcript(result), "application/json")
    except JobError as error:
        # Precision pass adalah enhancement. Ketiadaan key atau provider down
        # tidak boleh menghilangkan segment dan caption estimasi yang sudah ada.
        log.warning("precision caption clip %s dilewati: %s", clip_id, error.code)
    finally:
        audio.unlink(missing_ok=True)


def handle_fetch_segments(
    conn: psycopg.Connection,
    job: Job,
    *,
    storage: Storage | None = None,
    download: Callable[..., Path] = _download_section,
    transcribe: Callable[..., TranscriptResult] = _transcribe,
    extract_audio: Callable[[Path, Path], Path] = _extract_audio,
    workdir: Path | None = None,
) -> None:
    """Fase 2 dari download dua fase: hanya rentang terpilih yang diunduh.

    Dependensi disuntikkan lewat keyword agar tes tidak menyentuh jaringan.
    """
    storage = storage or storage_from_env()
    source_id: str = job.payload["source_id"]

    # Predikat kepemilikan menyalin RLS (spec §6.3). Worker terhubung dengan
    # hak penuh sehingga RLS tidak berlaku baginya; tanpa filter ini sebuah job
    # yang membawa source_id milik orang lain akan mengunduh sumber privat itu
    # dan menagihkan bandwidth-nya ke kita.
    row = conn.execute(
        "select url_original, duration_sec from sources "
        "where id = %s and (is_public or owner_user_id = %s)",
        (source_id, job.user_id),
    ).fetchone()
    if row is None:
        raise JobError("INTERNAL", f"source {source_id} tidak ditemukan", terminal=True)
    url, duration_sec = row[0], int(row[1] or 0)

    ranges = _validate(job.payload.get("ranges") or [], duration_sec)

    tmp_milik_sendiri = workdir is None
    tmp_root = workdir or Path(tempfile.mkdtemp(prefix="cc-segments-"))
    total = len(ranges)

    try:
        for i, (start, end) in enumerate(ranges):
            # Baris kedaluwarsa dihitung sebagai cache miss. Lifecycle R2
            # menghapus objek berdasarkan umur objeknya sendiri dan tidak
            # pernah membaca expires_at, jadi kolom ini hanya cerminan: begitu
            # terlewat, kuncinya harus dianggap sudah mati dan diambil ulang.
            cached = conn.execute(
                """
                select r2_key from media_segments
                 where source_id = %s and start_sec = %s and end_sec = %s
                   and expires_at > now()
                """,
                (source_id, start, end),
            ).fetchone()
            if cached:
                # Segment lama mungkin dibuat sebelum precision-pass ada.
                # Ambil dari R2 hanya bila clip ini memang membutuhkannya.
                if job.payload.get("clip_id"):
                    cached_dest = tmp_root / f"{source_id}-{start}-{end}-cached.mp4"
                    storage.download_to(cached[0], cached_dest)
                    _maybe_refine_caption(
                        conn,
                        job,
                        storage,
                        cached_dest,
                        max(1, int(round(float(end - start)))),
                        transcribe=transcribe,
                        extract_audio=extract_audio,
                    )
                    cached_dest.unlink(missing_ok=True)
                heartbeat(conn, job.id, (i + 1) * 100 // total)
                continue

            # Nama berkas memakai nilai penuh, bukan detik bulat: dua rentang
            # yang hanya berbeda pecahan detik dulu jatuh ke path yang sama,
            # dan yt-dlp yang menolak menimpa berkas lama membuat rentang kedua
            # merekam video rentang pertama tanpa satu pun error.
            dest = tmp_root / f"{source_id}-{start}-{end}.mp4"
            download(url, start, end, dest)

            # Kunci berasal dari digest isi, jadi dua rentang yang menghasilkan
            # byte identik hanya menempati satu objek di R2.
            digest = sha256_file(dest)
            key = f"segments/{digest}.mp4"

            # Umur objek di R2 dihitung sejak objek ditulis. Satu-satunya bukti
            # umur yang kita punya adalah baris lain yang masih hidup dan
            # menunjuk kunci sama, jadi baris baru mewarisi masa berlakunya.
            # Tanpa bukti itu objek ditulis ulang supaya jam lifecycle mulai
            # dari nol dan expires_at benar-benar mencerminkan kapan R2 hapus.
            warisan = conn.execute(
                "select max(expires_at) from media_segments "
                "where r2_key = %s and expires_at > now()",
                (key,),
            ).fetchone()[0]
            if warisan is not None:
                expires_at = warisan
            else:
                storage.put_file(key, dest, "video/mp4")
                expires_at = datetime.now(timezone.utc) + timedelta(days=SEGMENT_TTL_DAYS)

            # Precision pass diselesaikan sebelum media_segments dipublikasikan,
            # sehingga editor tidak keburu membaca caption estimasi karena race.
            _maybe_refine_caption(
                conn,
                job,
                storage,
                dest,
                max(1, int(round(float(end - start)))),
                transcribe=transcribe,
                extract_audio=extract_audio,
            )

            # Baris lama yang kedaluwarsa ditimpa, bukan diabaikan: kalau tidak,
            # r2_key mati hasil unduhan sebelumnya menetap selamanya.
            conn.execute(
                """
                insert into media_segments
                       (source_id, start_sec, end_sec, r2_key, bytes, expires_at)
                values (%s, %s, %s, %s, %s, %s)
                on conflict (source_id, start_sec, end_sec) do update
                   set r2_key = excluded.r2_key,
                       bytes = excluded.bytes,
                       expires_at = excluded.expires_at
                """,
                (source_id, start, end, key, dest.stat().st_size, expires_at),
            )
            conn.commit()

            # Segmen adalah artefak terbesar pipeline; menyisakannya di disk VPS
            # setelah terunggah membuat worker kehabisan ruang.
            dest.unlink(missing_ok=True)
            heartbeat(conn, job.id, (i + 1) * 100 // total)
    finally:
        if tmp_milik_sendiri:
            shutil.rmtree(tmp_root, ignore_errors=True)
