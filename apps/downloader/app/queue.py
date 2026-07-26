from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

import psycopg

# Backoff eksponensial: percobaan ke-1 → 1 menit, ke-2 → 5 menit, ke-3 → 25 menit.
BACKOFF_BASE_SEC = 60
BACKOFF_FACTOR = 5


@dataclass(frozen=True)
class Job:
    id: str
    type: str
    payload: dict[str, Any]
    attempts: int
    max_attempts: int
    project_id: str | None
    user_id: str | None


def enqueue(
    conn: psycopg.Connection,
    type: str,
    payload: dict[str, Any],
    *,
    user_id: str | None = None,
    project_id: str | None = None,
    priority: int = 0,
) -> str:
    row = conn.execute(
        """
        insert into jobs (type, payload, user_id, project_id, priority)
        values (%s, %s::jsonb, %s, %s, %s)
        returning id
        """,
        (type, json.dumps(payload), user_id, project_id, priority),
    ).fetchone()
    conn.commit()
    return str(row[0])


def claim_job(conn: psycopg.Connection, worker_id: str) -> Job | None:
    """Mengambil satu job secara atomik.

    Penguncian baris di subquery adalah syarat kebenaran: tanpa itu lima
    worker yang berebut dua puluh job menghasilkan sekitar 55 klaim, artinya
    job yang sama diproses berkali-kali dan biayanya ditagih berkali-kali.

    `skip locked` sendiri bukan syarat kebenaran — `for update` polos pun aman
    karena Postgres mengevaluasi ulang predikat `status = 'queued'` setelah
    lock dilepas, sehingga baris yang sudah diambil terlewat. Yang diberikan
    `skip locked` adalah throughput: worker tidak saling memblokir menunggu
    giliran, yang penting ketika job berjalan lama.
    """
    row = conn.execute(
        """
        update jobs
           set status = 'running',
               locked_at = now(),
               locked_by = %s,
               attempts = attempts + 1,
               updated_at = now()
         where id = (
             select id from jobs
              where status = 'queued' and run_after <= now()
              order by priority desc, id
              for update skip locked
              limit 1
         )
        returning id, type, payload, attempts, max_attempts, project_id, user_id
        """,
        (worker_id,),
    ).fetchone()
    conn.commit()
    if row is None:
        return None
    return Job(
        id=str(row[0]),
        type=row[1],
        payload=row[2],
        attempts=row[3],
        max_attempts=row[4],
        project_id=str(row[5]) if row[5] else None,
        user_id=str(row[6]) if row[6] else None,
    )


def complete_job(conn: psycopg.Connection, job_id: str) -> None:
    conn.execute(
        """
        update jobs
           set status = 'done', progress = 100, locked_at = null,
               locked_by = null, updated_at = now()
         where id = %s
        """,
        (job_id,),
    )
    conn.commit()


def fail_job(
    conn: psycopg.Connection, job_id: str, code: str, msg: str, terminal: bool
) -> None:
    """Job terminal langsung gagal.

    Job non-terminal dijadwalkan ulang dengan backoff sampai max_attempts
    terlampaui, lalu menjadi 'dead'.
    """
    conn.execute(
        """
        update jobs
           set status = case
                 when %s then 'failed'
                 when attempts >= max_attempts then 'dead'
                 else 'queued'
               end,
               run_after = case
                 when %s or attempts >= max_attempts then run_after
                 else now() + make_interval(
                        secs => %s * power(%s, greatest(attempts - 1, 0)))
               end,
               error_code = %s,
               error_msg = %s,
               locked_at = null,
               locked_by = null,
               updated_at = now()
         where id = %s
        """,
        (terminal, terminal, BACKOFF_BASE_SEC, BACKOFF_FACTOR, code, msg[:2000], job_id),
    )
    conn.commit()


def heartbeat(conn: psycopg.Connection, job_id: str, progress: int) -> None:
    """Memperbarui progress sekaligus memperpanjang lock.

    Reaper memakai umur lock untuk mendeteksi worker mati, jadi heartbeat
    harus menyegarkannya. Perubahan kolom inilah yang didorong Supabase
    Realtime ke browser.
    """
    conn.execute(
        """
        update jobs
           set progress = greatest(0, least(100, %s)),
               locked_at = now(),
               updated_at = now()
         where id = %s
        """,
        (progress, job_id),
    )
    conn.commit()
