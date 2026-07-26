from app.errors import JobError
from app.queue import enqueue
from app.worker import run_once


def test_run_once_mengembalikan_false_saat_antrian_kosong(conn):
    assert run_once(conn, "w1", {}) is False


def test_handler_sukses_menandai_job_selesai(conn):
    seen = []
    job_id = enqueue(conn, "ingest", {"a": 1})

    def handler(c, job):
        seen.append(job.payload)

    assert run_once(conn, "w1", {"ingest": handler}) is True
    assert seen == [{"a": 1}]
    assert (
        conn.execute("select status from jobs where id = %s", (job_id,)).fetchone()[0]
        == "done"
    )


def test_job_error_terminal_menggagalkan_tanpa_retry(conn):
    job_id = enqueue(conn, "ingest", {})

    def handler(c, job):
        raise JobError("SOURCE_UNAVAILABLE", "video privat", terminal=True)

    run_once(conn, "w1", {"ingest": handler})
    row = conn.execute(
        "select status, error_code from jobs where id = %s", (job_id,)
    ).fetchone()
    assert row == ("failed", "SOURCE_UNAVAILABLE")


def test_exception_tak_terduga_menjadi_INTERNAL_dan_dicoba_ulang(conn):
    job_id = enqueue(conn, "ingest", {})

    def handler(c, job):
        raise ValueError("bug tak terduga")

    run_once(conn, "w1", {"ingest": handler})
    row = conn.execute(
        "select status, error_code from jobs where id = %s", (job_id,)
    ).fetchone()
    assert row == ("queued", "INTERNAL")


def test_tipe_tanpa_handler_gagal_terminal(conn):
    job_id = enqueue(conn, "ingest", {})
    run_once(conn, "w1", {})
    row = conn.execute(
        "select status, error_code from jobs where id = %s", (job_id,)
    ).fetchone()
    assert row == ("failed", "INTERNAL")
