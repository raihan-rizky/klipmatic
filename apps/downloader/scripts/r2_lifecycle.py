"""Menerapkan aturan lifecycle bucket sesuai spec §8.2.

Dijalankan sekali saat penyiapan, dan lagi setiap kali aturannya berubah.

Pakai:
    uv run python -m scripts.r2_lifecycle
"""

from __future__ import annotations

import os

from botocore.exceptions import ClientError

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


def apply_cors(storage: Storage, origins: list[str] | None = None) -> bool:
    allowed = origins or [
        origin.strip()
        for origin in os.environ.get("R2_CORS_ORIGINS", "http://localhost:3000").split(",")
        if origin.strip()
    ]
    try:
        storage._s3.put_bucket_cors(  # noqa: SLF001
            Bucket=storage.bucket,
            CORSConfiguration={
                "CORSRules": [
                    {
                        "AllowedOrigins": allowed,
                        "AllowedMethods": ["GET", "HEAD"],
                        "AllowedHeaders": ["*"],
                        "ExposeHeaders": ["ETag", "Content-Length", "Content-Range"],
                        "MaxAgeSeconds": 3600,
                    }
                ]
            },
        )
        return True
    except ClientError as error:
        # MinIO community tidak mengimplementasikan PutBucketCors. Dev server
        # menerima origin lewat MINIO_API_CORS_ALLOW_ORIGIN di docker-compose.
        if error.response.get("Error", {}).get("Code") == "NotImplemented":
            return False
        raise


def main() -> None:
    storage = storage_from_env()
    apply_lifecycle(storage)
    cors_applied = apply_cors(storage)
    suffix = "dan CORS" if cors_applied else "(CORS dikelola runtime MinIO)"
    print(f"aturan lifecycle diterapkan ke bucket {storage.bucket} {suffix}")


if __name__ == "__main__":
    main()
