import logging
from pathlib import Path
from unittest.mock import MagicMock

import pytest

import app.handlers.prepare_thumbnails as thumbnails
from app.errors import JobError
from app.queue import Job, enqueue


def setup_project_with_candidates(conn, count: int):
    uid = conn.execute(
        "insert into auth.users (email) values (%s) returning id",
        (f"thumb-{count}@test.id",),
    ).fetchone()[0]
    conn.execute("insert into profiles (user_id) values (%s)", (uid,))
    sid = conn.execute(
        "insert into sources (kind, external_id, is_public, url_original, status, duration_sec) "
        "values ('youtube', %s, true, 'https://youtu.be/thumbs', 'ready', 600) returning id",
        (f"thumb-source-{count}",),
    ).fetchone()[0]
    pid = conn.execute(
        "insert into projects (user_id, source_id, title) "
        "values (%s, %s, 'Thumbs') returning id",
        (uid, sid),
    ).fetchone()[0]
    ids = []
    for index in range(count):
        ids.append(
            str(
                conn.execute(
                    "insert into clip_candidates "
                    "(project_id, start_sec, end_sec, score, title, hook_text, transcript_slice) "
                    "values (%s, %s, %s, %s, %s, 'hook', 'words') returning id",
                    (pid, index * 20, index * 20 + 15, 1 - index / 100, f"C{index}"),
                ).fetchone()[0]
            )
        )
    conn.commit()
    return str(uid), str(sid), str(pid), ids


def thumbnail_job(conn, uid: str, sid: str, pid: str) -> Job:
    payload = {"source_id": sid, "project_id": pid}
    job_id = enqueue(conn, "prepare_thumbnails", payload, user_id=uid, project_id=pid)
    return Job(job_id, "prepare_thumbnails", payload, 1, 3, pid, uid)


def fake_extract(_src: Path, dest: Path) -> Path:
    dest.write_bytes(b"webp")
    return dest


def test_thumbnail_time_uses_twenty_percent_capped_at_two_seconds():
    assert thumbnails.thumbnail_time(10, 15) == pytest.approx(11)
    assert thumbnails.thumbnail_time(10, 80) == pytest.approx(12)


def test_handler_prepares_only_ranked_top_ten(conn, tmp_path):
    uid, sid, pid, _ = setup_project_with_candidates(conn, count=12)
    downloaded = []
    storage = MagicMock()

    def fake_download(_url, start, end, dest):
        downloaded.append((start, end))
        dest.write_bytes(b"video")
        return dest

    thumbnails.handle_prepare_thumbnails(
        conn,
        thumbnail_job(conn, uid, sid, pid),
        storage=storage,
        download=fake_download,
        extract=fake_extract,
        workdir=tmp_path,
    )
    rows = conn.execute(
        "select thumbnail_status from clip_candidates where project_id=%s "
        "order by score desc, start_sec asc",
        (pid,),
    ).fetchall()
    assert [row[0] for row in rows[:10]] == ["ready"] * 10
    assert [row[0] for row in rows[10:]] == ["pending"] * 2
    assert len(downloaded) == 10
    assert storage.put_file.call_count == 10
    assert all(call.args[2] == "image/webp" for call in storage.put_file.call_args_list)


def test_one_thumbnail_failure_does_not_fail_batch(conn, tmp_path, caplog):
    caplog.set_level(logging.INFO)
    uid, sid, pid, _ = setup_project_with_candidates(conn, count=2)
    calls = 0

    def flaky_download(_url, _start, _end, dest):
        nonlocal calls
        calls += 1
        if calls == 1:
            raise JobError("SOURCE_BLOCKED", "temporary")
        dest.write_bytes(b"video")
        return dest

    thumbnails.handle_prepare_thumbnails(
        conn,
        thumbnail_job(conn, uid, sid, pid),
        storage=MagicMock(),
        download=flaky_download,
        extract=fake_extract,
        workdir=tmp_path,
    )
    states = [
        row[0]
        for row in conn.execute(
            "select thumbnail_status from clip_candidates where project_id=%s "
            "order by score desc",
            (pid,),
        ).fetchall()
    ]
    assert states == ["failed", "ready"]
    events = [
        (record.event_name, record.event_fields)
        for record in caplog.records
        if hasattr(record, "event_name")
        and record.event_name == "thumbnail.failed"
    ]
    assert len(events) == 1
    assert events[0][1]["error_code"] == "SOURCE_BLOCKED"
    assert events[0][1]["error_class"] == "JobError"
    assert events[0][1]["candidate_id"]
    assert "temporary" not in caplog.text


def test_handler_rejects_job_for_different_owner(conn, tmp_path):
    uid, sid, pid, _ = setup_project_with_candidates(conn, count=1)
    other = conn.execute(
        "insert into auth.users (email) values ('other-thumb@test.id') returning id"
    ).fetchone()[0]
    conn.execute("insert into profiles (user_id) values (%s)", (other,))
    conn.commit()
    job = thumbnail_job(conn, str(other), sid, pid)

    with pytest.raises(JobError) as error:
        thumbnails.handle_prepare_thumbnails(
            conn, job, storage=MagicMock(), workdir=tmp_path
        )

    assert error.value.terminal is True
    assert uid != str(other)
