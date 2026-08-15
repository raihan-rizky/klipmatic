import logging
from unittest.mock import MagicMock, call

from app.queue import claim_job, complete_job, enqueue
from app.reaper import reap_expired_media_assets, reap_stale_jobs


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


def test_job_reaper_logs_summary(conn, caplog):
    caplog.set_level(logging.INFO)
    enqueue(conn, "ingest", {})
    claim_job(conn, "w1")
    conn.execute("update jobs set locked_at = now() - interval '10 minutes'")
    conn.commit()

    assert reap_stale_jobs(conn, older_than_sec=300) == 1

    record = next(
        record
        for record in caplog.records
        if getattr(record, "event_name", None) == "reaper.jobs.completed"
    )
    assert record.event_fields["reaped_count"] == 1
    assert record.event_fields["operation"] == "stale_jobs"


def _media_project(conn) -> tuple[str, str]:
    user_id = conn.execute(
        "insert into auth.users (email) values ('reaper@test.id') returning id"
    ).fetchone()[0]
    conn.execute("insert into profiles (user_id) values (%s)", (user_id,))
    source_id = conn.execute(
        """
        insert into sources (kind, external_id, is_public, url_original, status)
        values ('youtube', 'reaper0001', true, 'https://youtu.be/reaper', 'ready')
        returning id
        """
    ).fetchone()[0]
    project_id = conn.execute(
        "insert into projects (user_id, source_id, title) values (%s, %s, 'reaper') returning id",
        (user_id, source_id),
    ).fetchone()[0]
    conn.commit()
    return str(user_id), str(project_id)


def test_reaper_deletes_three_day_and_incomplete_one_hour_objects(conn):
    user_id, project_id = _media_project(conn)
    rows = [
        ("expired.mp4", "ready", "4 days", "4 days"),
        ("incomplete.png", "uploading", "3 days", "2 hours"),
        ("fresh.mp3", "ready", "3 days", "1 minute"),
    ]
    for name, status, expires_in, age in rows:
        conn.execute(
            """
            insert into media_assets
              (user_id, project_id, source, media_type, status, name, storage_key,
               mime_type, bytes, expires_at, created_at)
            values (%s, %s, 'upload', 'video', %s, %s, %s,
                    'video/mp4', 12, now() + %s::interval, now() - %s::interval)
            """,
            (user_id, project_id, status, name, f"uploads/{name}", expires_in, age),
        )
    conn.execute(
        "update media_assets set expires_at = now() - interval '1 minute' where name = 'expired.mp4'"
    )
    conn.commit()
    storage = MagicMock()

    assert reap_expired_media_assets(conn, storage) == 2
    assert storage.delete.call_args_list == [
        call("uploads/expired.mp4"),
        call("uploads/incomplete.png"),
    ]
    assert reap_expired_media_assets(conn, storage) == 0

    states = dict(
        conn.execute("select name, status from media_assets order by name").fetchall()
    )
    assert states == {
        "expired.mp4": "expired",
        "fresh.mp3": "ready",
        "incomplete.png": "expired",
    }
