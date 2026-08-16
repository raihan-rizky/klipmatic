"""Menjaga aturan lifecycle bucket tetap sejalan dengan semua producer.

Tidak menyentuh jaringan: yang dijaga adalah kesepakatan antara RULES, prefix
kunci R2 di app/, dan TTL yang dicatat handler ke database.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from app.handlers.fetch_segments import SEGMENT_TTL_DAYS
from scripts.r2_lifecycle import RULES, apply_cors, apply_lifecycle

APP = Path(__file__).resolve().parents[1] / "app"

# Spec §8.2: transcripts/ sengaja tanpa aturan kedaluwarsa. Didaftarkan di sini
# supaya prefix baru yang lupa diputuskan tetap menggagalkan tes.
PREFIX_TANPA_KEDALUWARSA = {
    "transcripts/",
    "clip-transcripts/",
    # Thumbnail hidup selama candidate row-nya hidup. Re-analysis menghapus
    # object lama setelah penggantian row berhasil.
    "candidate-thumbnails/",
}


def _prefix_kunci_r2() -> set[str]:
    # Prefix R2 boleh memakai tanda hubung (mis. clip-transcripts/).
    pola = re.compile(r'f"([a-z0-9_-]+)/\{')
    ditemukan: set[str] = set()
    for berkas in APP.rglob("*.py"):
        ditemukan |= {f"{m}/" for m in pola.findall(berkas.read_text(encoding="utf-8"))}
    return ditemukan


def _rule(prefix: str) -> dict[str, Any]:
    return next(r for r in RULES["Rules"] if r["Filter"]["Prefix"] == prefix)


def test_setiap_prefix_kunci_handler_punya_keputusan_lifecycle():
    diproduksi = _prefix_kunci_r2()
    assert diproduksi, "tidak ada kunci R2 terdeteksi di app/handlers — perbarui pola tes ini"

    diatur = {r["Filter"]["Prefix"] for r in RULES["Rules"]}
    assert diproduksi == diatur | PREFIX_TANPA_KEDALUWARSA, (
        "prefix kunci R2 dan aturan lifecycle sudah menyimpang; "
        "aturan yang meleset berarti objek tidak pernah dihapus atau dihapus diam-diam"
    )


def test_ttl_segmen_sama_dengan_yang_dicatat_handler_ke_database():
    """media_segments.expires_at hanyalah cermin dari penghapusan R2.

    Kalau kedua angka berbeda, baris database menunjuk objek yang sudah hilang
    (atau menahan cache yang seharusnya sudah kedaluwarsa).
    """
    assert _rule("segments/")["Expiration"]["Days"] == SEGMENT_TTL_DAYS


def test_ttl_preview_sama_dengan_segmen():
    """Preview turunan kandidat memakai TTL yang sama dengan segmen."""
    assert _rule("previews/")["Expiration"]["Days"] == SEGMENT_TTL_DAYS


def test_audio_kedaluwarsa_30_hari_sesuai_spec():
    assert _rule("audio/")["Expiration"]["Days"] == 30


def test_semua_aturan_aktif():
    # Aturan berstatus Disabled diterima R2 tanpa keluhan dan tidak menghapus
    # apa pun — kegagalan yang tampak seperti keberhasilan.
    assert [r["Status"] for r in RULES["Rules"]] == ["Enabled"] * len(RULES["Rules"])


def test_apply_lifecycle_mengirim_RULES_ke_bucket_storage():
    class S3Palsu:
        def __init__(self) -> None:
            self.panggilan: list[dict[str, Any]] = []

        def put_bucket_lifecycle_configuration(self, **kwargs: Any) -> None:
            self.panggilan.append(kwargs)

        def put_bucket_cors(self, **kwargs: Any) -> None:
            self.panggilan.append(kwargs)

    class StoragePalsu:
        bucket = "bucket-tes"

        def __init__(self) -> None:
            self._s3 = S3Palsu()

    storage = StoragePalsu()
    apply_lifecycle(storage)  # type: ignore[arg-type]

    assert storage._s3.panggilan == [
        {"Bucket": "bucket-tes", "LifecycleConfiguration": RULES}
    ]


def test_apply_cors_hanya_mengizinkan_origin_aplikasi():
    class S3Palsu:
        def __init__(self) -> None:
            self.panggilan: list[dict[str, Any]] = []

        def put_bucket_cors(self, **kwargs: Any) -> None:
            self.panggilan.append(kwargs)

    class StoragePalsu:
        bucket = "bucket-tes"

        def __init__(self) -> None:
            self._s3 = S3Palsu()

    storage = StoragePalsu()
    apply_cors(storage, ["https://app.klipmatic.id"])
    rule = storage._s3.panggilan[0]["CORSConfiguration"]["CORSRules"][0]
    assert rule["AllowedOrigins"] == ["https://app.klipmatic.id"]
    assert rule["AllowedMethods"] == ["GET", "HEAD"]
    assert "PUT" not in rule["AllowedMethods"]
