import logging

from app import worker
from app.errors import JobError
from app.observability import emit
from app.queue import enqueue, heartbeat
from app.worker import run_once


def _events(caplog):
    return [
        (record.event_name, record.event_fields, record)
        for record in caplog.records
        if hasattr(record, "event_name")
    ]


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


def test_default_handlers_register_thumbnail_preparation():
    assert "prepare_thumbnails" in worker.default_handlers()


def test_run_once_logs_correlated_success(conn, caplog):
    caplog.set_level(logging.INFO)
    job_id = enqueue(conn, "ingest", {})

    assert run_once(conn, "w1", {"ingest": lambda _conn, _job: None}) is True

    events = _events(caplog)
    assert [name for name, _fields, _record in events] == [
        "job.claimed",
        "job.handler.started",
        "job.completed",
    ]
    assert all(fields["job_id"] == job_id for _name, fields, _record in events)
    assert all(fields["worker_id"] == "w1" for _name, fields, _record in events)
    assert events[-1][1]["duration_ms"] >= 0


def test_job_error_logs_retry_schedule(conn, caplog):
    caplog.set_level(logging.INFO)
    enqueue(conn, "ingest", {})

    def handler(_conn, _job):
        raise JobError("SOURCE_BLOCKED", "sensitive detail", terminal=False)

    run_once(conn, "w1", {"ingest": handler})

    event = next(item for item in _events(caplog) if item[0] == "job.retry_scheduled")
    assert event[1]["error_code"] == "SOURCE_BLOCKED"
    assert event[1]["next_attempt"] == 2
    assert event[1]["retry_delay_sec"] == 60
    assert "sensitive detail" not in caplog.text


def test_terminal_error_logs_failed(conn, caplog):
    caplog.set_level(logging.INFO)
    enqueue(conn, "ingest", {})

    def handler(_conn, _job):
        raise JobError("SOURCE_UNAVAILABLE", "private title", terminal=True)

    run_once(conn, "w1", {"ingest": handler})

    event = next(item for item in _events(caplog) if item[0] == "job.failed")
    assert event[1]["error_code"] == "SOURCE_UNAVAILABLE"
    assert "private title" not in caplog.text


def test_unexpected_exception_logs_safe_trace(conn, caplog):
    caplog.set_level(logging.INFO)
    enqueue(conn, "ingest", {})

    def handler(_conn, _job):
        raise ValueError("secret payload")

    run_once(conn, "w1", {"ingest": handler})

    event = next(item for item in _events(caplog) if item[0] == "job.retry_scheduled")
    assert event[1]["error_code"] == "INTERNAL"
    assert event[1]["error_class"] == "ValueError"
    assert event[2].exc_info is None
    assert event[2].safe_trace[-1]["function"] == "handler"
    assert "secret payload" not in caplog.text


def test_heartbeat_logs_only_crossed_milestones(conn, caplog):
    caplog.set_level(logging.INFO)
    enqueue(conn, "ingest", {})

    def handler(c, job):
        for progress in (5, 25, 26, 75, 100, 100):
            heartbeat(c, job.id, progress)

    run_once(conn, "w1", {"ingest": handler})

    progress = [
        fields["progress"]
        for name, fields, _record in _events(caplog)
        if name == "job.progress"
    ]
    assert progress == [0, 25, 50, 75, 100]


def test_job_context_is_cleared_after_run(conn, caplog):
    caplog.set_level(logging.INFO)
    enqueue(conn, "ingest", {})
    run_once(conn, "w1", {"ingest": lambda _conn, _job: None})

    emit(logging.getLogger("test.worker"), "worker.started", worker_id="outside")
    outside = _events(caplog)[-1]
    assert outside[0] == "worker.started"
    assert outside[1] == {"worker_id": "outside"}
