"""Verifikasi integrasi P0: URL nyata -> yt-dlp -> ffmpeg -> MinIO.

Tidak menyentuh Supabase; yang membutuhkan Supabase hanya lapisan auth.
Dijalankan manual, bukan bagian dari CI.
"""

import os
import sys
from pathlib import Path

import psycopg

DOWNLOADER_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = DOWNLOADER_ROOT.parents[1]
sys.path.insert(0, str(DOWNLOADER_ROOT))

from app.handlers.ingest import handle_ingest  # noqa: E402
from app.queue import claim_job, enqueue  # noqa: E402
from app.storage import storage_from_env  # noqa: E402
from app.worker import run_once  # noqa: E402

DB_PKG = REPO_ROOT / "packages" / "db"
ADMIN_URL = os.environ.get(
    "E2E_ADMIN_DATABASE_URL",
    "postgresql://postgres:postgres@localhost:55432/postgres",
)
E2E_URL = os.environ.get(
    "E2E_DATABASE_URL",
    "postgresql://postgres:postgres@localhost:55432/cc_e2e",
)

URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
EXTERNAL_ID = "dQw4w9WgXcQ"


def reset_db() -> None:
    with psycopg.connect(ADMIN_URL, autocommit=True) as c:
        c.execute("drop database if exists cc_e2e with (force)")
        c.execute("create database cc_e2e")
    with psycopg.connect(E2E_URL, autocommit=True) as c:
        c.execute((DB_PKG / "sql" / "000_auth_shim.sql").read_text(encoding="utf-8"))
        c.execute((DB_PKG / "migrations" / "0000_init.sql").read_text(encoding="utf-8"))


def main() -> int:
    reset_db()
    storage = storage_from_env()
    storage.ensure_bucket()

    with psycopg.connect(E2E_URL) as conn:
        uid = conn.execute(
            "insert into auth.users (email) values ('e2e@test.id') returning id"
        ).fetchone()[0]
        conn.execute("insert into profiles (user_id) values (%s)", (uid,))
        sid = conn.execute(
            """
            insert into sources (kind, external_id, is_public, owner_user_id,
                                 url_original, status)
            values ('youtube', %s, false, %s, %s, 'pending') returning id
            """,
            (EXTERNAL_ID, uid, URL),
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
            user_id=str(uid),
            project_id=str(pid),
        )

        print("menjalankan worker...")
        assert run_once(conn, "e2e-worker", {"ingest": handle_ingest}) is True

        job = conn.execute(
            "select status, progress, error_code, error_msg from jobs limit 1"
        ).fetchone()
        print(f"job   : status={job[0]} progress={job[1]} error={job[2]} {job[3] or ''}")

        src = conn.execute(
            "select status, title, duration_sec, audio_r2_key, audio_sha256, is_public "
            "from sources where id = %s",
            (sid,),
        ).fetchone()
        print(f"source: status={src[0]} title={src[1]!r}")
        print(f"        durasi={src[2]}s public={src[5]}")
        print(f"        r2_key={src[3]}")

        ok = True
        if job[0] != "done":
            print("GAGAL: job tidak selesai")
            ok = False
        if src[0] != "ready":
            print("GAGAL: source tidak ready")
            ok = False
        if not src[3] or not storage.exists(src[3]):
            print("GAGAL: objek audio tidak ada di R2/MinIO")
            ok = False
        if src[5] is not True:
            print("GAGAL: source publik tidak dipromosikan")
            ok = False

        if ok:
            print("\n--- cek dedup: user kedua, URL sama ---")
            uid2 = conn.execute(
                "insert into auth.users (email) values ('e2e2@test.id') returning id"
            ).fetchone()[0]
            conn.execute("insert into profiles (user_id) values (%s)", (uid2,))
            sid2 = conn.execute(
                """
                insert into sources (kind, external_id, is_public, owner_user_id,
                                     url_original, status)
                values ('youtube', %s, false, %s, %s, 'pending') returning id
                """,
                (EXTERNAL_ID, uid2, URL),
            ).fetchone()[0]
            pid2 = conn.execute(
                "insert into projects (user_id, source_id, title) values (%s, %s, %s) returning id",
                (uid2, sid2, URL),
            ).fetchone()[0]
            conn.commit()
            enqueue(
                conn,
                "ingest",
                {"source_id": str(sid2), "project_id": str(pid2)},
                user_id=str(uid2),
                project_id=str(pid2),
            )

            import time

            t0 = time.monotonic()
            run_once(conn, "e2e-worker", {"ingest": handle_ingest})
            elapsed = time.monotonic() - t0

            repointed = conn.execute(
                "select source_id from projects where id = %s", (pid2,)
            ).fetchone()[0]
            dropped = conn.execute(
                "select count(*) from sources where id = %s", (sid2,)
            ).fetchone()[0]
            print(f"waktu   : {elapsed:.2f}s")
            print(f"dialihkan ke source pertama: {str(repointed) == str(sid)}")
            print(f"baris duplikat dihapus     : {dropped == 0}")
            if str(repointed) != str(sid) or dropped != 0:
                print("GAGAL: dedup tidak bekerja")
                ok = False
            elif elapsed > 5:
                print("PERINGATAN: cache hit lebih lambat dari perkiraan")

        print("\nHASIL:", "LULUS" if ok else "GAGAL")
        return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
