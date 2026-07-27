from dataclasses import replace
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from app.errors import JobError
from app.handlers.ingest import handle_ingest
from app.queue import Job, enqueue
from app.ytdlp import SourceMeta

META = SourceMeta(
    title="Podcast Contoh",
    channel="Channel Contoh",
    duration_sec=3600,
    thumbnail_url="https://example.com/t.jpg",
    availability="public",
)


def _user(conn, email: str) -> str:
    uid = conn.execute(
        "insert into auth.users (email) values (%s) returning id", (email,)
    ).fetchone()[0]
    conn.execute("insert into profiles (user_id) values (%s)", (uid,))
    conn.commit()
    return str(uid)


def _source(conn, owner: str, external_id: str = "dQw4w9WgXcQ") -> str:
    sid = conn.execute(
        """
        insert into sources (kind, external_id, is_public, owner_user_id, url_original, status)
        values ('youtube', %s, false, %s, 'https://youtu.be/x', 'pending')
        returning id
        """,
        (external_id, owner),
    ).fetchone()[0]
    conn.commit()
    return str(sid)


def _project(conn, user: str, source: str) -> str:
    pid = conn.execute(
        "insert into projects (user_id, source_id, title) values (%s, %s, 'p') returning id",
        (user, source),
    ).fetchone()[0]
    conn.commit()
    return str(pid)


def _job(conn, source_id: str, project_id: str, user_id: str) -> Job:
    """Membuat baris job sungguhan.

    Handler memanggil heartbeat() yang menulis ke jobs.id bertipe uuid, jadi
    id rekaan seperti "j1" ditolak database.
    """
    payload = {"source_id": source_id, "project_id": project_id}
    job_id = enqueue(conn, "ingest", payload, user_id=user_id, project_id=project_id)
    return Job(job_id, "ingest", payload, 1, 3, project_id, user_id)


@pytest.fixture
def deps(tmp_path: Path):
    storage = MagicMock()
    storage.exists.return_value = False

    def fake_download(url, dest, on_progress):
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(b"audio palsu")
        on_progress(50)
        return dest

    def fake_extract(src, dest):
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(b"opus palsu")
        return dest

    return {
        "storage": storage,
        "probe": lambda url: META,
        "download_audio": fake_download,
        "extract_audio": fake_extract,
        "workdir": tmp_path,
    }


def test_ingest_baru_mengunggah_audio_dan_menandai_ready(conn, deps):
    u = _user(conn, "a@test.id")
    s = _source(conn, u)
    p = _project(conn, u, s)

    handle_ingest(
        conn, _job(conn, s, p, u), **deps
    )

    row = conn.execute(
        "select status, audio_r2_key, audio_sha256, duration_sec, title, is_public "
        "from sources where id = %s",
        (s,),
    ).fetchone()
    assert row[0] == "ready"
    assert row[1].startswith("audio/")
    assert len(row[2]) == 64
    assert row[3] == 3600
    assert row[4] == "Podcast Contoh"
    assert row[5] is True  # dipromosikan karena availability == 'public'
    deps["storage"].put_file.assert_called_once()


def test_sumber_unlisted_tetap_privat(conn, deps):
    u = _user(conn, "b@test.id")
    s = _source(conn, u)
    p = _project(conn, u, s)
    deps["probe"] = lambda url: replace(META, availability="unlisted")

    handle_ingest(
        conn, _job(conn, s, p, u), **deps
    )

    row = conn.execute(
        "select is_public, owner_user_id from sources where id = %s", (s,)
    ).fetchone()
    assert row[0] is False
    assert str(row[1]) == u


def test_user_kedua_memakai_ulang_sumber_publik_tanpa_mengunduh(conn, deps):
    a = _user(conn, "a2@test.id")
    sa = _source(conn, a)
    pa = _project(conn, a, sa)
    handle_ingest(
        conn, _job(conn, sa, pa, a), **deps
    )

    b = _user(conn, "b2@test.id")
    sb = _source(conn, b)  # baris privat milik B untuk video yang sama
    pb = _project(conn, b, sb)

    called = []
    deps["probe"] = lambda url: called.append(url) or META

    handle_ingest(
        conn, _job(conn, sb, pb, b), **deps
    )

    assert called == []  # yt-dlp tidak dipanggil sama sekali
    # Proyek B dialihkan ke sumber publik milik bersama, baris duplikat dihapus.
    assert (
        str(conn.execute("select source_id from projects where id = %s", (pb,)).fetchone()[0])
        == sa
    )
    assert conn.execute("select count(*) from sources where id = %s", (sb,)).fetchone()[0] == 0


def test_sumber_privat_tidak_dipakai_ulang_lintas_user(conn, deps):
    unlisted = replace(META, availability="unlisted")
    deps["probe"] = lambda url: unlisted
    a = _user(conn, "a3@test.id")
    sa = _source(conn, a, "GDRIVE_ID_AAAAAAAAAAAAAAA")
    pa = _project(conn, a, sa)
    handle_ingest(
        conn, _job(conn, sa, pa, a), **deps
    )

    b = _user(conn, "b3@test.id")
    sb = _source(conn, b, "GDRIVE_ID_AAAAAAAAAAAAAAA")
    pb = _project(conn, b, sb)

    called = []
    deps["probe"] = lambda url: called.append(url) or unlisted
    handle_ingest(
        conn, _job(conn, sb, pb, b), **deps
    )

    assert len(called) == 1  # B mengunduh sendiri, tidak memakai milik A
    assert (
        str(conn.execute("select source_id from projects where id = %s", (pb,)).fetchone()[0])
        == sb
    )


def test_merantai_ke_transcribe_setelah_berhasil(conn, deps):
    u = _user(conn, "rantai@test.id")
    s = _source(conn, u)
    p = _project(conn, u, s)

    handle_ingest(conn, _job(conn, s, p, u), **deps)

    row = conn.execute(
        "select payload->>'source_id', payload->>'project_id', user_id "
        "from jobs where type = 'transcribe'"
    ).fetchone()
    assert row[0] == s
    assert row[1] == p
    assert str(row[2]) == u


def test_cache_hit_tetap_merantai_ke_transcribe(conn, deps):
    """Proyek user kedua harus tetap maju ke transkripsi meski audionya
    dipakai ulang, bukan berhenti diam-diam."""
    a = _user(conn, "rantai-a@test.id")
    sa = _source(conn, a)
    pa = _project(conn, a, sa)
    handle_ingest(conn, _job(conn, sa, pa, a), **deps)

    b = _user(conn, "rantai-b@test.id")
    sb = _source(conn, b)
    pb = _project(conn, b, sb)
    handle_ingest(conn, _job(conn, sb, pb, b), **deps)

    row = conn.execute(
        "select payload->>'source_id' from jobs "
        "where type = 'transcribe' and project_id = %s",
        (pb,),
    ).fetchone()
    assert row is not None
    assert row[0] == sa  # menunjuk sumber bersama, bukan baris yang dihapus


def test_kegagalan_tidak_merantai_ke_transcribe(conn, deps):
    u = _user(conn, "gagal@test.id")
    s = _source(conn, u)
    p = _project(conn, u, s)
    deps["probe"] = lambda url: (_ for _ in ()).throw(
        JobError("SOURCE_BLOCKED", "diblokir", terminal=False)
    )

    with pytest.raises(JobError):
        handle_ingest(conn, _job(conn, s, p, u), **deps)

    assert conn.execute("select count(*) from jobs where type = 'transcribe'").fetchone()[0] == 0


def test_error_terminal_menandai_sumber_failed(conn, deps):
    u = _user(conn, "c@test.id")
    s = _source(conn, u)
    p = _project(conn, u, s)

    def boom(url):
        raise JobError("SOURCE_UNAVAILABLE", "privat", terminal=True)

    deps["probe"] = boom

    with pytest.raises(JobError) as e:
        handle_ingest(
            conn, _job(conn, s, p, u), **deps
        )

    assert e.value.code == "SOURCE_UNAVAILABLE"
    row = conn.execute(
        "select status, error_code from sources where id = %s", (s,)
    ).fetchone()
    assert row == ("failed", "SOURCE_UNAVAILABLE")
