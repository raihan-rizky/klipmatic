import logging
from pathlib import Path
from unittest.mock import MagicMock

from app.handlers import render_previews
from app.queue import Job, enqueue


def setup_project_with_candidates(conn, count: int):
    uid = conn.execute(
        "insert into auth.users (email) values (%s) returning id",
        (f"render-{count}@test.id",),
    ).fetchone()[0]
    conn.execute("insert into profiles (user_id) values (%s)", (uid,))
    sid = conn.execute(
        "insert into sources (kind, external_id, is_public, url_original, status, duration_sec) "
        "values ('youtube', %s, true, 'https://youtu.be/renders', 'ready', 600) returning id",
        (f"render-source-{count}",),
    ).fetchone()[0]
    pid = conn.execute(
        "insert into projects (user_id, source_id, title) "
        "values (%s, %s, 'Renders') returning id",
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


def render_job(conn, uid: str, pid: str) -> Job:
    payload = {"project_id": pid}
    job_id = enqueue(conn, "render_previews", payload, user_id=uid, project_id=pid)
    return Job(job_id, "render_previews", payload, 1, 3, pid, uid)


def fake_extract_frames(_src: Path, _dest_dir: Path, _fps: float = 0.5) -> list[Path]:
    return []


def fake_crop(src: Path, dest: Path, _focus_x: float) -> Path:
    dest.write_bytes(b"cropped-" + src.read_bytes()[:4])
    return dest


def test_marks_candidates_ready_after_successful_render(conn, tmp_path):
    uid, _sid, pid, ids = setup_project_with_candidates(conn, count=2)
    storage = MagicMock()

    def fake_download(_url, start, end, dest):
        dest.write_bytes(b"video" + str(start).encode())
        return dest

    render_previews.handle_render_previews(
        conn,
        render_job(conn, uid, pid),
        storage=storage,
        download=fake_download,
        extract_frames=fake_extract_frames,
        compute_focus=lambda _frames: 0.5,
        crop=fake_crop,
        workdir=tmp_path,
    )

    rows = conn.execute(
        "select preview_status, preview_r2_key from clip_candidates "
        "where project_id = %s order by score desc, start_sec asc",
        (pid,),
    ).fetchall()
    assert [r[0] for r in rows] == ["ready", "ready"]
    for status, key in rows:
        assert status == "ready"
        assert key is not None and key.startswith("previews/")
        assert key.endswith(".mp4")
    assert storage.put_file.call_count == 2
    assert len(ids) == 2


def test_marks_candidate_rendering_before_download(conn, tmp_path):
    """Status rendering sudah terlihat sebelum I/O kandidat dimulai."""
    uid, _sid, pid, ids = setup_project_with_candidates(conn, count=1)
    seen_statuses: list[str] = []

    def observe_then_download(_url, _start, _end, dest):
        row = conn.execute(
            "select preview_status from clip_candidates where id = %s", (ids[0],)
        ).fetchone()
        seen_statuses.append(str(row[0]))
        dest.write_bytes(b"video")
        return dest

    render_previews.handle_render_previews(
        conn,
        render_job(conn, uid, pid),
        storage=MagicMock(),
        download=observe_then_download,
        extract_frames=fake_extract_frames,
        compute_focus=lambda _frames: 0.5,
        crop=fake_crop,
        workdir=tmp_path,
    )

    assert seen_statuses == ["rendering"]


def test_failed_candidate_does_not_abort_batch(conn, tmp_path):
    uid, _sid, pid, ids = setup_project_with_candidates(conn, count=2)
    storage = MagicMock()
    calls = {"n": 0}

    def flaky_download(_url, start, _end, dest):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("boom")
        dest.write_bytes(b"video" + str(start).encode())
        return dest

    render_previews.handle_render_previews(
        conn,
        render_job(conn, uid, pid),
        storage=storage,
        download=flaky_download,
        extract_frames=fake_extract_frames,
        compute_focus=lambda _frames: 0.5,
        crop=fake_crop,
        workdir=tmp_path,
    )

    rows = conn.execute(
        "select id, preview_status, preview_r2_key from clip_candidates "
        "where project_id = %s order by score desc, start_sec asc",
        (pid,),
    ).fetchall()
    by_id = {str(r[0]): (r[1], r[2]) for r in rows}
    # Kandidat pertama (score tertinggi) gagal, kedua tetap ready.
    assert by_id[ids[0]][0] == "failed"
    assert by_id[ids[0]][1] is None
    assert by_id[ids[1]][0] == "ready"
    assert by_id[ids[1]][1] is not None


def test_failed_candidate_emits_structured_safe_event(conn, tmp_path, caplog):
    uid, _sid, pid, ids = setup_project_with_candidates(conn, count=1)
    caplog.set_level(logging.INFO)

    def failed_download(*_args):
        raise RuntimeError("boom")

    render_previews.handle_render_previews(
        conn,
        render_job(conn, uid, pid),
        storage=MagicMock(),
        download=failed_download,
        workdir=tmp_path,
    )

    record = next(
        record
        for record in caplog.records
        if getattr(record, "event_name", None) == "preview.failed"
    )
    assert record.event_fields["candidate_id"] == ids[0]
    assert record.event_fields["error_code"] == "INTERNAL"
    assert record.event_fields["error_class"] == "RuntimeError"
    assert record.safe_trace


def test_uploads_content_addressed_key(conn, tmp_path):
    """Key R2 berbasis isi, jadi dua kandidat identik berbagi satu objek."""
    uid, _sid, pid, _ids = setup_project_with_candidates(conn, count=2)
    storage = MagicMock()

    def fake_download(_url, _start, _end, dest):
        dest.write_bytes(b"identik")  # isi sama → hash sama
        return dest

    render_previews.handle_render_previews(
        conn,
        render_job(conn, uid, pid),
        storage=storage,
        download=fake_download,
        extract_frames=fake_extract_frames,
        compute_focus=lambda _frames: 0.5,
        crop=lambda _src, dest, _fx: (dest.write_bytes(b"sama") or dest),
        workdir=tmp_path,
    )

    keys = [call.args[0] for call in storage.put_file.call_args_list]
    assert len(set(keys)) == 1  # kedua kandidat berbagi key yang sama


def test_project_not_owned_raises_terminal(conn, tmp_path):
    from app.errors import JobError

    uid, _sid, pid, _ids = setup_project_with_candidates(conn, count=1)
    other_uid = conn.execute(
        "insert into auth.users (email) values ('other@test.id') returning id"
    ).fetchone()[0]
    conn.execute("insert into profiles (user_id) values (%s)", (other_uid,))
    conn.commit()

    job = render_job(conn, uid, pid)
    job = Job(job.id, job.type, job.payload, job.attempts, job.max_attempts, pid, str(other_uid))

    try:
        render_previews.handle_render_previews(
            conn, job, storage=MagicMock(), workdir=tmp_path,
        )
        assert False, "seharusnya melempar JobError"
    except JobError as exc:
        assert exc.terminal is True
