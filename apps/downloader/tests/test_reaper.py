from app.queue import claim_job, complete_job, enqueue
from app.reaper import reap_stale_jobs


def test_job_dengan_lock_basi_dikembalikan_ke_antrian(conn):
    job_id = enqueue(conn, "ingest", {})
    claim_job(conn, "w1")
    conn.execute("update jobs set locked_at = now() - interval '10 minutes'")
    conn.commit()

    assert reap_stale_jobs(conn, older_than_sec=300) == 1
    row = conn.execute(
        "select status, locked_by, error_code from jobs where id = %s", (job_id,)
    ).fetchone()
    assert row == ("queued", None, "WORKER_LOST")


def test_job_dengan_lock_segar_tidak_disentuh(conn):
    enqueue(conn, "ingest", {})
    claim_job(conn, "w1")
    assert reap_stale_jobs(conn, older_than_sec=300) == 0


def test_job_selesai_tidak_disentuh(conn):
    job_id = enqueue(conn, "ingest", {})
    claim_job(conn, "w1")
    complete_job(conn, job_id)
    assert reap_stale_jobs(conn, older_than_sec=0) == 0


def test_reaper_menghormati_max_attempts(conn):
    job_id = enqueue(conn, "ingest", {})
    conn.execute("update jobs set max_attempts = 1")
    conn.commit()
    claim_job(conn, "w1")
    conn.execute("update jobs set locked_at = now() - interval '10 minutes'")
    conn.commit()

    reap_stale_jobs(conn, older_than_sec=300)
    assert (
        conn.execute("select status from jobs where id = %s", (job_id,)).fetchone()[0]
        == "dead"
    )
