import pytest

from app.errors import JobError
from app.ytdlp import SourceMeta
from scripts.canary import (
    CANARY_URLS_DEFAULT,
    EXIT_OK,
    EXIT_PROBE_GAGAL,
    EXIT_TAK_TERPANTAU,
    CanaryResult,
    canary_urls,
    main,
    run_canary,
)

META = SourceMeta("judul", "channel", 120, None, "public")


def test_semua_url_sehat():
    results = run_canary(["https://a", "https://b"], probe_fn=lambda url: META)
    assert results == [
        CanaryResult("https://a", True, None),
        CanaryResult("https://b", True, None),
    ]


def test_satu_url_rusak_dilaporkan_tanpa_menghentikan_sisanya():
    def probe(url: str) -> SourceMeta:
        if url == "https://rusak":
            raise JobError("SOURCE_BLOCKED", "diblokir", terminal=False)
        return META

    results = run_canary(["https://rusak", "https://ok"], probe_fn=probe)
    assert results[0].ok is False
    assert results[0].error_code == "SOURCE_BLOCKED"
    assert results[1].ok is True


def test_exception_tak_terduga_dilaporkan_sebagai_INTERNAL():
    def probe(url: str) -> SourceMeta:
        raise RuntimeError("yt-dlp menghilang")

    results = run_canary(["https://x"], probe_fn=probe)
    assert results[0].ok is False
    assert results[0].error_code == "INTERNAL"


def test_setiap_platform_yang_didukung_punya_slot_kanari():
    assert set(CANARY_URLS_DEFAULT) == {"youtube", "tiktok", "gdrive"}


def test_url_kanari_dapat_ditimpa_lewat_env(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("CANARY_GDRIVE_URL", "https://drive.example/berkas")
    assert canary_urls()["gdrive"] == "https://drive.example/berkas"


def test_env_kosong_tidak_menghapus_default(monkeypatch: pytest.MonkeyPatch):
    """.env.example memuat CANARY_YOUTUBE_URL= kosong; itu bukan perintah
    mematikan kanari YouTube, melainkan 'pakai default'."""
    monkeypatch.setenv("CANARY_YOUTUBE_URL", "")
    assert canary_urls()["youtube"] == CANARY_URLS_DEFAULT["youtube"]


def _semua_platform_terisi(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CANARY_GDRIVE_URL", "https://drive.example/berkas")


def test_main_keluar_0_saat_semua_sehat(monkeypatch: pytest.MonkeyPatch):
    _semua_platform_terisi(monkeypatch)
    monkeypatch.setattr("scripts.canary._probe", lambda url: META)
    assert main() == EXIT_OK


def test_main_keluar_1_saat_ada_yang_gagal(monkeypatch: pytest.MonkeyPatch):
    _semua_platform_terisi(monkeypatch)

    def probe(url: str) -> SourceMeta:
        raise JobError("SOURCE_BLOCKED", "diblokir", terminal=False)

    monkeypatch.setattr("scripts.canary._probe", probe)
    assert main() == EXIT_PROBE_GAGAL


def test_main_memprobe_url_semua_platform_yang_terkonfigurasi(
    monkeypatch: pytest.MonkeyPatch,
):
    """Invarian yang menjadi alasan kanari ini ada.

    Kode keluar 0 juga benar ketika main() diam-diam berhenti memantau
    sebagian platform, jadi kode keluar saja bukan penjaga apa pun.
    """
    _semua_platform_terisi(monkeypatch)
    diprobe: list[str] = []

    def probe(url: str) -> SourceMeta:
        diprobe.append(url)
        return META

    monkeypatch.setattr("scripts.canary._probe", probe)
    assert main() == EXIT_OK
    assert sorted(diprobe) == sorted(canary_urls().values())
    assert len(diprobe) == len(CANARY_URLS_DEFAULT)


def test_main_keluar_2_saat_ada_platform_tanpa_url(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
):
    """Platform tanpa URL kanari adalah platform tanpa pemantauan (spec §9.2).

    Sebelumnya run tetap hijau, sehingga tidak ada apa pun di repo yang akan
    membuat seseorang mengisi CANARY_GDRIVE_URL.
    """
    monkeypatch.delenv("CANARY_GDRIVE_URL", raising=False)
    monkeypatch.setattr("scripts.canary._probe", lambda url: META)

    assert main() == EXIT_TAK_TERPANTAU
    err = capsys.readouterr().err
    assert "gdrive" in err
    assert "CANARY_GDRIVE_URL" in err


def test_extractor_rusak_didahulukan_atas_platform_tak_terpantau(
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.delenv("CANARY_GDRIVE_URL", raising=False)

    def probe(url: str) -> SourceMeta:
        raise JobError("SOURCE_BLOCKED", "diblokir", terminal=False)

    monkeypatch.setattr("scripts.canary._probe", probe)
    assert main() == EXIT_PROBE_GAGAL
