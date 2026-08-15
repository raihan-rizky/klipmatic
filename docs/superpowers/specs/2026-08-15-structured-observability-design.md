# Structured Observability Design

**Date:** 2026-08-15

## Goal

Add detailed, correlated logging across the Next.js web application and the
Python worker pipeline. Logs must make one request or job traceable from its
entry point through database, storage, provider, `yt-dlp`, and FFmpeg
boundaries without exposing secrets or user content.

The target is boundary-level observability, not a log statement in every
function or polling iteration. A useful log should answer what happened, where,
for which operation, how long it took, and whether it succeeded.

## Scope

The implementation covers:

- Next.js route-handler request start, completion, and failure events.
- Worker startup, job claim, handler start, progress milestones, completion,
  retry, terminal failure, and unexpected exception events.
- External boundaries: database operations where they represent a workflow
  transition, object storage, transcription and LLM providers, `yt-dlp`,
  FFmpeg, and ffprobe.
- Correlation fields shared by events in the same request or job.
- Local human-readable output and production JSON output.
- Automated tests for event fields, timing, failure handling, and redaction.

The implementation does not add a hosted observability vendor, distributed
tracing backend, metrics collector, database query logging, browser interaction
telemetry, or persistence of logs in the application database.

## Architecture

### Web logging

A web logging module owns structured event construction and serialization. A
route wrapper creates or accepts an `x-request-id`, records a monotonic start
time, and emits request completion or failure with:

- `event`
- `level`
- `timestamp`
- `request_id`
- `method`
- normalized route name
- `status_code`
- `duration_ms`

Route handlers add safe domain identifiers and operation fields through the
wrapper context. They must not construct ad-hoc JSON log payloads.

The response includes the effective `x-request-id`, allowing a browser error
or support report to be matched to server logs. IDs supplied by callers are
accepted only when they match a conservative length and character policy;
otherwise the server generates a UUID.

Server components do not receive an HTTP response object, so page-load errors
use the same logger directly with known identifiers. Existing `console.error`
calls in covered server code migrate to the structured logger.

### Worker logging

A Python logging module configures output and supplies a context adapter. The
worker binds these fields as soon as it claims a job:

- `worker_id`
- `job_id`
- `job_type`
- `project_id`
- `attempt`

Handlers receive a logger carrying that context, either explicitly or through
a job-scoped context mechanism that is cleared after each job. Context must not
leak from one job to the next.

The worker emits lifecycle events at claim, handler start, completion, retry,
terminal failure, and unexpected exception. Durations use a monotonic clock.
Idle polling is not logged. Reaper events retain their current behavior but use
the shared structured format.

### Boundary instrumentation

Reusable wrappers instrument subprocess and external-service boundaries:

- Subprocess events identify the tool and operation, not the complete command.
  They record start, completion, `duration_ms`, exit code, and timeout.
- Provider events identify the provider and operation and record duration and
  a safe result summary such as response byte count or candidate count.
- Storage events identify the operation and bucket role plus duration and
  byte count when known. Full object keys are excluded.
- Database logs describe workflow transitions such as job claim or completion.
  Raw SQL, bind parameters, and driver error objects are excluded.

The existing provider, storage, FFmpeg, and `yt-dlp` public APIs stay stable
where practical. Instrumentation sits at shared boundary functions so handlers
do not duplicate start/end/error logging.

## Event Model

Events use stable dotted names. Initial names include:

- `http.request.completed`
- `http.request.failed`
- `worker.started`
- `job.claimed`
- `job.handler.started`
- `job.progress`
- `job.completed`
- `job.retry_scheduled`
- `job.failed`
- `subprocess.started`
- `subprocess.completed`
- `subprocess.failed`
- `provider.request.completed`
- `provider.request.failed`
- `storage.operation.completed`
- `storage.operation.failed`
- `reaper.jobs.completed`
- `reaper.assets.completed`

All records contain `event`, `level`, and `timestamp`. Contextual fields are
added only when available. Field names use snake case across TypeScript and
Python so records can be searched consistently.

Progress events are emitted when a job first reaches 0, 25, 50, 75, and 100
percent. Existing database heartbeats remain unchanged; logging is deduplicated
separately so frequent heartbeat writes do not create frequent log lines.

## Output and Configuration

`LOG_LEVEL` controls verbosity and defaults to `INFO`. `DEBUG` may include
additional safe diagnostics but follows the same redaction policy.

`LOG_FORMAT` accepts:

- `pretty` for concise, readable local development output.
- `json` for one JSON object per line in production and container logs.

Local development defaults to `pretty`. Production defaults to `json` when
`LOG_FORMAT` is unset. Invalid values fail fast at process startup with a clear
configuration error.

Example JSON event:

```json
{"timestamp":"2026-08-15T10:20:30.123Z","level":"INFO","event":"job.completed","worker_id":"local-1","job_id":"...","job_type":"analyze","project_id":"...","attempt":1,"duration_ms":18420,"candidate_count":10}
```

## Security and Redaction

Logging follows an allowlist model: only documented scalar fields may enter an
event. A shared sanitizer provides defense in depth and replaces values for
keys matching secret or credential patterns.

The following data must never be logged:

- API keys, authorization headers, cookies, passwords, and database URLs.
- Signed URLs, source URLs with query strings, or complete object-storage keys.
- SQL text, bind parameters, or complete database driver errors.
- Transcripts, prompts, LLM response bodies, captions, titles, filenames, and
  other user-provided content.
- Complete subprocess commands, stdout, or stderr.

Failures expose a stable error class or error code. Subprocess stderr is never
logged verbatim; it is represented by byte count, exit code, and a safe mapped
error code.

## Error Handling

Logging must never change the success or failure result of the operation being
observed. Serialization failures fall back to a minimal safe record on stderr.
Logging code does not retry business operations.

Unexpected worker exceptions retain stack traces in local pretty output. JSON
output records the exception class, safe error code, and stack trace as a
structured field without including unsafe exception attributes.

Timeouts are distinct failure outcomes and include `timeout_sec`. Retry events
include the next attempt and scheduled delay without duplicating the raw error.

## Testing

Tests are written before implementation and cover:

- Web request IDs are generated, validated, returned, and included in events.
- Web completion and failure events include status and duration.
- Worker job context is present on lifecycle and boundary events and is cleared
  before the next job.
- Progress logging emits milestones once while database heartbeat behavior is
  unchanged.
- Subprocess wrappers report success, non-zero exit, and timeout without
  logging commands, URLs, stdout, or stderr content.
- Provider and storage wrappers emit safe summaries for success and failure.
- Sanitization removes representative secrets, credentials, query strings,
  transcripts, and SQL parameters.
- Pretty and JSON formats represent the same event fields.
- Invalid logging configuration fails at startup.

Existing web and downloader suites must remain green. A focused integration
test runs one synthetic job through the worker with fake external boundaries
and asserts a correlated lifecycle from claim to completion.

## Rollout

Implementation proceeds in vertical slices:

1. Shared event model, formatters, configuration, and redaction tests.
2. Worker job lifecycle and progress milestones.
3. Worker subprocess, provider, storage, and reaper boundaries.
4. Web request wrapper and route migration.
5. Cross-component integration verification and documentation.

Each slice preserves current public behavior. No hosted logging dependency or
database migration is required.

## Success Criteria

- One failing or successful job can be followed by `job_id` from claim through
  all major worker boundaries.
- One web request can be followed by `request_id` and the ID is returned to the
  caller.
- INFO logs show meaningful lifecycle events without idle-poll or per-percent
  noise.
- Production logs are valid newline-delimited JSON.
- Tests demonstrate that secrets and user content do not enter logs.
- Existing tests, lint, type checks, and builds pass.
