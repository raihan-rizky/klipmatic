"""Menerapkan aturan lifecycle bucket sesuai spec §8.2.

Dijalankan sekali saat penyiapan, dan lagi setiap kali aturannya berubah.

Pakai:
    uv run python -m scripts.r2_lifecycle
"""

from __future__ import annotations

from app.storage import Storage, storage_from_env

# R2 — seperti S3 — menghitung Expiration.Days sejak objek DIBUAT dan tidak
# pernah melihat database. Dua konsekuensi yang harus dipegang pemanggil:
#
# 1. Spec §8.2 menyebut audio/ kedaluwarsa "sejak akses terakhir". Perbedaan
#    itu diterima: audio bersifat content-addressed sehingga membuat ulang
#    objek yang telanjur terhapus hanya berbiaya satu unduhan, bukan satu
#    transkripsi.
# 2. media_segments.expires_at adalah CERMIN dari penghapusan di sini, bukan
#    pengendalinya. Karena itu ia tidak boleh diperpanjang saat cache hit:
#    memperpanjangnya membuat baris DB menunjuk objek yang sudah dihapus R2.
#    Aturan segmen di bawah wajib sinkron dengan SEGMENT_TTL_DAYS di
#    app/handlers/fetch_segments.py — dijaga oleh tests/test_r2_lifecycle.py.
RULES = {
    "Rules": [
        {
            "ID": "audio-30-hari",
            "Filter": {"Prefix": "audio/"},
            "Status": "Enabled",
            "Expiration": {"Days": 30},
        },
        {
            "ID": "segmen-7-hari",
            "Filter": {"Prefix": "segments/"},
            "Status": "Enabled",
            "Expiration": {"Days": 7},
        },
        # transcripts/ sengaja tidak punya aturan kedaluwarsa: ukurannya kecil
        # dan ia adalah lapis cache paling berharga.
    ]
}


def apply_lifecycle(storage: Storage) -> None:
    # Storage tidak mengekspos operasi bucket-level karena hanya skrip
    # penyiapan ini yang membutuhkannya; menambah metode publik hanya untuk
    # satu pemanggil justru memperlebar antarmuka tanpa alasan.
    storage._s3.put_bucket_lifecycle_configuration(  # noqa: SLF001
        Bucket=storage.bucket, LifecycleConfiguration=RULES
    )


def main() -> None:
    storage = storage_from_env()
    apply_lifecycle(storage)
    print(f"aturan lifecycle diterapkan ke bucket {storage.bucket}")


if __name__ == "__main__":
    main()
