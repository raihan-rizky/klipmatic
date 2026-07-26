from __future__ import annotations

import psycopg


def reap_stale_jobs(conn: psycopg.Connection, older_than_sec: int = 300) -> int:
    """Mengembalikan job yang worker-nya mati mendadak ke antrian.

    Deteksinya adalah lock yang tidak diperbarui: heartbeat menyegarkan
    locked_at setiap 30 detik, jadi lock yang lebih tua dari older_than_sec
    berarti worker sudah tidak hidup.
    """
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
    return len(rows)
