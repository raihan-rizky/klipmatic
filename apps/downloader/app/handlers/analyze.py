from __future__ import annotations

import hashlib
import json
from typing import Any, Callable

import psycopg

from app.crypto import ApiKeyRecord, load_api_key
from app.errors import JobError
from app.prompts.highlights_v1 import (
    PROMPT_VERSION,
    Candidate,
    build_prompt,
    parse_candidates,
    slice_transcript,
)
from app.providers.llm import call_llm as _call_llm
from app.providers.transcription import Word
from app.queue import Job, heartbeat
from app.storage import Storage, storage_from_env


def compute_input_hash(transcript_id: str, prompt_version: str, model: str) -> str:
    """Kunci cache analisis (spec §7 langkah 3).

    Transkrip, versi prompt, dan model yang sama selalu menghasilkan kunci
    yang sama, sehingga user kedua pada video publik yang sama tidak membayar
    apa pun ke provider LLM miliknya.
    """
    return hashlib.sha256(
        "|".join([transcript_id, prompt_version, model]).encode("utf-8")
    ).hexdigest()


def _write_candidates(
    conn: psycopg.Connection,
    project_id: str,
    llm_run_id: str,
    candidates: list[Candidate],
    words: list[Word],
) -> None:
    # Job dapat dicoba ulang setelah kegagalan sementara. Tanpa pembersihan
    # ini, percobaan kedua menambahkan satu set kandidat lagi ke proyek yang
    # sama alih-alih menggantikannya.
    conn.execute("delete from clip_candidates where project_id = %s", (project_id,))
    for c in candidates:
        conn.execute(
            """
            insert into clip_candidates (project_id, llm_run_id, start_sec, end_sec,
                                         score, title, hook_text, reason, transcript_slice)
            values (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                project_id,
                llm_run_id,
                c.start_sec,
                c.end_sec,
                c.score,
                c.title,
                c.hook_text,
                c.reason,
                slice_transcript(words, c.start_sec, c.end_sec),
            ),
        )
    conn.commit()


def _candidates_from_output(output: dict[str, Any], duration_sec: int) -> list[Candidate]:
    return parse_candidates(json.dumps(output), duration_sec)


def handle_analyze(
    conn: psycopg.Connection,
    job: Job,
    *,
    storage: Storage | None = None,
    call: Callable[..., str] = _call_llm,
) -> None:
    storage = storage or storage_from_env()
    source_id: str = job.payload["source_id"]
    project_id: str = job.payload["project_id"]

    src = conn.execute("select duration_sec from sources where id = %s", (source_id,)).fetchone()
    if src is None:
        raise JobError("INTERNAL", f"source {source_id} tidak ditemukan", terminal=True)
    duration_sec = int(src[0] or 0)

    tr = conn.execute(
        "select id, r2_key from transcripts where source_id = %s limit 1", (source_id,)
    ).fetchone()
    if tr is None:
        raise JobError("INTERNAL", "transkrip belum tersedia", terminal=True)
    transcript_id, transcript_key = str(tr[0]), tr[1]

    heartbeat(conn, job.id, 10)
    body = json.loads(storage.get_bytes(transcript_key).decode("utf-8"))
    words = [Word(w["text"], float(w["start"]), float(w["end"])) for w in body["words"]]

    key: ApiKeyRecord = load_api_key(conn, job.user_id or "")
    input_hash = compute_input_hash(transcript_id, PROMPT_VERSION, key.model)

    # Cache lapis LLM (spec §8). Cakupannya mengikuti sumber, sehingga hasil
    # pada sumber publik dapat dipakai bersama tanpa membocorkan sumber privat.
    cached = conn.execute(
        "select id, output from llm_runs where input_hash = %s", (input_hash,)
    ).fetchone()
    if cached:
        heartbeat(conn, job.id, 90)
        _write_candidates(
            conn,
            project_id,
            str(cached[0]),
            _candidates_from_output(cached[1], duration_sec),
            words,
        )
        return

    heartbeat(conn, job.id, 30)
    raw = call(key, build_prompt(words, duration_sec))

    heartbeat(conn, job.id, 70)
    candidates = parse_candidates(raw, duration_sec)  # melempar LLM_BAD_OUTPUT

    output = {
        "candidates": [
            {
                "start_sec": c.start_sec,
                "end_sec": c.end_sec,
                "score": c.score,
                "title": c.title,
                "hook_text": c.hook_text,
                "reason": c.reason,
            }
            for c in candidates
        ]
    }
    run = conn.execute(
        """
        insert into llm_runs (source_id, provider, model, prompt_version, input_hash, output)
        values (%s, %s, %s, %s, %s, %s::jsonb)
        on conflict (input_hash) do update set updated_at = now()
        returning id
        """,
        (source_id, key.provider, key.model, PROMPT_VERSION, input_hash, json.dumps(output)),
    ).fetchone()
    conn.commit()

    _write_candidates(conn, project_id, str(run[0]), candidates, words)
