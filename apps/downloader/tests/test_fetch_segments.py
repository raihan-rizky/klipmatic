from __future__ import annotations

import subprocess
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from unittest.mock import MagicMock

import pytest

import app.ytdlp as ytdlp
from app.errors import JobError
from app.handlers.fetch_segments import SEGMENT_TTL_DAYS, handle_fetch_segments
from app.queue import Job, enqueue


def _source(conn) -> str:
    sid = conn.execute(
        """
        insert into sources (kind, external_id, is_public, url_original, status, duration_sec)
        values ('youtube', 'segmen0001', true, 'https://youtu.be/x', 'ready', 600)
        returning id"""
    ).fetchone()[0]
    conn.commit()
    return str(sid)


def _private_source(conn, owner_user_id: str) -> str:
    sid = conn.execute(
        """
        insert into sources
               (kind, external_id, is_public, owner_user_id, url_original, status, duration_sec)
        values ('youtube', 'privat0001', false, %s, 'https://youtu.be/priv', 'ready', 600)
        returning id""",
        (owner_user_id,),
    ).fetchone()[0]
    conn.commit()
    return str(sid)


def _user(conn, email: str) -> str:
    uid = conn.execute(
        "insert into auth.users (email) values (%s) returning id", (email,)
    ).fetchone()[0]
    conn.execute("insert into profiles (user_id) values (%s)", (uid,))
    conn.commit()
    return str(uid)


def _project(conn, sid: str) -> tuple[str, str]:
    uid = _user(conn, "s@test.id")
    pid = conn.execute(
        "insert into projects (user_id, source_id, title) values (%s, %s, 'p') returning id",
        (uid, sid),
    ).fetchone()[0]
    conn.commit()
    return str(pid), str(uid)


def _job(conn, sid: str, pid: str, uid: str, ranges: list[dict]) -> Job:
    """Membuat baris job sungguhan.

    Handler memanggil heartbeat() yang menulis ke jobs.id bertipe uuid, jadi
    id rekaan seperti "j1" ditolak database.
    """
    payload = {"source_id": sid, "project_id": pid, "ranges": ranges}
    job_id = enqueue(conn, "fetch_segments", payload, user_id=uid, project_id=pid)
    return Job(job_id, "fetch_segments", payload, 1, 3, pid, uid)


def _segments(conn, sid: str) -> list[tuple]:
    return conn.execute(
        "select start_sec, end_sec, r2_key, expires_at, bytes from media_segments "
        "where source_id = %s order by start_sec",
        (sid,),
    ).fetchall()


@pytest.fixture
def deps(tmp_path):
    # Storage palsu yang mengingat apa yang sudah diunggah. Handler tidak lagi
    # menanyakan exists(), tetapi MagicMock polos akan menjawab truthy untuk
    # apa pun, sehingga regresi yang menghidupkan lagi pemeriksaan itu akan
    # dinilai terhadap jawaban palsu, bukan terhadap isi bucket.
    uploaded: set[str] = set()
    storage = MagicMock()
    storage.exists.side_effect = lambda key: key in uploaded
    storage.put_file.side_effect = lambda key, path, content_type: uploaded.add(key)
    calls = []

    def download(url, start, end, dest: Path):
        calls.append((start, end))
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(b"video palsu")
        return dest

    return {"storage": storage, "download": download, "workdir": tmp_path, "_calls": calls}


def _clean(deps: dict) -> dict:
    return {k: v for k, v in deps.items() if not k.startswith("_")}


def test_mengunduh_setiap_rentang_dan_mencatatnya(conn, deps):
    sid = _source(conn)
    pid, uid = _project(conn, sid)
    ranges = [{"start_sec": 10, "end_sec": 80}, {"start_sec": 100, "end_sec": 170}]

    job = _job(conn, sid, pid, uid, ranges)
    handle_fetch_segments(conn, job, **_clean(deps))

    assert deps["_calls"] == [(10.0, 80.0), (100.0, 170.0)]
    rows = _segments(conn, sid)
    assert len(rows) == 2
    assert rows[0][2].startswith("segments/")
    assert rows[0][3] > datetime.now(timezone.utc) + timedelta(days=SEGMENT_TTL_DAYS - 1)
    assert rows[0][4] == len(b"video palsu")
    assert (
        conn.execute("select progress from jobs where id = %s", (job.id,)).fetchone()[0] == 100
    )


def test_rentang_yang_sudah_ada_tidak_diunduh_ulang(conn, deps):
    sid = _source(conn)
    pid, uid = _project(conn, sid)
    ranges = [{"start_sec": 10, "end_sec": 80}]

    handle_fetch_segments(conn, _job(conn, sid, pid, uid, ranges), **_clean(deps))
    handle_fetch_segments(conn, _job(conn, sid, pid, uid, ranges), **_clean(deps))

    assert deps["_calls"] == [(10.0, 80.0)]
    assert (
        conn.execute(
            "select count(*) from media_segments where source_id = %s", (sid,)
        ).fetchone()[0]
        == 1
    )


def test_cache_hit_tidak_menggeser_masa_berlaku_segmen(conn, deps):
    """expires_at adalah cermin jadwal hapus R2, jadi tidak boleh dimajukan.

    Lifecycle R2 menghapus objek tujuh hari setelah objek itu ditulis dan tidak
    pernah membaca kolom ini. Memperpanjangnya pada cache hit hanya membuat
    baris hidup lebih lama daripada objek yang ditunjuknya.
    """
    sid = _source(conn)
    pid, uid = _project(conn, sid)
    ranges = [{"start_sec": 10, "end_sec": 80}]

    handle_fetch_segments(conn, _job(conn, sid, pid, uid, ranges), **_clean(deps))
    # Segmen hampir kedaluwarsa: lifecycle R2 akan menghapus objeknya besok.
    conn.execute(
        "update media_segments set expires_at = now() + interval '1 day' where source_id = %s",
        (sid,),
    )
    conn.commit()
    sebelum = _segments(conn, sid)[0][3]

    handle_fetch_segments(conn, _job(conn, sid, pid, uid, ranges), **_clean(deps))

    assert _segments(conn, sid)[0][3] == sebelum
    assert deps["_calls"] == [(10.0, 80.0)]


def test_baris_kedaluwarsa_diambil_ulang_dan_kuncinya_disembuhkan(conn, deps):
    """Objek yang sudah dihapus lifecycle tidak boleh dianggap cache hit."""
    sid = _source(conn)
    pid, uid = _project(conn, sid)
    ranges = [{"start_sec": 10, "end_sec": 80}]

    handle_fetch_segments(conn, _job(conn, sid, pid, uid, ranges), **_clean(deps))
    kunci_asli = _segments(conn, sid)[0][2]
    # Tiga hari lalu R2 menghapus objeknya; kunci pada baris ini sudah mati.
    conn.execute(
        "update media_segments set expires_at = now() - interval '3 days', "
        "r2_key = 'segments/sudah-dihapus.mp4' where source_id = %s",
        (sid,),
    )
    conn.commit()

    handle_fetch_segments(conn, _job(conn, sid, pid, uid, ranges), **_clean(deps))

    assert deps["_calls"] == [(10.0, 80.0), (10.0, 80.0)]
    assert deps["storage"].put_file.call_count == 2
    rows = _segments(conn, sid)
    assert len(rows) == 1
    assert rows[0][2] == kunci_asli
    assert rows[0][3] > datetime.now(timezone.utc) + timedelta(days=SEGMENT_TTL_DAYS - 1)


def test_segmen_yang_berbagi_objek_mewarisi_masa_berlakunya(conn, deps):
    """Objek dipakai ulang, jadi baris baru tidak boleh mengklaim umur baru.

    Kalau baris kedua diberi tujuh hari penuh sementara objeknya sudah berumur
    lima hari, DB menunjuk kunci yang R2 hapus lima hari lebih awal.
    """
    sid = _source(conn)
    pid, uid = _project(conn, sid)

    handle_fetch_segments(
        conn, _job(conn, sid, pid, uid, [{"start_sec": 10, "end_sec": 80}]), **_clean(deps)
    )
    # Objeknya sudah berumur lima hari: R2 menghapusnya dua hari lagi.
    conn.execute(
        "update media_segments set expires_at = now() + interval '2 days' where source_id = %s",
        (sid,),
    )
    conn.commit()

    handle_fetch_segments(
        conn, _job(conn, sid, pid, uid, [{"start_sec": 100, "end_sec": 170}]), **_clean(deps)
    )

    rows = _segments(conn, sid)
    assert len(rows) == 2
    # Isi kedua unduhan palsu identik, jadi keduanya menunjuk objek yang sama.
    assert rows[0][2] == rows[1][2]
    assert deps["storage"].put_file.call_count == 1
    assert rows[1][3] == rows[0][3]
    assert rows[1][3] < datetime.now(timezone.utc) + timedelta(days=3)


def test_kunci_r2_ditentukan_oleh_isi_berkas(conn, deps):
    sid = _source(conn)
    pid, uid = _project(conn, sid)
    ranges = [{"start_sec": 10, "end_sec": 80}, {"start_sec": 100, "end_sec": 170}]

    handle_fetch_segments(conn, _job(conn, sid, pid, uid, ranges), **_clean(deps))

    keys = [r[2] for r in _segments(conn, sid)]
    # Kedua unduhan palsu menghasilkan byte identik, jadi keduanya menunjuk
    # objek yang sama: kunci berasal dari digest isi, bukan dari rentang.
    assert len(set(keys)) == 1
    assert deps["storage"].put_file.call_count == 1


def test_rentang_yang_beda_pecahan_detik_tidak_berbagi_berkas_sementara(conn, deps):
    """Dua rentang berbeda harus turun ke dua path berbeda.

    Nama berkas yang dibulatkan ke detik bulat membuat 10.2-80.4 dan 10.4-80.2
    menempati path yang sama; yt-dlp tidak menimpa berkas yang sudah ada,
    sehingga rentang kedua diam-diam merekam video rentang pertama.
    """
    sid = _source(conn)
    pid, uid = _project(conn, sid)
    tujuan: list[Path] = []

    def unduh_tanpa_menimpa(url, start, end, dest: Path):
        # Perilaku bawaan yt-dlp: berkas yang sudah ada dibiarkan apa adanya.
        tujuan.append(dest)
        if not dest.exists():
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(f"video {start}-{end}".encode())
        return dest

    deps["download"] = unduh_tanpa_menimpa
    ranges = [{"start_sec": 10.2, "end_sec": 80.4}, {"start_sec": 10.4, "end_sec": 80.2}]
    handle_fetch_segments(conn, _job(conn, sid, pid, uid, ranges), **_clean(deps))

    assert len(set(tujuan)) == 2
    rows = _segments(conn, sid)
    assert [(r[0], r[1]) for r in rows] == [
        (Decimal("10.200"), Decimal("80.400")),
        (Decimal("10.400"), Decimal("80.200")),
    ]
    # Isi kedua rentang berbeda, jadi kuncinya wajib berbeda pula.
    assert rows[0][2] != rows[1][2]


def test_rentang_dengan_pecahan_di_luar_skala_kolom_tetap_kena_cache(conn, deps):
    """Nilai dibulatkan di Python supaya sama persis dengan yang disimpan.

    Kolomnya numeric(10,3); kalau pembulatan diserahkan ke Postgres, pencarian
    memakai 10.0005 tidak pernah cocok dengan baris 10.001 yang baru ditulis.
    """
    sid = _source(conn)
    pid, uid = _project(conn, sid)
    ranges = [{"start_sec": 10.0005, "end_sec": 80.0}]

    handle_fetch_segments(conn, _job(conn, sid, pid, uid, ranges), **_clean(deps))
    handle_fetch_segments(conn, _job(conn, sid, pid, uid, ranges), **_clean(deps))

    assert len(deps["_calls"]) == 1
    rows = _segments(conn, sid)
    assert len(rows) == 1
    assert rows[0][0] == Decimal("10.001")


def test_berkas_sementara_dihapus_setelah_diunggah(conn, deps):
    """Segmen adalah artefak terbesar pipeline; disk VPS tidak boleh diisi."""
    sid = _source(conn)
    pid, uid = _project(conn, sid)
    ranges = [{"start_sec": 10, "end_sec": 80}, {"start_sec": 100, "end_sec": 170}]

    handle_fetch_segments(conn, _job(conn, sid, pid, uid, ranges), **_clean(deps))

    assert list(deps["workdir"].iterdir()) == []


def test_rentang_di_luar_durasi_ditolak(conn, deps):
    sid = _source(conn)
    pid, uid = _project(conn, sid)

    with pytest.raises(JobError) as e:
        handle_fetch_segments(
            conn,
            _job(conn, sid, pid, uid, [{"start_sec": 500, "end_sec": 900}]),
            **_clean(deps),
        )
    assert e.value.terminal is True
    assert deps["_calls"] == []


def test_rentang_terbalik_ditolak(conn, deps):
    sid = _source(conn)
    pid, uid = _project(conn, sid)

    with pytest.raises(JobError) as e:
        handle_fetch_segments(
            conn,
            _job(conn, sid, pid, uid, [{"start_sec": 80, "end_sec": 10}]),
            **_clean(deps),
        )
    assert e.value.terminal is True
    assert deps["_calls"] == []


def test_start_negatif_ditolak(conn, deps):
    """Tanpa penjagaan ini yt-dlp menerima `--download-sections *-5.000-80.000`."""
    sid = _source(conn)
    pid, uid = _project(conn, sid)

    with pytest.raises(JobError) as e:
        handle_fetch_segments(
            conn,
            _job(conn, sid, pid, uid, [{"start_sec": -5, "end_sec": 80}]),
            **_clean(deps),
        )
    assert e.value.terminal is True
    assert deps["_calls"] == []


def test_satu_rentang_tidak_valid_membatalkan_seluruh_job(conn, deps):
    sid = _source(conn)
    pid, uid = _project(conn, sid)
    ranges = [{"start_sec": 10, "end_sec": 80}, {"start_sec": 500, "end_sec": 900}]

    with pytest.raises(JobError):
        handle_fetch_segments(conn, _job(conn, sid, pid, uid, ranges), **_clean(deps))

    # Validasi berjalan sebelum unduhan pertama, jadi tidak ada bandwidth terbuang.
    assert deps["_calls"] == []
    assert (
        conn.execute(
            "select count(*) from media_segments where source_id = %s", (sid,)
        ).fetchone()[0]
        == 0
    )


def test_daftar_rentang_kosong_ditolak(conn, deps):
    sid = _source(conn)
    pid, uid = _project(conn, sid)

    with pytest.raises(JobError) as e:
        handle_fetch_segments(conn, _job(conn, sid, pid, uid, []), **_clean(deps))
    assert e.value.terminal is True


def test_source_tidak_dikenal_gagal_terminal(conn, deps):
    sid = _source(conn)
    pid, uid = _project(conn, sid)
    hilang = "00000000-0000-0000-0000-0000000000ff"

    with pytest.raises(JobError) as e:
        handle_fetch_segments(
            conn,
            _job(conn, hilang, pid, uid, [{"start_sec": 0, "end_sec": 10}]),
            **_clean(deps),
        )
    assert e.value.terminal is True
    assert deps["_calls"] == []


def test_source_privat_milik_user_lain_tidak_diunduh(conn, deps):
    """Worker memakai kredensial penuh, jadi RLS tidak menjaganya di sini."""
    sid = _source(conn)
    pid, uid = _project(conn, sid)
    milik_orang_lain = _private_source(conn, _user(conn, "lain@test.id"))

    with pytest.raises(JobError) as e:
        handle_fetch_segments(
            conn,
            _job(conn, milik_orang_lain, pid, uid, [{"start_sec": 0, "end_sec": 10}]),
            **_clean(deps),
        )
    assert e.value.terminal is True
    assert deps["_calls"] == []
    assert (
        conn.execute(
            "select count(*) from media_segments where source_id = %s", (milik_orang_lain,)
        ).fetchone()[0]
        == 0
    )


def test_source_privat_milik_sendiri_tetap_diunduh(conn, deps):
    """Penjagaan kepemilikan tidak boleh mengunci pemiliknya sendiri."""
    sid = _source(conn)
    pid, uid = _project(conn, sid)
    milik_sendiri = _private_source(conn, uid)

    handle_fetch_segments(
        conn,
        _job(conn, milik_sendiri, pid, uid, [{"start_sec": 0, "end_sec": 10}]),
        **_clean(deps),
    )

    assert deps["_calls"] == [(0.0, 10.0)]
    assert len(_segments(conn, milik_sendiri)) == 1


def test_download_section_meminta_rentang_dan_codec_yang_didekode_browser(tmp_path, monkeypatch):
    dest = tmp_path / "seg.mp4"
    captured: dict[str, list[str]] = {}

    def fake_run(args: list[str]):
        captured["args"] = args
        dest.write_bytes(b"mp4 palsu")
        return subprocess.CompletedProcess(args, 0, "", "")

    monkeypatch.setattr(ytdlp, "_run", fake_run)
    assert ytdlp.download_section("https://youtu.be/x", 10.5, 42.25, dest) == dest

    args = captured["args"]
    assert args[0] == "yt-dlp"
    assert args[args.index("--download-sections") + 1] == "*10.500-42.250"
    assert "--force-keyframes-at-cuts" in args
    fmt = args[args.index("-f") + 1]
    # H.264 sampai 1080p: WebCodecs mendekodenya secara hardware di semua
    # platform, sehingga P2 tidak perlu transcode di server.
    assert "avc1" in fmt
    assert "1080" in fmt
    assert args[-1] == "https://youtu.be/x"


def test_download_section_menerjemahkan_error_yt_dlp(tmp_path, monkeypatch):
    def fake_run(args: list[str]):
        return subprocess.CompletedProcess(
            args, 1, "", "ERROR: Video unavailable. This video is private"
        )

    monkeypatch.setattr(ytdlp, "_run", fake_run)
    with pytest.raises(JobError) as e:
        ytdlp.download_section("https://youtu.be/x", 0, 5, tmp_path / "seg.mp4")
    assert e.value.code == "SOURCE_UNAVAILABLE"
    assert e.value.terminal is True


def test_download_section_gagal_bila_berkas_tidak_terbentuk(tmp_path, monkeypatch):
    monkeypatch.setattr(
        ytdlp, "_run", lambda args: subprocess.CompletedProcess(args, 0, "", "")
    )
    with pytest.raises(JobError) as e:
        ytdlp.download_section("https://youtu.be/x", 0, 5, tmp_path / "seg.mp4")
    assert e.value.code == "INTERNAL"
