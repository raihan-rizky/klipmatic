from __future__ import annotations

import uuid
from decimal import Decimal
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from app.errors import JobError
from app.ffmpeg import MediaProbe
from app.handlers.probe_asset import handle_probe_asset
from app.queue import Job


def _asset(conn, *, media_type: str = "video") -> tuple[str, str, str]:
    user_id = conn.execute(
        "insert into auth.users (email) values ('probe@test.id') returning id"
    ).fetchone()[0]
    conn.execute("insert into profiles (user_id) values (%s)", (user_id,))
    source_id = conn.execute(
        """
        insert into sources (kind, external_id, is_public, url_original, status)
        values ('youtube', 'probe-asset', true, 'https://youtu.be/probe', 'ready')
        returning id
        """
    ).fetchone()[0]
    project_id = conn.execute(
        "insert into projects (user_id, source_id, title) values (%s, %s, 'probe') returning id",
        (user_id, source_id),
    ).fetchone()[0]
    asset_id = conn.execute(
        """
        insert into media_assets
          (user_id, project_id, source, media_type, status, name, storage_key,
           mime_type, bytes, expires_at)
        values (%s, %s, 'upload', %s, 'uploading', 'clip.mp4',
                'uploads/clip.mp4', 'video/mp4', 12, now() + interval '3 days')
        returning id
        """,
        (user_id, project_id, media_type),
    ).fetchone()[0]
    conn.commit()
    return str(asset_id), str(project_id), str(user_id)


def _job(asset_id: str, project_id: str, user_id: str) -> Job:
    return Job(
        id=str(uuid.uuid4()),
        type="probe_asset",
        payload={"asset_id": asset_id},
        attempts=1,
        max_attempts=3,
        project_id=project_id,
        user_id=user_id,
    )


def test_probe_video_marks_asset_ready_with_dimensions_and_audio(conn, tmp_path: Path):
    asset_id, project_id, user_id = _asset(conn)
    storage = MagicMock()
    storage.download_to.side_effect = lambda key, dest: dest.write_bytes(b"fake") or dest

    handle_probe_asset(
        conn,
        _job(asset_id, project_id, user_id),
        storage=storage,
        probe=lambda _: MediaProbe("video", 4.2, 1920, 1080, True),
        workdir=tmp_path,
    )

    row = conn.execute(
        "select status, duration_sec, width, height, has_audio from media_assets where id = %s",
        (asset_id,),
    ).fetchone()
    assert row == ("ready", Decimal("4.200"), 1920, 1080, True)


def test_probe_type_mismatch_marks_asset_failed_terminally(conn, tmp_path: Path):
    asset_id, project_id, user_id = _asset(conn, media_type="video")
    storage = MagicMock()
    storage.download_to.side_effect = lambda key, dest: dest.write_bytes(b"fake") or dest

    with pytest.raises(JobError) as caught:
        handle_probe_asset(
            conn,
            _job(asset_id, project_id, user_id),
            storage=storage,
            probe=lambda _: MediaProbe("audio", 4.2, None, None, True),
            workdir=tmp_path,
        )

    assert caught.value.code == "ASSET_INVALID"
    assert caught.value.terminal is True
    assert conn.execute(
        "select status from media_assets where id = %s", (asset_id,)
    ).fetchone()[0] == "failed"


def test_probe_rejects_job_with_wrong_owner_before_storage_download(conn, tmp_path: Path):
    asset_id, project_id, user_id = _asset(conn)
    storage = MagicMock()

    with pytest.raises(JobError):
        handle_probe_asset(
            conn,
            _job(asset_id, project_id, str(uuid.uuid4())),
            storage=storage,
            probe=lambda _: MediaProbe("video", 1, 1, 1, False),
            workdir=tmp_path,
        )

    storage.download_to.assert_not_called()
