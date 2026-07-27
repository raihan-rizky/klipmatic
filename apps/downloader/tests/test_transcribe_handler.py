import json
from unittest.mock import MagicMock

import pytest

from app.errors import JobError
from app.handlers.transcribe import handle_transcribe
from app.providers.transcription import TranscriptResult, Word
from app.queue import Job, enqueue

RESULT = TranscriptResult(
    language="id",
    text="halo semuanya selamat datang",
    words=[
        Word("halo", 0.0, 0.4),
        Word("semuanya", 0.4, 1.0),
        Word("selamat", 1.0, 1.5),
        Word("datang", 1.5, 2.0),
    ],
    provider="deepinfra",
    model="whisper-large-v3-turbo",
    cost_usd=0.012,
)


def _user(conn, email: str = "t@test.id") -> str:
    uid = conn.execute(
        "insert into auth.users (email) values (%s) returning id", (email,)
    ).fetchone()[0]
    conn.execute("insert into profiles (user_id) values (%s)", (uid,))
    conn.commit()
    return str(uid)


def _ready_source(conn, external_id: str = "dQw4w9WgXcQ") -> str:
    sid = conn.execute(
        """
        insert into sources (kind, external_id, is_public, url_original, status,
                             duration_sec, audio_r2_key, audio_sha256)
        values ('youtube', %s, true, 'https://youtu.be/x', 'ready', 3600,
                'audio/abc.opus', 'abc')
        returning id
        """,
        (external_id,),
    ).fetchone()[0]
    conn.commit()
    return str(sid)


def _project(conn, user_id: str, source_id: str) -> str:
    pid = conn.execute(
        "insert into projects (user_id, source_id, title) values (%s, %s, 'p') returning id",
        (user_id, source_id),
    ).fetchone()[0]
    conn.commit()
    return str(pid)


def _job(conn, source_id: str, project_id: str, user_id: str) -> Job:
    """Job sungguhan: handler memanggil heartbeat() yang menulis ke jobs.id
    bertipe uuid, jadi id rekaan ditolak database."""
    payload = {"source_id": source_id, "project_id": project_id}
    job_id = enqueue(conn, "transcribe", payload, user_id=user_id, project_id=project_id)
    return Job(job_id, "transcribe", payload, 1, 3, project_id, user_id)


@pytest.fixture
def deps(tmp_path, monkeypatch):
    monkeypatch.setenv("TRANSCRIBE_CACHE_MODEL", "whisper-large-v3-turbo")
    storage = MagicMock()
    storage.download_to.side_effect = lambda key, dest: dest.write_bytes(b"opus palsu")
    return {
        "storage": storage,
        "transcribe_fn": lambda audio, dur: RESULT,
        "workdir": tmp_path,
    }


def test_menyimpan_transkrip_dan_mencatat_biaya(conn, deps):
    u = _user(conn)
    s = _ready_source(conn)
    p = _project(conn, u, s)

    handle_transcribe(conn, _job(conn, s, p, u), **deps)

    row = conn.execute(
        "select provider, model, language, r2_key, word_count, cost_usd "
        "from transcripts where source_id = %s",
        (s,),
    ).fetchone()
    assert row[0] == "deepinfra"
    assert row[1] == "whisper-large-v3-turbo"
    assert row[2] == "id"
    assert row[3] == f"transcripts/{s}/whisper-large-v3-turbo.json"
    assert row[4] == 4
    assert float(row[5]) == pytest.approx(0.012)


def test_json_yang_diunggah_memuat_word_timestamp(conn, deps):
    u = _user(conn)
    s = _ready_source(conn)
    p = _project(conn, u, s)
    handle_transcribe(conn, _job(conn, s, p, u), **deps)

    put = deps["storage"].put_bytes.call_args
    body = json.loads(put.args[1].decode("utf-8"))
    assert body["language"] == "id"
    assert len(body["words"]) == 4
    assert body["words"][0] == {"text": "halo", "start": 0.0, "end": 0.4}


def test_transkrip_yang_sudah_ada_tidak_dipanggil_ulang(conn, deps):
    u = _user(conn)
    s = _ready_source(conn)
    p = _project(conn, u, s)
    handle_transcribe(conn, _job(conn, s, p, u), **deps)

    calls = []
    deps["transcribe_fn"] = lambda audio, dur: calls.append(1) or RESULT
    handle_transcribe(conn, _job(conn, s, p, u), **deps)

    assert calls == []
    assert (
        conn.execute(
            "select count(*) from transcripts where source_id = %s", (s,)
        ).fetchone()[0]
        == 1
    )


def test_cache_hit_tetap_merantai_ke_analyze(conn, deps):
    """User kedua pada video yang sama harus tetap maju ke tahap analisis,
    bukan berhenti diam-diam karena transkripnya sudah ada."""
    u = _user(conn)
    s = _ready_source(conn)
    p = _project(conn, u, s)
    handle_transcribe(conn, _job(conn, s, p, u), **deps)

    p2 = _project(conn, u, s)
    handle_transcribe(conn, _job(conn, s, p2, u), **deps)

    analyze = conn.execute(
        "select count(*) from jobs where type = 'analyze' and project_id = %s", (p2,)
    ).fetchone()[0]
    assert analyze == 1


def test_merantai_ke_analyze_setelah_transkrip_baru(conn, deps):
    u = _user(conn)
    s = _ready_source(conn)
    p = _project(conn, u, s)
    handle_transcribe(conn, _job(conn, s, p, u), **deps)

    row = conn.execute(
        "select payload->>'source_id', payload->>'project_id', user_id "
        "from jobs where type = 'analyze'"
    ).fetchone()
    assert row[0] == s
    assert row[1] == p
    assert str(row[2]) == u


def test_sumber_belum_ready_ditolak_terminal(conn, deps):
    u = _user(conn)
    sid = conn.execute(
        """
        insert into sources (kind, external_id, is_public, url_original, status)
        values ('youtube', 'belumsiap1', true, 'https://youtu.be/x', 'pending')
        returning id
        """
    ).fetchone()[0]
    conn.commit()
    p = _project(conn, u, str(sid))

    with pytest.raises(JobError) as e:
        handle_transcribe(conn, _job(conn, str(sid), p, u), **deps)
    assert e.value.terminal is True


def test_kegagalan_provider_diteruskan_sebagai_non_terminal(conn, deps):
    u = _user(conn)
    s = _ready_source(conn)
    p = _project(conn, u, s)

    def boom(audio, dur):
        raise JobError("TRANSCRIBE_FAILED", "semua provider down", terminal=False)

    deps["transcribe_fn"] = boom
    with pytest.raises(JobError) as e:
        handle_transcribe(conn, _job(conn, s, p, u), **deps)
    assert e.value.code == "TRANSCRIBE_FAILED"
    assert e.value.terminal is False
    assert (
        conn.execute(
            "select count(*) from transcripts where source_id = %s", (s,)
        ).fetchone()[0]
        == 0
    )
    assert conn.execute("select count(*) from jobs where type = 'analyze'").fetchone()[0] == 0
