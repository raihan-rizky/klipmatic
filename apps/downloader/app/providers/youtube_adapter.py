from __future__ import annotations

import os
from typing import Any

import httpx

from app.ytdlp import SourceMeta


def fetch_metadata(url: str) -> SourceMeta | None:
    base = os.getenv("YOUTUBE_ADAPTER_URL", "").strip()
    if not base:
        return None
    try:
        response = httpx.post(f"{base.rstrip('/')}/metadata", json={"url": url}, timeout=30)
        response.raise_for_status()
        body: dict[str, Any] = response.json()
        return SourceMeta(
            title=body.get("title") or "YouTube video",
            channel=body.get("channel"),
            duration_sec=int(body.get("duration_sec") or 60),
            thumbnail_url=body.get("thumbnail_url"),
            availability="public",
            provider="youtubei.js",
        )
    except (httpx.HTTPError, ValueError, TypeError):
        return None
