from __future__ import annotations

import logging
import subprocess

import pytest

from app.subprocesses import SubprocessSpan, run_command


def _events(caplog):
    return [
        (record.event_name, record.event_fields)
        for record in caplog.records
        if hasattr(record, "event_name")
    ]


def test_run_command_logs_safe_success(monkeypatch, caplog):
    caplog.set_level(logging.INFO)

    def fake_run(*_args, **_kwargs):
        return subprocess.CompletedProcess(
            ["yt-dlp", "https://example.test/watch?token=secret"],
            0,
            "private output",
            "secret error",
        )

    monkeypatch.setattr(subprocess, "run", fake_run)

    result = run_command(
        ["yt-dlp", "https://example.test/watch?token=secret"],
        tool="yt-dlp",
        operation="probe",
        timeout_sec=10,
    )

    assert result.returncode == 0
    events = _events(caplog)
    assert [name for name, _fields in events] == [
        "subprocess.started",
        "subprocess.completed",
    ]
    assert events[-1][1]["tool"] == "yt-dlp"
    assert events[-1][1]["operation"] == "probe"
    assert events[-1][1]["exit_code"] == 0
    assert events[-1][1]["duration_ms"] >= 0
    rendered = caplog.text + repr(events)
    assert "token=secret" not in rendered
    assert "private output" not in rendered
    assert "secret error" not in rendered


def test_run_command_logs_nonzero_exit(monkeypatch, caplog):
    caplog.set_level(logging.INFO)
    monkeypatch.setattr(
        subprocess,
        "run",
        lambda *_args, **_kwargs: subprocess.CompletedProcess(
            ["ffmpeg", "private-file.mp4"], 9, "", "private stderr"
        ),
    )

    result = run_command(
        ["ffmpeg", "private-file.mp4"],
        tool="ffmpeg",
        operation="extract_audio",
        timeout_sec=30,
    )

    assert result.returncode == 9
    event = _events(caplog)[-1]
    assert event[0] == "subprocess.failed"
    assert event[1]["exit_code"] == 9
    assert "private-file" not in caplog.text
    assert "private stderr" not in caplog.text


def test_run_command_logs_timeout_without_command(monkeypatch, caplog):
    caplog.set_level(logging.INFO)

    def timeout(*_args, **_kwargs):
        raise subprocess.TimeoutExpired(
            ["ffprobe", "sensitive-name.mp4"], timeout=4
        )

    monkeypatch.setattr(subprocess, "run", timeout)

    with pytest.raises(subprocess.TimeoutExpired):
        run_command(
            ["ffprobe", "sensitive-name.mp4"],
            tool="ffprobe",
            operation="probe_media",
            timeout_sec=4,
        )

    event = _events(caplog)[-1]
    assert event[0] == "subprocess.failed"
    assert event[1]["error_code"] == "TIMEOUT"
    assert event[1]["timeout_sec"] == 4
    assert "sensitive-name" not in caplog.text


def test_streaming_span_finishes_once(caplog):
    caplog.set_level(logging.INFO)

    with SubprocessSpan("yt-dlp", "download_audio", 3600) as span:
        span.finish(0)
        span.finish(0)

    assert [name for name, _fields in _events(caplog)] == [
        "subprocess.started",
        "subprocess.completed",
    ]


def test_streaming_span_logs_timeout(caplog):
    caplog.set_level(logging.INFO)

    with pytest.raises(subprocess.TimeoutExpired), SubprocessSpan(
        "yt-dlp", "download_audio", 2
    ):
        raise subprocess.TimeoutExpired("private command", timeout=2)

    event = _events(caplog)[-1]
    assert event[0] == "subprocess.failed"
    assert event[1]["error_code"] == "TIMEOUT"
    assert "private command" not in caplog.text
