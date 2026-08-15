import logging

from app.queue import enqueue, heartbeat
from app.worker import run_once


def test_synthetic_job_has_one_correlated_lifecycle(conn, caplog):
    caplog.set_level(logging.INFO)
    job_id = enqueue(conn, "ingest", {"source_id": "safe"})

    run_once(
        conn,
        "integration-worker",
        {"ingest": lambda connection, job: heartbeat(connection, job.id, 100)},
    )

    records = [
        record.event_fields | {"event": record.event_name}
        for record in caplog.records
        if getattr(record, "event_name", "").startswith("job.")
    ]
    assert [record["event"] for record in records] == [
        "job.claimed",
        "job.handler.started",
        "job.progress",
        "job.progress",
        "job.progress",
        "job.progress",
        "job.progress",
        "job.completed",
    ]
    assert {record["job_id"] for record in records} == {job_id}
    assert {record["worker_id"] for record in records} == {"integration-worker"}
