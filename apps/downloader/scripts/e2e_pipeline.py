"""Verifikasi integrasi P1: URL nyata sampai kandidat klip.

Menjalankan loop worker sungguhan atas antrian sungguhan. Yang dipalsukan
hanya dua panggilan berbayar — transkripsi dan LLM — karena keduanya butuh
API key. Sisanya nyata: yt-dlp, ffmpeg, R2/MinIO, seluruh rantai job, dan
setiap lapis cache.

Yang dibuktikan skrip ini dan tidak dibuktikan tes unit mana pun: handler
benar-benar saling merantai. Tes unit memanggil tiap handler langsung dengan
dependensi suntikan, jadi rantai antar-tahap tidak pernah diuji di sana.

Pakai:
    R2_ENDPOINT=... uv run python -m scripts.e2e_pipeline
"""

from __future__ import annotations

import base64
import functools
import os
import sys
import time
from pathlib import Path

import psycopg
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.crypto import ApiKeyRecord
from app.handlers.analyze import handle_analyze
from app.handlers.ingest import handle_ingest
from app.handlers.transcribe import handle_transcribe
from app.providers.transcription import TranscriptResult, Word
from app.queue import enqueue
from app.storage import storage_from_env
from app.worker import run_once

REPO_ROOT = Path(__file__).resolve().parents[3]
DB_PKG = REPO_ROOT / "packages" / "db"
ADMIN_URL = os.environ.get(
    "E2E_ADMIN_DATABASE_URL",
    "postgresql://postgres:postgres@localhost:55432/postgres",
)
E2E_URL = os.environ.get(
    "E2E_DATABASE_URL",
    "postgresql://postgres:postgres@localhost:55432/cc_e2e_pipeline",
)

URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
EXTERNAL_ID = "dQw4w9WgXcQ"

# Transkrip palsu yang cukup panjang untuk menampung kandidat 30-90 detik.
_WORDS = [Word(f"kata{i}", float(i) * 0.5, float(i) * 0.5 + 0.4) for i in range(400)]

FAKE_TRANSCRIPT = TranscriptResult(
    language="id",
    text=" ".join(w.text for w in _WORDS),
    words=_WORDS,
    provider="palsu",
    model="whisper-large-v3-turbo",
    cost_usd=0.012,
)

FAKE_LLM_OUTPUT = """```json
{"candidates":[
  {"start_sec":10,"end_sec":80,"score":0.93,"title":"Momen pertama",
   "hook_text":"Ini yang bikin semua orang salah paham","reason":"Opini tajam"},
  {"start_sec":100,"end_sec":175,"score":0.71,"title":"Momen kedua",
   "hook_text":"Ternyata caranya sesederhana ini","reason":"Langsung bisa dipakai"}
]}
```"""


def reset_db() -> None:
    with psycopg.connect(ADMIN_URL, autocommit=True) as c:
        c.execute("drop database if exists cc_e2e_pipeline with (force)")
        c.execute("create database cc_e2e_pipeline")
    with psycopg.connect(E2E_URL, autocommit=True) as c:
        c.execute((DB_PKG / "sql" / "000_auth_shim.sql").read_text(encoding="utf-8"))
        c.execute((DB_PKG / "migrations" / "0000_init.sql").read_text(encoding="utf-8"))


def build_handlers(llm_calls: list, transcribe_calls: list) -> dict:
    def fake_transcribe(audio, duration_sec):
        transcribe_calls.append(audio.name)
        return FAKE_TRANSCRIPT

    def fake_llm(key: ApiKeyRecord, prompt: str) -> str:
        llm_calls.append(len(prompt))
        return FAKE_LLM_OUTPUT

    return {
        "ingest": handle_ingest,
        "transcribe": functools.partial(handle_transcribe, transcribe_fn=fake_transcribe),
        "analyze": functools.partial(handle_analyze, call=fake_llm),
    }


def drain(conn, handlers, limit: int = 20) -> int:
    n = 0
    while n < limit and run_once(conn, "e2e", handlers):
        n += 1
    return n


def seal(plaintext: str, master_b64: str) -> tuple[str, str, str]:
    """Menyegel dengan format yang sama seperti packages/db/src/crypto.ts.

    Node menyimpan tag GCM terpisah, sedangkan AESGCM Python menggabungkannya
    di akhir ciphertext, jadi di sini tag dipotong kembali.
    """
    aes = AESGCM(base64.b64decode(master_b64))
    iv = os.urandom(12)
    blob = aes.encrypt(iv, plaintext.encode("utf-8"), None)
    ct, tag = blob[:-16], blob[-16:]
    return (
        base64.b64encode(ct).decode(),
        base64.b64encode(iv).decode(),
        base64.b64encode(tag).decode(),
    )


def seed_user(conn, email: str) -> str:
    uid = conn.execute(
        "insert into auth.users (email) values (%s) returning id", (email,)
    ).fetchone()[0]
    conn.execute("insert into profiles (user_id) values (%s)", (uid,))
    enc, iv, tag = seal("sk-e2e-rahasia", os.environ["BYOK_MASTER_KEY"])
    conn.execute(
        """insert into api_keys (user_id, provider, label, base_url, model,
                                 encrypted_key, key_iv, key_tag)
           values (%s, 'openai_compat', 'sumopod', 'https://ai.sumopod.com/v1',
                   'MiniMax-M2.7-highspeed', %s, %s, %s)""",
        (uid, enc, iv, tag),
    )
    conn.commit()
    return str(uid)


def start_project(conn, uid: str, external_id: str = EXTERNAL_ID) -> tuple[str, str]:
    sid = conn.execute(
        """insert into sources (kind, external_id, is_public, owner_user_id,
                                url_original, status)
           values ('youtube', %s, false, %s, %s, 'pending') returning id""",
        (external_id, uid, URL),
    ).fetchone()[0]
    pid = conn.execute(
        "insert into projects (user_id, source_id, title) values (%s, %s, %s) returning id",
        (uid, sid, URL),
    ).fetchone()[0]
    conn.commit()
    enqueue(
        conn,
        "ingest",
        {"source_id": str(sid), "project_id": str(pid)},
        user_id=uid,
        project_id=str(pid),
    )
    return str(sid), str(pid)


def main() -> int:
    # Master key khusus jalannya skrip ini; tidak pernah menyentuh disk.
    os.environ.setdefault("BYOK_MASTER_KEY", base64.b64encode(os.urandom(32)).decode())
    reset_db()
    storage_from_env().ensure_bucket()

    llm_calls: list = []
    transcribe_calls: list = []
    handlers = build_handlers(llm_calls, transcribe_calls)
    ok = True

    with psycopg.connect(E2E_URL) as conn:
        # --- user pertama: seluruh pipeline dari nol -----------------------
        print("=== user pertama ===")
        uid = seed_user(conn, "satu@test.id")
        _, pid = start_project(conn, uid)

        t0 = time.monotonic()
        processed = drain(conn, handlers)
        elapsed = time.monotonic() - t0

        types = conn.execute(
            "select type, status from jobs order by created_at"
        ).fetchall()
        print(f"job diproses : {processed} dalam {elapsed:.1f}s")
        for t, s in types:
            print(f"  {t:<16} {s}")

        cands = conn.execute(
            "select title, start_sec, end_sec, score, hook_text from clip_candidates "
            "where project_id = %s order by score desc",
            (pid,),
        ).fetchall()
        print(f"kandidat     : {len(cands)}")
        for c in cands:
            print(f"  [{float(c[3]):.2f}] {c[1]}-{c[2]}s  {c[0]!r}  hook={c[4]!r}")

        if [t for t, _ in types] != ["ingest", "transcribe", "analyze"]:
            print("GAGAL: rantai job tidak lengkap")
            ok = False
        if any(s != "done" for _, s in types):
            print("GAGAL: ada job yang tidak selesai")
            ok = False
        if len(cands) != 2:
            print("GAGAL: jumlah kandidat tidak sesuai")
            ok = False
        if len(transcribe_calls) != 1 or len(llm_calls) != 1:
            print("GAGAL: jumlah panggilan berbayar tidak sesuai")
            ok = False

        # --- user kedua: tiap lapis cache harus kena ----------------------
        print("\n=== user kedua, URL sama ===")
        uid2 = seed_user(conn, "dua@test.id")
        _, pid2 = start_project(conn, uid2)

        t0 = time.monotonic()
        processed2 = drain(conn, handlers)
        elapsed2 = time.monotonic() - t0

        cands2 = conn.execute(
            "select count(*) from clip_candidates where project_id = %s", (pid2,)
        ).fetchone()[0]
        sources = conn.execute("select count(*) from sources").fetchone()[0]
        transcripts = conn.execute("select count(*) from transcripts").fetchone()[0]
        runs = conn.execute("select count(*) from llm_runs").fetchone()[0]

        print(f"job diproses : {processed2} dalam {elapsed2:.2f}s")
        print(f"kandidat     : {cands2}")
        print(f"sources={sources} transcripts={transcripts} llm_runs={runs}")
        print(f"panggilan transkripsi total : {len(transcribe_calls)}")
        print(f"panggilan LLM total         : {len(llm_calls)}")

        if cands2 != 2:
            print("GAGAL: user kedua tidak mendapat kandidat")
            ok = False
        if len(transcribe_calls) != 1:
            print("GAGAL: transkripsi dipanggil ulang, cache meleset")
            ok = False
        if len(llm_calls) != 1:
            print("GAGAL: LLM dipanggil ulang, cache meleset")
            ok = False
        if sources != 1 or transcripts != 1 or runs != 1:
            print("GAGAL: dedup sumber/transkrip/analisis tidak bekerja")
            ok = False
        if elapsed2 > 5:
            print("PERINGATAN: jalur cache lebih lambat dari perkiraan")

        print("\nHASIL:", "LULUS" if ok else "GAGAL")
        return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
