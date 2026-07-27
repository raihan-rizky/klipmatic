import base64
import json
from pathlib import Path

import psycopg
import pytest
from cryptography.exceptions import InvalidTag

from app.crypto import ApiKeyRecord, load_api_key, open_api_key
from app.errors import JobError
from tests.conftest import new_conn

FIXTURE = json.loads(
    (Path(__file__).parent / "fixtures" / "sealed_keys.json").read_text(encoding="utf-8")
)
MASTER = FIXTURE["masterKey"]
CASES = {c["name"]: c for c in FIXTURE["cases"]}


def _seed_user(conn: psycopg.Connection, email: str) -> str:
    uid = conn.execute(
        "insert into auth.users (email) values (%s) returning id", (email,)
    ).fetchone()[0]
    conn.execute("insert into profiles (user_id) values (%s)", (uid,))
    return str(uid)


def _seed_key(
    conn: psycopg.Connection,
    uid: str,
    case_name: str,
    *,
    provider: str = "gemini",
    model: str = "gemini-2.5-flash",
    created_at: str = "now()",
    last_used_at: str = "null",
    tamper_tag: bool = False,
) -> str:
    s = CASES[case_name]["sealed"]
    tag = s["keyTag"]
    if tamper_tag:
        raw = bytearray(base64.b64decode(tag))
        raw[0] ^= 0xFF
        tag = base64.b64encode(raw).decode()
    return str(
        conn.execute(
            f"""
            insert into api_keys (user_id, provider, label, base_url, model,
                                  encrypted_key, key_iv, key_tag,
                                  created_at, last_used_at)
            values (%s, %s, 'utama', null, %s, %s, %s, %s,
                    {created_at}, {last_used_at})
            returning id
            """,
            (uid, provider, model, s["encryptedKey"], s["keyIv"], tag),
        ).fetchone()[0]
    )


@pytest.mark.parametrize("case", FIXTURE["cases"], ids=lambda c: c["name"])
def test_python_dapat_membuka_segel_typescript(case):
    s = case["sealed"]
    assert open_api_key(s["encryptedKey"], s["keyIv"], s["keyTag"], MASTER) == case["plaintext"]


def test_tag_yang_diubah_ditolak():
    s = CASES["ascii"]["sealed"]
    tag = bytearray(base64.b64decode(s["keyTag"]))
    tag[0] ^= 0xFF
    # InvalidTag secara spesifik: yang harus gagal adalah otentikasi GCM,
    # bukan sekadar "ada exception" yang juga dipenuhi TypeError.
    with pytest.raises(InvalidTag):
        open_api_key(s["encryptedKey"], s["keyIv"], base64.b64encode(tag).decode(), MASTER)


def test_master_key_salah_ditolak():
    s = CASES["ascii"]["sealed"]
    wrong = base64.b64encode(b"0" * 32).decode()
    with pytest.raises(InvalidTag):
        open_api_key(s["encryptedKey"], s["keyIv"], s["keyTag"], wrong)


def test_master_key_panjang_salah_ditolak():
    s = CASES["ascii"]["sealed"]
    short = base64.b64encode(b"0" * 16).decode()
    with pytest.raises(ValueError, match="BYOK_MASTER_KEY"):
        open_api_key(s["encryptedKey"], s["keyIv"], s["keyTag"], short)


def test_repr_record_tidak_membocorkan_secret():
    rec = ApiKeyRecord(
        id="1", provider="gemini", base_url=None, model="m", secret="sk-proj-SANGAT-RAHASIA"
    )
    for rendered in (repr(rec), str(rec), f"{rec}"):
        assert "sk-proj-SANGAT-RAHASIA" not in rendered
    assert "gemini" in repr(rec)
    assert rec.secret == "sk-proj-SANGAT-RAHASIA"


def test_load_api_key_mengembalikan_kredensial_user(conn, monkeypatch):
    monkeypatch.setenv("BYOK_MASTER_KEY", MASTER)
    uid = _seed_user(conn, "k@test.id")
    _seed_key(conn, uid, "ascii")
    conn.commit()

    rec = load_api_key(conn, uid)
    assert rec.provider == "gemini"
    assert rec.model == "gemini-2.5-flash"
    assert rec.secret == CASES["ascii"]["plaintext"]


def test_load_api_key_tidak_membocorkan_key_user_lain(conn, monkeypatch):
    """Isolasi antar user: properti paling kritis dari BYOK."""
    monkeypatch.setenv("BYOK_MASTER_KEY", MASTER)
    uid_a = _seed_user(conn, "a@test.id")
    uid_b = _seed_user(conn, "b@test.id")
    # A lebih tua supaya query tanpa filter user_id cenderung memilih B.
    _seed_key(conn, uid_a, "ascii", created_at="now() - interval '1 day'")
    _seed_key(conn, uid_b, "unicode", model="gemini-2.5-pro")
    conn.commit()

    rec_a = load_api_key(conn, uid_a)
    assert rec_a.secret == CASES["ascii"]["plaintext"]
    assert rec_a.model == "gemini-2.5-flash"

    rec_b = load_api_key(conn, uid_b)
    assert rec_b.secret == CASES["unicode"]["plaintext"]
    assert rec_b.model == "gemini-2.5-pro"
    assert rec_a.id != rec_b.id


def test_load_api_key_menyaring_berdasarkan_provider(conn, monkeypatch):
    monkeypatch.setenv("BYOK_MASTER_KEY", MASTER)
    uid = _seed_user(conn, "dua@test.id")
    # Baris gemini sengaja dibuat menang urutan (last_used_at terisi) sehingga
    # implementasi tanpa filter provider pasti mengembalikan gemini.
    _seed_key(conn, uid, "ascii", last_used_at="now()")
    _seed_key(conn, uid, "unicode", provider="openai_compat", model="gpt-4o-mini")
    conn.commit()

    rec = load_api_key(conn, uid, provider="openai_compat")
    assert rec.provider == "openai_compat"
    assert rec.model == "gpt-4o-mini"
    assert rec.secret == CASES["unicode"]["plaintext"]


def test_load_api_key_memilih_key_yang_terakhir_dipakai(conn, monkeypatch):
    """Urutan `last_used_at desc nulls last, created_at desc` menentukan pemenang."""
    monkeypatch.setenv("BYOK_MASTER_KEY", MASTER)
    uid = _seed_user(conn, "banyak@test.id")
    lama = _seed_key(conn, uid, "ascii", created_at="now() - interval '2 days'")
    baru = _seed_key(conn, uid, "unicode", created_at="now()", model="gemini-2.5-pro")
    dipakai = _seed_key(
        conn,
        uid,
        "panjang",
        created_at="now() - interval '3 days'",
        last_used_at="now() - interval '1 hour'",
        model="gemini-1.5-flash",
    )
    conn.commit()

    # last_used_at mengalahkan created_at, jadi baris tertua pun menang.
    rec = load_api_key(conn, uid)
    assert rec.id == dipakai
    assert rec.secret == CASES["panjang"]["plaintext"]

    # Setelah baris lain ditandai lebih baru, giliran baris itu yang menang.
    conn.execute(
        "update api_keys set last_used_at = now() + interval '1 hour' where id = %s", (baru,)
    )
    conn.commit()
    rec = load_api_key(conn, uid)
    assert rec.id == baru
    assert rec.secret == CASES["unicode"]["plaintext"]

    # Tanpa riwayat pemakaian sama sekali, created_at terbaru yang menang.
    conn.execute("update api_keys set last_used_at = null where user_id = %s", (uid,))
    conn.execute(
        "update api_keys set created_at = now() + interval '1 day' where id = %s", (lama,)
    )
    conn.commit()
    rec = load_api_key(conn, uid)
    assert rec.id == lama
    assert rec.secret == CASES["ascii"]["plaintext"]


def test_load_api_key_mencatat_last_used_at(conn, monkeypatch):
    monkeypatch.setenv("BYOK_MASTER_KEY", MASTER)
    uid = _seed_user(conn, "pakai@test.id")
    kid = _seed_key(conn, uid, "ascii")
    conn.commit()

    load_api_key(conn, uid)

    # Dibaca dari koneksi lain: menuntut update-nya benar-benar di-commit.
    with new_conn() as other:
        row = other.execute(
            "select last_used_at from api_keys where id = %s", (kid,)
        ).fetchone()
    assert row[0] is not None


def test_load_api_key_gagal_BYOK_INVALID_bila_user_belum_punya_key(conn, monkeypatch):
    monkeypatch.setenv("BYOK_MASTER_KEY", MASTER)
    uid = _seed_user(conn, "nokey@test.id")
    conn.commit()

    with pytest.raises(JobError) as e:
        load_api_key(conn, uid)
    assert e.value.code == "BYOK_INVALID"
    assert e.value.terminal is True


@pytest.mark.parametrize("bad", ["", "bukan-uuid", "None", "123"])
def test_load_api_key_menolak_user_id_bukan_uuid(conn, monkeypatch, bad):
    """jobs.user_id nullable, jadi handler bisa mengirim string kosong ke sini."""
    monkeypatch.setenv("BYOK_MASTER_KEY", MASTER)

    with pytest.raises(JobError) as e:
        load_api_key(conn, bad)
    assert e.value.code == "BYOK_INVALID"
    assert e.value.terminal is True

    # Transaksi tidak boleh ikut gugur: worker masih harus bisa menandai job
    # gagal lewat koneksi yang sama.
    assert conn.execute("select 1").fetchone()[0] == 1


def test_load_api_key_INTERNAL_bila_master_key_tidak_diset(conn, monkeypatch):
    monkeypatch.delenv("BYOK_MASTER_KEY", raising=False)
    uid = _seed_user(conn, "nomaster@test.id")
    _seed_key(conn, uid, "ascii")
    conn.commit()

    with pytest.raises(JobError) as e:
        load_api_key(conn, uid)
    assert e.value.code == "INTERNAL"
    # Pesannya harus menunjuk konfigurasi yang hilang, bukan kegagalan segel:
    # keduanya sama-sama INTERNAL non-terminal sehingga kode saja tak cukup.
    assert "BYOK_MASTER_KEY" in str(e.value)
    # Bukan terminal: master key yang hilang adalah salah konfigurasi server,
    # job berhak dicoba lagi setelah diperbaiki.
    assert e.value.terminal is False


def test_load_api_key_INTERNAL_bila_segel_rusak_tanpa_membocorkan_material(conn, monkeypatch):
    monkeypatch.setenv("BYOK_MASTER_KEY", MASTER)
    uid = _seed_user(conn, "rusak@test.id")
    _seed_key(conn, uid, "ascii", tamper_tag=True)
    conn.commit()

    with pytest.raises(JobError) as e:
        load_api_key(conn, uid)
    assert e.value.code == "INTERNAL"
    assert e.value.terminal is False
    assert "InvalidTag" in str(e.value)

    pesan = str(e.value)
    assert MASTER not in pesan
    assert CASES["ascii"]["plaintext"] not in pesan
    assert CASES["ascii"]["sealed"]["encryptedKey"] not in pesan
    # `from None` memutus rantai sebab supaya traceback asli (yang memuat
    # ciphertext dan kunci) tidak ikut tercetak di log worker.
    assert e.value.__cause__ is None
    assert e.value.__suppress_context__ is True
