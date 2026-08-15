from __future__ import annotations

import io
import json
import logging

import pytest

from app.observability import (
    bind_context,
    configure_logging,
    emit,
    emit_progress_milestones,
    reset_context,
    reset_progress_milestones,
)


def test_json_event_contains_context_and_drops_unsafe_fields():
    stream = io.StringIO()
    configure_logging({"LOG_FORMAT": "json", "LOG_LEVEL": "INFO"}, stream)
    token = bind_context(worker_id="w1", job_id="job-1")
    try:
        emit(
            logging.getLogger("test.observability"),
            "job.completed",
            api_key="secret",
            source_url="https://example.test/?token=secret",
            duration_ms=12,
        )
    finally:
        reset_context(token)

    record = json.loads(stream.getvalue())
    assert record["event"] == "job.completed"
    assert record["level"] == "INFO"
    assert record["worker_id"] == "w1"
    assert record["job_id"] == "job-1"
    assert record["duration_ms"] == 12
    assert "secret" not in stream.getvalue()
    assert "example.test" not in stream.getvalue()


def test_context_is_reset_after_job():
    stream = io.StringIO()
    configure_logging({"LOG_FORMAT": "json"}, stream)
    token = bind_context(job_id="first-job")
    reset_context(token)
    emit(logging.getLogger("test.observability"), "worker.started", worker_id="w1")
    assert "first-job" not in stream.getvalue()


def test_pretty_and_json_include_the_same_event_fields():
    json_stream = io.StringIO()
    configure_logging({"LOG_FORMAT": "json"}, json_stream)
    emit(logging.getLogger("test.observability"), "job.progress", progress=25)
    json_record = json.loads(json_stream.getvalue())

    pretty_stream = io.StringIO()
    configure_logging({"LOG_FORMAT": "pretty"}, pretty_stream)
    emit(logging.getLogger("test.observability"), "job.progress", progress=25)
    pretty = pretty_stream.getvalue()

    assert json_record["event"] in pretty
    assert f"progress={json_record['progress']}" in pretty
    assert json_record["level"] in pretty


def test_invalid_log_format_fails_fast():
    with pytest.raises(ValueError, match="LOG_FORMAT"):
        configure_logging({"LOG_FORMAT": "xml"}, io.StringIO())


def test_invalid_log_level_fails_fast():
    with pytest.raises(ValueError, match="LOG_LEVEL"):
        configure_logging({"LOG_LEVEL": "LOUD"}, io.StringIO())


def test_info_level_suppresses_debug_events():
    stream = io.StringIO()
    configure_logging({"LOG_FORMAT": "json", "LOG_LEVEL": "INFO"}, stream)
    emit(
        logging.getLogger("test.observability"),
        "debug.event",
        level=logging.DEBUG,
    )
    assert stream.getvalue() == ""


def test_progress_milestones_are_emitted_once():
    stream = io.StringIO()
    configure_logging({"LOG_FORMAT": "pretty", "LOG_LEVEL": "INFO"}, stream)
    reset_progress_milestones()
    for progress in (1, 24, 25, 49, 50, 51, 75, 100, 100):
        emit_progress_milestones(logging.getLogger("test.progress"), progress)

    lines = stream.getvalue().splitlines()
    assert [line.rsplit("progress=", 1)[1] for line in lines] == [
        "0",
        "25",
        "50",
        "75",
        "100",
    ]


def test_free_form_string_in_allowlisted_field_is_dropped():
    stream = io.StringIO()
    configure_logging({"LOG_FORMAT": "json"}, stream)
    emit(
        logging.getLogger("test.observability"),
        "job.failed",
        error_class="Error secret with spaces",
        error_code="INTERNAL",
    )
    record = json.loads(stream.getvalue())
    assert "error_class" not in record
    assert record["error_code"] == "INTERNAL"
