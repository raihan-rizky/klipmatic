from __future__ import annotations

import base64
import os
import uuid
from dataclasses import dataclass, field

import psycopg
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.errors import JobError

_SELECT = """
select id, provider, base_url, model, encrypted_key, key_iv, key_tag
  from api_keys
 where user_id = %s
"""

_ORDER = """
 order by last_used_at desc nulls last, created_at desc
 limit 1
"""


@dataclass(frozen=True)
class ApiKeyRecord:
    id: str
    provider: str
    base_url: str | None
    model: str
    # repr=False supaya plaintext tidak ikut terbawa saat record ini masuk ke
    # log, pesan exception, atau dump lokal pytest. Satu-satunya jalan keluar
    # kunci adalah membaca .secret secara sengaja.
    secret: str = field(repr=False)


def open_api_key(encrypted_key: str, key_iv: str, key_tag: str, master_key_b64: str) -> str:
    """Membuka segel yang dibuat packages/db/src/crypto.ts.

    Node menyimpan tag GCM terpisah; AESGCM Python mengharapkannya
    tergabung di akhir ciphertext, jadi keduanya disambung di sini.
    """
    master = base64.b64decode(master_key_b64)
    if len(master) != 32:
        raise ValueError("BYOK_MASTER_KEY harus 32 byte dalam base64")
    aes = AESGCM(master)
    ciphertext = base64.b64decode(encrypted_key) + base64.b64decode(key_tag)
    return aes.decrypt(base64.b64decode(key_iv), ciphertext, None).decode("utf-8")


def _normalize_user_id(user_id: str) -> str:
    """Menolak user_id yang bukan UUID sebelum menyentuh database.

    jobs.user_id nullable, jadi handler bisa mengirim string kosong. Bila nilai
    itu sampai ke query, psycopg melempar DataError yang membatalkan transaksi;
    koneksi yang sama lalu tidak bisa dipakai fail_job dan worker ikut mati.
    """
    try:
        return str(uuid.UUID(str(user_id)))
    except (ValueError, AttributeError, TypeError):
        raise JobError(
            "BYOK_INVALID", "job tidak terhubung ke user yang sah", terminal=True
        ) from None


def load_api_key(
    conn: psycopg.Connection, user_id: str, provider: str | None = None
) -> ApiKeyRecord:
    """Mengambil dan mendekripsi kredensial BYOK milik user.

    Nilai plaintext hanya hidup di memori proses ini. Ia tidak pernah ditulis
    ke database, log, maupun pesan exception.
    """
    user_id = _normalize_user_id(user_id)

    if provider:
        row = conn.execute(
            _SELECT + " and provider = %s" + _ORDER, (user_id, provider)
        ).fetchone()
    else:
        row = conn.execute(_SELECT + _ORDER, (user_id,)).fetchone()

    if row is None:
        raise JobError("BYOK_INVALID", "user belum menyimpan API key", terminal=True)

    master = os.environ.get("BYOK_MASTER_KEY")
    if not master:
        raise JobError("INTERNAL", "BYOK_MASTER_KEY tidak diset", terminal=False)

    try:
        secret = open_api_key(row[4], row[5], row[6], master)
    except Exception as e:  # noqa: BLE001
        # Hanya nama kelas exception yang dibawa, dan `from None` memutus
        # rantai sebab: traceback aslinya bisa memuat ciphertext atau kunci.
        raise JobError(
            "INTERNAL", f"gagal membuka segel kredensial: {type(e).__name__}"
        ) from None

    conn.execute("update api_keys set last_used_at = now() where id = %s", (row[0],))
    conn.commit()

    return ApiKeyRecord(
        id=str(row[0]), provider=row[1], base_url=row[2], model=row[3], secret=secret
    )
