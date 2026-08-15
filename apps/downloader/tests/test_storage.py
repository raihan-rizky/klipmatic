import logging
import os
import uuid
from pathlib import Path

import pytest

from app.storage import Storage

pytestmark = pytest.mark.skipif(
    not os.environ.get("R2_ENDPOINT"), reason="butuh MinIO berjalan"
)


@pytest.fixture
def storage() -> Storage:
    s = Storage(
        endpoint=os.environ["R2_ENDPOINT"],
        access_key=os.environ["R2_ACCESS_KEY_ID"],
        secret_key=os.environ["R2_SECRET_ACCESS_KEY"],
        bucket=os.environ["R2_BUCKET"],
    )
    s.ensure_bucket()
    return s


@pytest.fixture
def prefix() -> str:
    """Prefix unik per tes.

    MinIO menyimpan objek antar-run, jadi key tetap akan membuat assertion
    "belum ada" gagal pada eksekusi kedua.
    """
    return f"tes/{uuid.uuid4().hex}"


def test_put_lalu_exists(storage: Storage, tmp_path: Path, prefix: str):
    f = tmp_path / "x.txt"
    f.write_text("isi")
    key = f"{prefix}/x.txt"
    assert storage.exists(key) is False
    storage.put_file(key, f, "text/plain")
    assert storage.exists(key) is True


def test_presigned_get_dapat_diunduh(storage: Storage, tmp_path: Path, prefix: str):
    import httpx

    f = tmp_path / "y.txt"
    f.write_text("isi presigned")
    key = f"{prefix}/y.txt"
    storage.put_file(key, f, "text/plain")
    url = storage.presigned_get(key, expires_sec=60)
    assert httpx.get(url).text == "isi presigned"


def test_delete_is_idempotent(storage: Storage, tmp_path: Path, prefix: str):
    f = tmp_path / "delete.txt"
    f.write_text("hapus")
    key = f"{prefix}/delete.txt"
    storage.put_file(key, f, "text/plain")

    storage.delete(key)
    storage.delete(key)

    assert storage.exists(key) is False


def test_put_file_logs_safe_summary(storage: Storage, tmp_path: Path, prefix: str, caplog):
    caplog.set_level(logging.INFO)
    path = tmp_path / "private-filename.txt"
    path.write_bytes(b"abc")

    storage.put_file(f"{prefix}/private-object.txt", path, "text/plain")

    record = next(
        record
        for record in caplog.records
        if getattr(record, "event_name", None) == "storage.operation.completed"
    )
    assert record.event_fields["operation"] == "put_file"
    assert record.event_fields["bucket_role"] == "media"
    assert record.event_fields["byte_count"] == 3
    assert record.event_fields["duration_ms"] >= 0
    assert "private-filename" not in caplog.text
    assert "private-object" not in caplog.text
