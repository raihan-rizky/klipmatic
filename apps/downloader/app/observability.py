from __future__ import annotations

import contextvars
import json
import logging
import math
import os
import re
import sys
import time
import traceback
from collections.abc import Mapping
from datetime import UTC, datetime
from typing import IO

LogValue = str | int | float | bool | None

_context: contextvars.ContextVar[dict[str, LogValue] | None] = contextvars.ContextVar(
    "log_context", default=None
)
_milestones: contextvars.ContextVar[frozenset[int]] = contextvars.ContextVar(
    "log_milestones", default=frozenset()
)

_SAFE_FIELD_KEYS = {
    "worker_id",
    "job_id",
    "job_type",
    "project_id",
    "attempt",
    "request_id",
    "method",
    "route",
    "status_code",
    "duration_ms",
    "progress",
    "error_code",
    "error_class",
    "next_attempt",
    "retry_delay_sec",
    "tool",
    "operation",
    "timeout_sec",
    "exit_code",
    "provider",
    "byte_count",
    "result_count",
    "candidate_count",
    "reaped_count",
    "bucket_role",
    "asset_id",
    "clip_id",
    "candidate_id",
}
_SAFE_TOKEN = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")
_SAFE_ROUTE = re.compile(r"^/[A-Za-z0-9_./\[\]-]{1,200}$")
_SAFE_EVENT = re.compile(r"^[a-z][a-z0-9_.]{1,127}$")
_LEVELS = {
    "DEBUG": logging.DEBUG,
    "INFO": logging.INFO,
    "WARNING": logging.WARNING,
    "ERROR": logging.ERROR,
    "CRITICAL": logging.CRITICAL,
}
_MILESTONES = (0, 25, 50, 75, 100)


def _safe_string(key: str, value: str) -> bool:
    pattern = _SAFE_ROUTE if key == "route" else _SAFE_TOKEN
    return bool(pattern.fullmatch(value))


def sanitize_fields(fields: Mapping[str, object]) -> dict[str, LogValue]:
    safe: dict[str, LogValue] = {}
    for key, value in fields.items():
        if key not in _SAFE_FIELD_KEYS:
            continue
        if isinstance(value, str):
            if _safe_string(key, value):
                safe[key] = value
            continue
        if value is None or isinstance(value, (bool, int)):
            safe[key] = value
            continue
        if isinstance(value, float) and math.isfinite(value):
            safe[key] = value
    return safe


def _current_context() -> dict[str, LogValue]:
    return _context.get() or {}


def bind_context(
    **fields: object,
) -> contextvars.Token[dict[str, LogValue] | None]:
    return _context.set(sanitize_fields({**_current_context(), **fields}))


def reset_context(token: contextvars.Token[dict[str, LogValue] | None]) -> None:
    _context.reset(token)


def reset_progress_milestones() -> None:
    _milestones.set(frozenset())


def elapsed_ms(started: float) -> int:
    return max(0, round((time.monotonic() - started) * 1000))


def emit(
    logger: logging.Logger,
    event: str,
    *,
    level: int = logging.INFO,
    exception: BaseException | None = None,
    **fields: object,
) -> None:
    event_name = event if _SAFE_EVENT.fullmatch(event) else "logging.invalid_event"
    safe = sanitize_fields({**_current_context(), **fields})
    safe_trace = (
        [
            {
                "file": os.path.basename(frame.filename),
                "function": frame.name,
                "line": frame.lineno,
            }
            for frame in traceback.extract_tb(exception.__traceback__)
        ]
        if exception is not None and exception.__traceback__ is not None
        else []
    )
    try:
        logger.log(
            level,
            event_name,
            extra={
                "event_name": event_name,
                "event_fields": safe,
                "safe_trace": safe_trace,
            },
        )
    except Exception:  # noqa: BLE001 - logging must not change business behavior
        sys.stderr.write(
            '{"level":"ERROR","event":"logging.serialization_failed"}\n'
        )


def emit_progress_milestones(logger: logging.Logger, progress: int) -> None:
    bounded = max(0, min(100, progress))
    seen = set(_milestones.get())
    for milestone in _MILESTONES:
        if milestone <= bounded and milestone not in seen:
            emit(logger, "job.progress", progress=milestone)
            seen.add(milestone)
    _milestones.set(frozenset(seen))


def _timestamp(record: logging.LogRecord) -> str:
    return datetime.fromtimestamp(record.created, tz=UTC).isoformat(
        timespec="milliseconds"
    ).replace("+00:00", "Z")


def _record_event(record: logging.LogRecord) -> str:
    event = getattr(record, "event_name", None)
    if isinstance(event, str) and _SAFE_EVENT.fullmatch(event):
        return event
    return "log.message"


def _record_fields(record: logging.LogRecord) -> dict[str, LogValue]:
    fields = getattr(record, "event_fields", {})
    return sanitize_fields(fields if isinstance(fields, Mapping) else {})


def _safe_trace(record: logging.LogRecord) -> list[dict[str, str | int]] | None:
    frames = getattr(record, "safe_trace", None)
    return frames if isinstance(frames, list) and frames else None


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, object] = {
            "timestamp": _timestamp(record),
            "level": record.levelname,
            "event": _record_event(record),
            **_record_fields(record),
        }
        frames = _safe_trace(record)
        if frames:
            payload["trace"] = frames
        return json.dumps(payload, separators=(",", ":"), ensure_ascii=True)


class PrettyFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        fields = _record_fields(record)
        suffix = " ".join(f"{key}={value}" for key, value in fields.items())
        base = f"{_timestamp(record)} {record.levelname} {_record_event(record)}"
        frames = _safe_trace(record)
        if frames:
            suffix = " ".join((suffix, f"trace={json.dumps(frames, separators=(',', ':'))}"))
        return " ".join(part for part in (base, suffix) if part)


def configure_logging(
    env: Mapping[str, str] | None = None,
    stream: IO[str] | None = None,
) -> None:
    source = os.environ if env is None else env
    default_format = "json" if source.get("NODE_ENV") == "production" else "pretty"
    log_format = source.get("LOG_FORMAT", default_format).lower()
    if log_format not in {"pretty", "json"}:
        raise ValueError("LOG_FORMAT must be 'pretty' or 'json'")

    level_name = source.get("LOG_LEVEL", "INFO").upper()
    if level_name not in _LEVELS:
        raise ValueError(
            "LOG_LEVEL must be DEBUG, INFO, WARNING, ERROR, or CRITICAL"
        )

    handler = logging.StreamHandler(stream)
    handler.setFormatter(JsonFormatter() if log_format == "json" else PrettyFormatter())
    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(_LEVELS[level_name])
