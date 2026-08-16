import json
from unittest.mock import MagicMock

import pytest

from app.crypto import ApiKeyRecord
from app.errors import JobError
from app.handlers.analyze import compute_input_hash, handle_analyze
from app.queue import Job, enqueue

LLM_OUTPUT = json.dumps(
    {
        "candidates": [
            {
                "start_sec": 10,
                "end_sec": 80,
                "score": 0.9,
                "title": "Satu",
                "hook_text": "Hook satu",
                "reason": "Alasan",
            },
            {
                "start_sec": 100,
                "end_sec": 170,
                "score": 0.7,
                "title": "Dua",
                "hook_text": "Hook dua",
                "reason": "Alasan",
            },
        ]
    }
)

TRANSCRIPT = {
    "language": "id",
    "text": "...",
    "provider": "deepinfra",
    "model": "whisper-large-v3-turbo",
    "words": [{"text": "kata", "start": float(i), "end": float(i) + 0.4} for i in range(0, 200)],
}

KEY = ApiKeyRecord(
    id="k", provider="gemini", base_url=None, model="gemini-3.1-flash-lite", secret="s"
)


def _setup(conn, email: str = "a@test.id", external_id: str = "analisis001"):
    uid = conn.execute(
        "insert into auth.users (email) values (%s) returning id", (email,)
    ).fetchone()[0]
    conn.execute("insert into profiles (user_id) values (%s)", (uid,))
    sid = conn.execute(
        """
        insert into sources (kind, external_id, is_public, url_original, status, duration_sec)
        values ('youtube', %s, true, 'https://youtu.be/x', 'ready', 300)
        returning id
        """,
        (external_id,),
    ).fetchone()[0]
    conn.execute(
        """insert into transcripts (source_id, provider, model, language, r2_key, word_count)
           values (%s, 'deepinfra', 'whisper-large-v3-turbo', 'id', 'transcripts/t.json', 200)""",
        (sid,),
    )
    pid = conn.execute(
        "insert into projects (user_id, source_id, title) values (%s, %s, 'p') returning id",
        (uid, sid),
    ).fetchone()[0]
    conn.commit()
    return str(uid), str(sid), str(pid)


def _job(conn, source_id: str, project_id: str, user_id: str) -> Job:
    payload = {"source_id": source_id, "project_id": project_id}
    job_id = enqueue(conn, "analyze", payload, user_id=user_id, project_id=project_id)
    return Job(job_id, "analyze", payload, 1, 3, project_id, user_id)


@pytest.fixture
def deps(monkeypatch):
    storage = MagicMock()
    storage.get_bytes.return_value = json.dumps(TRANSCRIPT).encode()
    monkeypatch.setattr(
        "app.handlers.analyze.load_api_key", lambda conn, uid, provider=None: KEY
    )
    return {"storage": storage, "call": lambda key, prompt: LLM_OUTPUT}


def test_menulis_kandidat_dan_mencatat_llm_run(conn, deps):
    uid, sid, pid = _setup(conn)
    handle_analyze(conn, _job(conn, sid, pid, uid), **deps)

    rows = conn.execute(
        "select title, hook_text, start_sec, end_sec, score, transcript_slice "
        "from clip_candidates where project_id = %s order by score desc",
        (pid,),
    ).fetchall()
    assert [r[0] for r in rows] == ["Satu", "Dua"]
    assert rows[0][1] == "Hook satu"
    assert float(rows[0][2]) == 10.0
    assert rows[0][5]

    run = conn.execute(
        "select provider, model, prompt_version, input_hash from llm_runs where source_id = %s",
        (sid,),
    ).fetchone()
    assert run[0] == "gemini"
    assert run[2] == "highlights_v1"
    assert len(run[3]) == 64


def test_nebius_env_didahulukan_atas_byok_user(conn, deps, monkeypatch):
    uid, sid, pid = _setup(conn, external_id="analisis-nebius")
    monkeypatch.setenv("NEBIUS_API_KEY", "nebius-rahasia")
    monkeypatch.setenv("NEBIUS_MODEL", "meta-llama/Llama-3.3-70B-Instruct")
    seen = []
    deps["call"] = lambda key, prompt: seen.append(key) or LLM_OUTPUT

    handle_analyze(conn, _job(conn, sid, pid, uid), **deps)

    assert len(seen) == 1
    assert seen[0].id == "env:nebius"
    assert seen[0].provider == "openai_compat"
    assert seen[0].model == "meta-llama/Llama-3.3-70B-Instruct"
    assert "nebius-rahasia" not in repr(seen[0])
    run = conn.execute(
        "select provider, model from llm_runs where source_id = %s", (sid,)
    ).fetchone()
    assert run == ("openai_compat", "meta-llama/Llama-3.3-70B-Instruct")


def test_kandidat_terhubung_ke_llm_run(conn, deps):
    uid, sid, pid = _setup(conn)
    handle_analyze(conn, _job(conn, sid, pid, uid), **deps)
    n = conn.execute(
        "select count(*) from clip_candidates c join llm_runs r on r.id = c.llm_run_id "
        "where c.project_id = %s",
        (pid,),
    ).fetchone()[0]
    assert n == 2


def test_cache_hit_tidak_memanggil_llm_lagi(conn, deps):
    uid, sid, pid = _setup(conn)
    handle_analyze(conn, _job(conn, sid, pid, uid), **deps)

    pid2 = conn.execute(
        "insert into projects (user_id, source_id, title) values (%s, %s, 'p2') returning id",
        (uid, sid),
    ).fetchone()[0]
    conn.commit()

    calls = []
    deps["call"] = lambda key, prompt: calls.append(1) or LLM_OUTPUT
    handle_analyze(conn, _job(conn, sid, str(pid2), uid), **deps)

    assert calls == []
    assert (
        conn.execute(
            "select count(*) from clip_candidates where project_id = %s", (pid2,)
        ).fetchone()[0]
        == 2
    )
    assert conn.execute("select count(*) from llm_runs where source_id = %s", (sid,)).fetchone()[
        0
    ] == 1


def test_cache_dipakai_bersama_lintas_user_pada_sumber_publik(conn, deps):
    """Inti penghematan spec §8: user kedua pada video publik yang sama tidak
    membayar apa pun ke provider LLM-nya sendiri."""
    uid, sid, pid = _setup(conn)
    handle_analyze(conn, _job(conn, sid, pid, uid), **deps)

    uid2 = conn.execute(
        "insert into auth.users (email) values ('b@test.id') returning id"
    ).fetchone()[0]
    conn.execute("insert into profiles (user_id) values (%s)", (uid2,))
    pid2 = conn.execute(
        "insert into projects (user_id, source_id, title) values (%s, %s, 'p') returning id",
        (uid2, sid),
    ).fetchone()[0]
    conn.commit()

    calls = []
    deps["call"] = lambda key, prompt: calls.append(1) or LLM_OUTPUT
    handle_analyze(conn, _job(conn, sid, str(pid2), str(uid2)), **deps)

    assert calls == []
    assert (
        conn.execute(
            "select count(*) from clip_candidates where project_id = %s", (pid2,)
        ).fetchone()[0]
        == 2
    )


def test_model_berbeda_menghasilkan_input_hash_berbeda(conn, deps):
    a = compute_input_hash("t1", "highlights_v1", "gemini-3.1-flash-lite")
    b = compute_input_hash("t1", "highlights_v1", "gpt-5-nano")
    c = compute_input_hash("t1", "highlights_v2", "gemini-3.1-flash-lite")
    d = compute_input_hash("t2", "highlights_v1", "gemini-3.1-flash-lite")
    assert len({a, b, c, d}) == 4


def test_transkrip_belum_ada_ditolak_terminal(conn, deps):
    uid, sid, pid = _setup(conn)
    conn.execute("delete from transcripts where source_id = %s", (sid,))
    conn.commit()
    with pytest.raises(JobError) as e:
        handle_analyze(conn, _job(conn, sid, pid, uid), **deps)
    assert e.value.terminal is True


def test_keluaran_llm_cacat_tidak_menulis_apa_pun(conn, deps):
    uid, sid, pid = _setup(conn)
    deps["call"] = lambda key, prompt: "maaf saya tidak bisa"
    with pytest.raises(JobError) as e:
        handle_analyze(conn, _job(conn, sid, pid, uid), **deps)
    assert e.value.code == "LLM_BAD_OUTPUT"
    assert (
        conn.execute(
            "select count(*) from clip_candidates where project_id = %s", (pid,)
        ).fetchone()[0]
        == 0
    )
    assert conn.execute("select count(*) from llm_runs where source_id = %s", (sid,)).fetchone()[
        0
    ] == 0


def test_key_byok_tidak_valid_gagal_terminal(conn, deps, monkeypatch):
    uid, sid, pid = _setup(conn)

    def no_key(conn_, uid_, provider=None):
        raise JobError("BYOK_INVALID", "user belum menyimpan API key", terminal=True)

    monkeypatch.setattr("app.handlers.analyze.load_api_key", no_key)
    with pytest.raises(JobError) as e:
        handle_analyze(conn, _job(conn, sid, pid, uid), **deps)
    assert e.value.code == "BYOK_INVALID"
    assert e.value.terminal is True


def test_menjalankan_ulang_pada_proyek_sama_tidak_menggandakan_kandidat(conn, deps):
    """Job dapat dicoba ulang setelah kegagalan sementara. Tanpa penjagaan,
    percobaan kedua menambah sepuluh kandidat lagi ke proyek yang sama."""
    uid, sid, pid = _setup(conn)
    job = _job(conn, sid, pid, uid)
    handle_analyze(conn, job, **deps)
    handle_analyze(conn, job, **deps)

    n = conn.execute(
        "select count(*) from clip_candidates where project_id = %s", (pid,)
    ).fetchone()[0]
    assert n == 2


def test_analyze_enqueues_thumbnail_job(conn, deps):
    uid, sid, pid = _setup(conn, external_id="analysis-thumb-job")
    handle_analyze(conn, _job(conn, sid, pid, uid), **deps)

    row = conn.execute(
        "select type, payload, user_id, project_id from jobs "
        "where type = 'prepare_thumbnails' and project_id = %s",
        (pid,),
    ).fetchone()
    assert row[0] == "prepare_thumbnails"
    assert row[1]["source_id"] == sid
    assert row[1]["project_id"] == pid
    assert str(row[2]) == uid
    assert str(row[3]) == pid


def test_analyze_retry_keeps_one_active_thumbnail_job(conn, deps):
    uid, sid, pid = _setup(conn, external_id="analysis-thumb-retry")
    job = _job(conn, sid, pid, uid)
    handle_analyze(conn, job, **deps)
    handle_analyze(conn, job, **deps)

    count = conn.execute(
        "select count(*) from jobs where type='prepare_thumbnails' "
        "and project_id=%s and status in ('queued','running')",
        (pid,),
    ).fetchone()[0]
    assert count == 1


def test_analyze_enqueues_render_previews_job(conn, deps):
    uid, sid, pid = _setup(conn, external_id="analysis-render-job")
    handle_analyze(conn, _job(conn, sid, pid, uid), **deps)

    row = conn.execute(
        "select type, payload, user_id, project_id from jobs "
        "where type = 'render_previews' and project_id = %s",
        (pid,),
    ).fetchone()
    assert row[0] == "render_previews"
    assert row[1]["project_id"] == pid
    assert str(row[2]) == uid
    assert str(row[3]) == pid


def test_analyze_retry_keeps_one_active_render_previews_job(conn, deps):
    uid, sid, pid = _setup(conn, external_id="analysis-render-retry")
    job = _job(conn, sid, pid, uid)
    handle_analyze(conn, job, **deps)
    handle_analyze(conn, job, **deps)

    count = conn.execute(
        "select count(*) from jobs where type='render_previews' "
        "and project_id=%s and status in ('queued','running')",
        (pid,),
    ).fetchone()[0]
    assert count == 1


def test_reanalysis_deletes_replaced_thumbnail_object(conn, deps):
    uid, sid, pid = _setup(conn, external_id="analysis-thumb-cleanup")
    handle_analyze(conn, _job(conn, sid, pid, uid), **deps)
    conn.execute(
        "update clip_candidates set thumbnail_status='ready', "
        "thumbnail_r2_key='candidate-thumbnails/old.webp' where project_id=%s",
        (pid,),
    )
    conn.commit()

    handle_analyze(conn, _job(conn, sid, pid, uid), **deps)

    deps["storage"].delete.assert_called_with("candidate-thumbnails/old.webp")
