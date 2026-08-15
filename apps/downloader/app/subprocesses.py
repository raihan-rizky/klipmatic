from __future__ import annotations

import logging
import subprocess
import time
from collections.abc import Sequence
from types import TracebackType
from typing import Self

from app.observability import elapsed_ms, emit

log = logging.getLogger(__name__)


class SubprocessSpan:
    def __init__(self, tool: str, operation: str, timeout_sec: int):
        self.tool = tool
        self.operation = operation
        self.timeout_sec = timeout_sec
        self._started = 0.0
        self._finished = False

    def __enter__(self) -> Self:
        self._started = time.monotonic()
        emit(
            log,
            "subprocess.started",
            tool=self.tool,
            operation=self.operation,
            timeout_sec=self.timeout_sec,
        )
        return self

    def finish(self, exit_code: int) -> None:
        if self._finished:
            return
        self._finished = True
        emit(
            log,
            "subprocess.completed" if exit_code == 0 else "subprocess.failed",
            level=logging.INFO if exit_code == 0 else logging.ERROR,
            tool=self.tool,
            operation=self.operation,
            exit_code=exit_code,
            duration_ms=elapsed_ms(self._started),
        )

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        _traceback: TracebackType | None,
    ) -> bool:
        if self._finished:
            return False
        self._finished = True
        fields: dict[str, object] = {
            "tool": self.tool,
            "operation": self.operation,
            "duration_ms": elapsed_ms(self._started),
        }
        if isinstance(exc_value, subprocess.TimeoutExpired):
            fields["error_code"] = "TIMEOUT"
            fields["timeout_sec"] = self.timeout_sec
        elif exc_type is not None:
            fields["error_code"] = "SUBPROCESS_ERROR"
            fields["error_class"] = exc_type.__name__
        else:
            fields["error_code"] = "EXIT_UNKNOWN"
        emit(log, "subprocess.failed", level=logging.ERROR, **fields)
        return False


def run_command(
    args: Sequence[str],
    *,
    tool: str,
    operation: str,
    timeout_sec: int,
) -> subprocess.CompletedProcess[str]:
    with SubprocessSpan(tool, operation, timeout_sec) as span:
        proc = subprocess.run(
            list(args),
            capture_output=True,
            text=True,
            timeout=timeout_sec,
            check=False,
        )
        span.finish(proc.returncode)
        return proc
