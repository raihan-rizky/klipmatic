from __future__ import annotations

import logging
import os
import time
from collections.abc import Callable
from pathlib import Path
from typing import TypeVar

import boto3
from botocore.client import Config
from botocore.exceptions import ClientError

from app.observability import elapsed_ms, emit

log = logging.getLogger(__name__)
T = TypeVar("T")


class Storage:
    """Klien R2.

    R2 berbicara protokol S3, jadi boto3 dipakai apa adanya; MinIO memakai
    antarmuka yang sama sehingga tes tidak butuh jaringan luar.
    """

    def __init__(self, endpoint: str, access_key: str, secret_key: str, bucket: str):
        self.bucket = bucket
        self._s3 = boto3.client(
            "s3",
            endpoint_url=endpoint,
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            config=Config(signature_version="s3v4"),
            region_name="auto",
        )

    def _call(
        self,
        operation: str,
        callback: Callable[[], T],
        *,
        byte_count: int | None = None,
    ) -> T:
        started = time.monotonic()
        try:
            result = callback()
        except Exception as error:
            emit(
                log,
                "storage.operation.failed",
                level=logging.ERROR,
                operation=operation,
                bucket_role="media",
                error_class=type(error).__name__,
                duration_ms=elapsed_ms(started),
            )
            raise
        fields: dict[str, object] = {
            "operation": operation,
            "bucket_role": "media",
            "duration_ms": elapsed_ms(started),
        }
        if byte_count is not None:
            fields["byte_count"] = byte_count
        emit(log, "storage.operation.completed", **fields)
        return result

    def ensure_bucket(self) -> None:
        def ensure() -> None:
            try:
                self._s3.head_bucket(Bucket=self.bucket)
            except ClientError:
                self._s3.create_bucket(Bucket=self.bucket)

        self._call("ensure_bucket", ensure)

    def put_file(self, key: str, path: Path, content_type: str) -> None:
        self._call(
            "put_file",
            lambda: self._s3.upload_file(
                str(path),
                self.bucket,
                key,
                ExtraArgs={
                    "ContentType": content_type,
                    # Key bersifat content-addressed sehingga aman di-cache selamanya.
                    "CacheControl": "public, max-age=31536000, immutable",
                },
            ),
            byte_count=path.stat().st_size,
        )

    def put_bytes(self, key: str, data: bytes, content_type: str) -> None:
        self._call(
            "put_bytes",
            lambda: self._s3.put_object(
                Bucket=self.bucket,
                Key=key,
                Body=data,
                ContentType=content_type,
                CacheControl="public, max-age=31536000, immutable",
            ),
            byte_count=len(data),
        )

    def get_bytes(self, key: str) -> bytes:
        started = time.monotonic()
        try:
            data = self._s3.get_object(Bucket=self.bucket, Key=key)["Body"].read()
        except Exception as error:
            emit(
                log,
                "storage.operation.failed",
                level=logging.ERROR,
                operation="get_bytes",
                bucket_role="media",
                error_class=type(error).__name__,
                duration_ms=elapsed_ms(started),
            )
            raise
        emit(
            log,
            "storage.operation.completed",
            operation="get_bytes",
            bucket_role="media",
            byte_count=len(data),
            duration_ms=elapsed_ms(started),
        )
        return data

    def download_to(self, key: str, dest: Path) -> Path:
        dest.parent.mkdir(parents=True, exist_ok=True)
        self._call(
            "download_to",
            lambda: self._s3.download_file(self.bucket, key, str(dest)),
        )
        return dest

    def exists(self, key: str) -> bool:
        started = time.monotonic()
        try:
            self._s3.head_object(Bucket=self.bucket, Key=key)
            exists = True
        except ClientError:
            exists = False
        emit(
            log,
            "storage.operation.completed",
            operation="exists",
            bucket_role="media",
            result_count=int(exists),
            duration_ms=elapsed_ms(started),
        )
        return exists

    def delete(self, key: str) -> None:
        # S3 DeleteObject is idempotent, which lets the DB reaper safely retry
        # after a worker crash between object deletion and row update.
        self._call(
            "delete",
            lambda: self._s3.delete_object(Bucket=self.bucket, Key=key),
        )

    def presigned_get(self, key: str, expires_sec: int = 3600) -> str:
        return self._call(
            "presigned_get",
            lambda: self._s3.generate_presigned_url(
                "get_object",
                Params={"Bucket": self.bucket, "Key": key},
                ExpiresIn=expires_sec,
            ),
        )


def storage_from_env() -> Storage:
    return Storage(
        endpoint=os.environ["R2_ENDPOINT"],
        access_key=os.environ["R2_ACCESS_KEY_ID"],
        secret_key=os.environ["R2_SECRET_ACCESS_KEY"],
        bucket=os.environ["R2_BUCKET"],
    )
