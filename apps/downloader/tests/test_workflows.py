"""Tes konfigurasi workflow: yang dijalankan operator, bukan yang dijalankan pytest.

Kanari hanya berguna kalau nightly benar-benar memanggilnya dan benar-benar
bisa disetel ulang dari luar source. Keduanya hidup di YAML, jadi tidak ada tes
lain yang menyentuhnya.
"""

from pathlib import Path

from scripts.canary import CANARY_URLS_DEFAULT

WORKFLOWS = Path(__file__).resolve().parents[3] / ".github" / "workflows"


def test_nightly_menjalankan_skrip_kanari():
    assert "python -m scripts.canary" in (WORKFLOWS / "nightly.yml").read_text(encoding="utf-8")


def test_nightly_menyediakan_penimpa_env_untuk_setiap_platform():
    """Alasan canary_urls() ada adalah URL kanari yang membusuk.

    Kalau nightly hanya menyuntik sebagian platform, untuk sisanya operator
    tetap harus mengedit source dan menunggu rilis — persis yang hendak
    dihindari mekanisme penimpa itu.
    """
    isi = (WORKFLOWS / "nightly.yml").read_text(encoding="utf-8")
    for platform in CANARY_URLS_DEFAULT:
        nama = f"CANARY_{platform.upper()}_URL"
        assert f"{nama}: ${{{{ vars.{nama} }}}}" in isi, f"{nama} tidak disuntik di nightly.yml"
