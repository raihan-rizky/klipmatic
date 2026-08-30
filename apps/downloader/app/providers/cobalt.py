from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx

from app.errors import JobError
from app.ytdlp import SourceMeta


@dataclass(frozen=True)
class CobaltResult:
    provider: str
    media_url: str
    filename: str
    metadata: dict[str, Any]


class CobaltProvider:
    """Self-hosted Cobalt API adapter; never uses a public instance by default."""

    def __init__(self, base_url: str, *, client: Any | None = None, timeout: float = 120.0):
        self.base_url = base_url.rstrip("/")
        self.client = client or httpx.Client(timeout=timeout, follow_redirects=True)

    def _request(self, url: str, **options: Any) -> CobaltResult:
        try:
            response = self.client.post(
                self.base_url,
                json={"url": url, "videoQuality": "1080", "youtubeVideoCodec": "h264", "youtubeVideoContainer": "mp4", "downloadMode": "auto", "localProcessing": "forced", **options},
                headers={"Accept": "application/json", "Content-Type": "application/json"},
            )
            if hasattr(response, "raise_for_status"):
                response.raise_for_status()
            body = response.json() if hasattr(response, "json") else response
            tunnel = body.get("tunnel") or []
            media_url = body.get("url") or (tunnel[0] if tunnel else None)
            if body.get("status") not in {"tunnel", "redirect", "local-processing"} or not media_url:
                raise RuntimeError(f"Cobalt response status={body.get('status')}")
            output = body.get("output") or {}
            return CobaltResult(
                "cobalt",
                media_url,
                body.get("filename") or output.get("filename", "cobalt.mp4"),
                body.get("metadata") or output.get("metadata") or {},
            )
        except Exception as error:
            raise JobError("SOURCE_BLOCKED", f"Cobalt fallback gagal: {type(error).__name__}", terminal=False) from error

    def probe(self, url: str) -> SourceMeta:
        result = self._request(url, subtitleLang="id")
        metadata = result.metadata
        duration = int(float(metadata.get("duration") or 60))
        return SourceMeta(
            title=metadata.get("title") or result.filename,
            channel=metadata.get("artist") or metadata.get("author"),
            duration_sec=duration,
            thumbnail_url=metadata.get("thumbnail"),
            availability="public",
            provider="cobalt",
            media_url=result.media_url,
        )

    def download(self, url: str, dest: Path) -> Path:
        result = self._request(url)
        with self.client.stream("GET", result.media_url) as response:
            response.raise_for_status()
            dest.parent.mkdir(parents=True, exist_ok=True)
            with dest.open("wb") as output:
                for chunk in response.iter_bytes():
                    output.write(chunk)
        if not dest.exists() or dest.stat().st_size == 0:
            raise JobError("SOURCE_BLOCKED", "Cobalt menghasilkan berkas kosong", terminal=False)
        return dest
