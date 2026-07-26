import concurrent.futures

from app.queue import claim_job, complete_job, enqueue, fail_job, heartbeat
from tests.conftest import new_conn


def test_claim_mengembalikan_none_saat_antrian_kosong(conn):
    assert claim_job(conn, "w1") is None


def test_claim_mengembalikan_job_dan_menaikkan_attempts(conn):
    job_id = enqueue(conn, "ingest", {"source_id": "x"})
    job = claim_job(conn, "w1")
    assert job is not None
    assert job.id == job_id
    assert job.type == "ingest"
    assert job.payload == {"source_id": "x"}
    assert job.attempts == 1


def test_job_yang_sudah_diklaim_tidak_diambil_lagi(conn):
    enqueue(conn, "ingest", {})
    assert claim_job(conn, "w1") is not None
    assert claim_job(conn, "w2") is None


def test_tidak_ada_job_diproses_dua_kali_saat_concurrent(conn):
    """Lima worker memperebutkan dua puluh job. Tiap job tepat sekali."""
    for i in range(20):
        enqueue(conn, "ingest", {"n": i})

    def drain(worker_id: str) -> list[str]:
        got = []
        with new_conn() as c:
            while True:
                job = claim_job(c, worker_id)
                if job is None:
                    return got
                got.append(job.id)

    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
        results = list(pool.map(drain, [f"w{i}" for i in range(5)]))

    claimed = [jid for r in results for jid in r]
    assert len(claimed) == 20
    assert len(set(claimed)) == 20


def test_prioritas_lebih_tinggi_diambil_lebih_dulu(conn):
    enqueue(conn, "ingest", {"n": "rendah"}, priority=0)
    high = enqueue(conn, "ingest", {"n": "tinggi"}, priority=10)
    assert claim_job(conn, "w1").id == high


def test_run_after_di_masa_depan_tidak_diambil(conn):
    enqueue(conn, "ingest", {})
    conn.execute("update jobs set run_after = now() + interval '1 hour'")
    conn.commit()
    assert claim_job(conn, "w1") is None


def test_complete_menandai_selesai_dan_progress_penuh(conn):
    job_id = enqueue(conn, "ingest", {})
    claim_job(conn, "w1")
    complete_job(conn, job_id)
    row = conn.execute(
        "select status, progress, locked_at from jobs where id = %s", (job_id,)
    ).fetchone()
    assert row == ("done", 100, None)


def test_fail_non_terminal_menjadwalkan_ulang_dengan_backoff(conn):
    job_id = enqueue(conn, "ingest", {})
    claim_job(conn, "w1")
    fail_job(conn, job_id, "SOURCE_BLOCKED", "diblokir", terminal=False)
    row = conn.execute(
        "select status, error_code, run_after > now() from jobs where id = %s", (job_id,)
    ).fetchone()
    assert row == ("queued", "SOURCE_BLOCKED", True)


def test_fail_terminal_tidak_dicoba_ulang(conn):
    job_id = enqueue(conn, "ingest", {})
    claim_job(conn, "w1")
    fail_job(conn, job_id, "SOURCE_UNAVAILABLE", "privat", terminal=True)
    assert (
        conn.execute("select status from jobs where id = %s", (job_id,)).fetchone()[0]
        == "failed"
    )


def test_melebihi_max_attempts_menjadi_dead(conn):
    job_id = enqueue(conn, "ingest", {})
    for _ in range(3):
        conn.execute("update jobs set run_after = now()")
        conn.commit()
        claim_job(conn, "w1")
        fail_job(conn, job_id, "TRANSCRIBE_FAILED", "gagal", terminal=False)
    assert (
        conn.execute("select status from jobs where id = %s", (job_id,)).fetchone()[0]
        == "dead"
    )


def test_heartbeat_memperbarui_progress_dan_lock(conn):
    job_id = enqueue(conn, "ingest", {})
    claim_job(conn, "w1")
    conn.execute("update jobs set locked_at = now() - interval '10 minutes'")
    conn.commit()
    heartbeat(conn, job_id, 42)
    row = conn.execute(
        "select progress, locked_at > now() - interval '1 minute' from jobs where id = %s",
        (job_id,),
    ).fetchone()
    assert row == (42, True)
