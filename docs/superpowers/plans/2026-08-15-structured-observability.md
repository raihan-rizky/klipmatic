# Structured Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add safe, correlated, boundary-level structured logging to the Next.js web application and Python worker pipeline.

**Architecture:** Each runtime gets one focused observability module that owns configuration, formatting, context, timing, and redaction. Worker lifecycle and external boundaries emit stable events through the Python module; Next.js route handlers use a wrapper that owns request IDs, response headers, status, duration, and thrown-error logging.

**Tech Stack:** Python 3.12 standard `logging` and `contextvars`, pytest, TypeScript, Next.js 15 route handlers, Vitest.

## Global Constraints

- Instrument important boundaries, not every function, heartbeat, or idle poll.
- `LOG_LEVEL` defaults to `INFO`.
- `LOG_FORMAT` accepts only `pretty` and `json`; local defaults to `pretty`, production defaults to `json`.
- Production output is newline-delimited JSON.
- Field names use snake case in both runtimes.
- Never log API keys, authorization headers, cookies, passwords, database URLs, signed URLs, URL query strings, full object keys, SQL text, bind parameters, transcripts, prompts, response bodies, captions, titles, filenames, complete subprocess commands, stdout, or stderr.
- Logging failure must never alter the observed operation's business result.
- No hosted observability dependency, metrics backend, browser telemetry, log database, or database migration.
- Existing public APIs stay stable where practical.
- All implementation follows red-green-refactor TDD.

---

## File Structure

### New files

- `apps/downloader/app/observability.py`: Python configuration, structured formatter, context binding, safe event emission, duration helper, and milestone deduplication.
- `apps/downloader/app/subprocesses.py`: safe logged wrappers for completed and streaming subprocesses.
- `apps/downloader/tests/test_observability.py`: Python formatter, configuration, context, redaction, and milestone tests.
- `apps/downloader/tests/test_subprocesses.py`: subprocess success, failure, timeout, and redaction tests.
- `apps/web/lib/observability.ts`: TypeScript event model, sanitizer, formatter, request logger, and route wrapper.
- `apps/web/test/observability.test.ts`: TypeScript formatting, request ID, duration, error, and redaction tests.
- `apps/web/test/projectRoute.test.ts`: project-route request correlation and redaction tests.
- `apps/downloader/tests/test_observability_integration.py`: synthetic correlated worker lifecycle test.

### Modified files

- `apps/downloader/app/worker.py`: bind job context and emit lifecycle events.
- `apps/downloader/app/queue.py`: emit deduplicated progress milestones after successful heartbeats.
- `apps/downloader/app/ffmpeg.py`: route ffprobe and FFmpeg calls through logged subprocess helpers.
- `apps/downloader/app/ytdlp.py`: route completed and streaming yt-dlp calls through logged subprocess helpers.
- `apps/downloader/app/storage.py`: emit safe storage completion and failure events.
- `apps/downloader/app/providers/transcription.py`: emit provider attempt outcomes without bodies or credentials.
- `apps/downloader/app/providers/llm.py`: emit LLM attempt outcomes without prompts, URLs, bodies, or credentials.
- `apps/downloader/app/providers/youtube_captions.py`: emit caption-provider outcomes without transcript content.
- `apps/downloader/app/reaper.py`: emit reaper summaries through the structured logger.
- `apps/downloader/tests/test_worker.py`, `test_queue.py`, `test_ffmpeg.py`, `test_ytdlp.py`, `test_storage.py`, `test_transcription.py`, `test_llm.py`, `test_youtube_captions.py`, and `test_reaper.py`: focused instrumentation assertions while preserving behavior tests.
- `apps/web/app/api/**/route.ts`: wrap all API route exports and replace ad-hoc server errors with request-scoped events.
- `apps/web/app/auth/callback/route.ts`: use the request wrapper for callback failures.
- Existing route test files under `apps/web/test/`: assert request IDs and structured completion/failure events.
- `.env.example`: document `LOG_LEVEL` and `LOG_FORMAT`.
- `README.md`: document local/production output and safe correlation workflow.

---

### Task 1: Python observability core

**Files:**
- Create: `apps/downloader/app/observability.py`
- Create: `apps/downloader/tests/test_observability.py`

**Interfaces:**
- Produces: `configure_logging(env=None, stream=None) -> None`
- Produces: `bind_context(**fields) -> contextvars.Token`
- Produces: `reset_context(token) -> None`
- Produces: `emit(logger, event, *, level=logging.INFO, **fields) -> None`
- Produces: `elapsed_ms(started: float) -> int`
- Produces: `reset_progress_milestones() -> None`
- Produces: `emit_progress_milestones(logger, progress: int) -> None`

- [ ] **Step 1: Write failing formatter, context, config, and redaction tests**

```python
def test_json_event_contains_context_and_redacts_secret():
    stream = io.StringIO()
    configure_logging({"LOG_FORMAT": "json", "LOG_LEVEL": "INFO"}, stream)
    token = bind_context(worker_id="w1", job_id="job-1")
    try:
        emit(logging.getLogger("test"), "job.completed", api_key="secret", duration_ms=12)
    finally:
        reset_context(token)
    record = json.loads(stream.getvalue())
    assert record["event"] == "job.completed"
    assert record["worker_id"] == "w1"
    assert record["job_id"] == "job-1"
    assert record["duration_ms"] == 12
    assert "secret" not in stream.getvalue()


def test_invalid_log_format_fails_fast():
    with pytest.raises(ValueError, match="LOG_FORMAT"):
        configure_logging({"LOG_FORMAT": "xml"}, io.StringIO())


def test_info_level_suppresses_debug_events():
    stream = io.StringIO()
    configure_logging({"LOG_FORMAT": "json", "LOG_LEVEL": "INFO"}, stream)
    emit(logging.getLogger("test"), "debug.event", level=logging.DEBUG)
    assert stream.getvalue() == ""


def test_progress_milestones_are_emitted_once(caplog):
    reset_progress_milestones()
    for progress in (1, 24, 25, 49, 50, 51, 75, 100, 100):
        emit_progress_milestones(logging.getLogger("test"), progress)
    assert [r.__dict__["event_fields"]["progress"] for r in caplog.records] == [0, 25, 50, 75, 100]
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `cd apps/downloader && uv run pytest tests/test_observability.py -q`

Expected: FAIL because `app.observability` does not exist.

- [ ] **Step 3: Implement the minimal Python observability module**

```python
_context: ContextVar[dict[str, object]] = ContextVar("log_context", default={})
_milestones: ContextVar[set[int]] = ContextVar("log_milestones", default=set())
_allowed_formats = {"pretty", "json"}
_safe_field_keys = {
    "worker_id", "job_id", "job_type", "project_id", "attempt",
    "request_id", "method", "route", "status_code", "duration_ms",
    "progress", "error_code", "error_class", "next_attempt",
    "retry_delay_sec", "tool", "operation", "timeout_sec", "exit_code",
    "provider", "byte_count", "result_count", "candidate_count",
    "reaped_count", "bucket_role", "asset_id", "clip_id", "candidate_id",
}
_safe_token = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")
_safe_route = re.compile(r"^/[A-Za-z0-9_./\[\]-]{1,200}$")


def emit(logger: logging.Logger, event: str, *, level: int = logging.INFO, **fields: object) -> None:
    safe = sanitize_fields({**_context.get(), **fields})
    try:
        logger.log(level, event, extra={"event_name": event, "event_fields": safe})
    except Exception:
        sys.stderr.write('{"level":"ERROR","event":"logging.serialization_failed"}\n')


def emit_progress_milestones(logger: logging.Logger, progress: int) -> None:
    reached = max(m for m in (0, 25, 50, 75, 100) if progress >= m)
    seen = set(_milestones.get())
    for milestone in (m for m in (0, 25, 50, 75, 100) if m <= reached and m not in seen):
        emit(logger, "job.progress", progress=milestone)
        seen.add(milestone)
    _milestones.set(seen)
```

Implement `sanitize_fields()` so numeric, boolean, and null values pass only for allowlisted keys; string values must additionally match `_safe_token`, except static route values which match `_safe_route`. Invalid strings are dropped, never truncated. Implement `JsonFormatter` and `PrettyFormatter` so both serialize the same base fields: UTC `timestamp`, uppercase `level`, `event`, then sanitized context/event fields. `configure_logging()` replaces root handlers deterministically in tests, parses `LOG_LEVEL`, and selects the environment-sensitive default format.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `cd apps/downloader && uv run pytest tests/test_observability.py -q`

Expected: PASS with no secret values in captured output.

- [ ] **Step 5: Commit the Python observability core**

```bash
git add apps/downloader/app/observability.py apps/downloader/tests/test_observability.py
git commit -m "feat(worker): add structured logging core"
```

---

### Task 2: Worker lifecycle and progress correlation

**Files:**
- Modify: `apps/downloader/app/worker.py`
- Modify: `apps/downloader/app/queue.py`
- Modify: `apps/downloader/tests/test_worker.py`
- Modify: `apps/downloader/tests/test_queue.py`

**Interfaces:**
- Consumes: `configure_logging`, `bind_context`, `reset_context`, `emit`, `elapsed_ms`, `reset_progress_milestones`, and `emit_progress_milestones` from Task 1.
- Produces: lifecycle events carrying `worker_id`, `job_id`, `job_type`, `project_id`, and `attempt`.

- [ ] **Step 1: Write failing lifecycle and progress tests**

```python
def test_run_once_logs_correlated_success(conn, caplog):
    job_id = enqueue(conn, "ingest", {}, project_id=None)
    run_once(conn, "w1", {"ingest": lambda _conn, _job: None})
    events = [(r.__dict__["event_name"], r.__dict__["event_fields"]) for r in caplog.records]
    assert [name for name, _ in events] == ["job.claimed", "job.handler.started", "job.completed"]
    assert all(fields["job_id"] == job_id for _, fields in events)
    assert all(fields["worker_id"] == "w1" for _, fields in events)
    assert events[-1][1]["duration_ms"] >= 0


def test_heartbeat_logs_only_crossed_milestones(conn, caplog):
    job_id = enqueue(conn, "ingest", {})
    run_once(conn, "w1", {"ingest": lambda c, j: [heartbeat(c, j.id, p) for p in (5, 25, 26, 75, 100)]})
    progress = [r.__dict__["event_fields"]["progress"] for r in caplog.records if r.__dict__.get("event_name") == "job.progress"]
    assert progress == [0, 25, 50, 75, 100]
```

Add separate assertions for `job.retry_scheduled`, terminal `job.failed`, unexpected exception class, and context clearing between two jobs.

- [ ] **Step 2: Run focused worker and queue tests and verify RED**

Run: `cd apps/downloader && uv run pytest tests/test_worker.py tests/test_queue.py -q`

Expected: FAIL because lifecycle and progress events are absent.

- [ ] **Step 3: Bind job context and emit lifecycle events**

```python
started = time.monotonic()
token = bind_context(
    worker_id=worker_id,
    job_id=job.id,
    job_type=job.type,
    project_id=job.project_id,
    attempt=job.attempts,
)
reset_progress_milestones()
try:
    emit(log, "job.claimed")
    emit(log, "job.handler.started")
    handler(conn, job)
    complete_job(conn, job.id)
    emit(log, "job.completed", duration_ms=elapsed_ms(started))
finally:
    reset_context(token)
```

For a non-terminal failure below `max_attempts`, emit `job.retry_scheduled` with `error_code`, `next_attempt`, and the backoff delay calculated from `BACKOFF_BASE_SEC` and `BACKOFF_FACTOR`. For terminal/dead jobs emit `job.failed`. In pretty local output, preserve normal stack traces. In JSON output, serialize only traceback frame filename, function, and line number from `traceback.extract_tb`; exclude exception messages, source lines, locals, and exception attributes.

Call `emit_progress_milestones(log, progress)` only after the heartbeat transaction commits. Replace `logging.basicConfig` in `main()` with `configure_logging()` and emit `worker.started`.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `cd apps/downloader && uv run pytest tests/test_worker.py tests/test_queue.py tests/test_observability.py -q`

Expected: PASS; existing status and retry assertions remain unchanged.

- [ ] **Step 5: Commit worker lifecycle logging**

```bash
git add apps/downloader/app/worker.py apps/downloader/app/queue.py apps/downloader/tests/test_worker.py apps/downloader/tests/test_queue.py
git commit -m "feat(worker): log correlated job lifecycle"
```

---

### Task 3: Safe subprocess instrumentation

**Files:**
- Create: `apps/downloader/app/subprocesses.py`
- Create: `apps/downloader/tests/test_subprocesses.py`
- Modify: `apps/downloader/app/ffmpeg.py`
- Modify: `apps/downloader/app/ytdlp.py`
- Modify: `apps/downloader/tests/test_ffmpeg.py`
- Modify: `apps/downloader/tests/test_ytdlp.py`

**Interfaces:**
- Consumes: `emit` and `elapsed_ms` from Task 1.
- Produces: `run_command(args, *, tool, operation, timeout_sec) -> subprocess.CompletedProcess[str]`.
- Produces: `SubprocessSpan(tool, operation, timeout_sec)` with `finish(exit_code) -> None` and context-manager failure/timeout logging.

- [ ] **Step 1: Write failing subprocess event and redaction tests**

```python
def test_run_command_logs_tool_not_command(monkeypatch, caplog):
    monkeypatch.setattr(subprocess, "run", lambda *a, **k: subprocess.CompletedProcess(a[0], 0, "private output", "secret error"))
    result = run_command(["yt-dlp", "https://example.test/watch?token=secret"], tool="yt-dlp", operation="probe", timeout_sec=10)
    assert result.returncode == 0
    rendered = " ".join(r.getMessage() + repr(r.__dict__.get("event_fields")) for r in caplog.records)
    assert "subprocess.started" in rendered
    assert "subprocess.completed" in rendered
    assert "yt-dlp" in rendered
    assert "token=secret" not in rendered
    assert "private output" not in rendered
    assert "secret error" not in rendered
```

Add non-zero and `subprocess.TimeoutExpired` cases asserting `exit_code`, `timeout_sec`, and `duration_ms` without arguments or captured content.

- [ ] **Step 2: Run subprocess tests and verify RED**

Run: `cd apps/downloader && uv run pytest tests/test_subprocesses.py -q`

Expected: FAIL because `app.subprocesses` does not exist.

- [ ] **Step 3: Implement wrappers and migrate FFmpeg/yt-dlp boundaries**

```python
def run_command(args: Sequence[str], *, tool: str, operation: str, timeout_sec: int) -> subprocess.CompletedProcess[str]:
    started = time.monotonic()
    emit(log, "subprocess.started", tool=tool, operation=operation, timeout_sec=timeout_sec)
    try:
        proc = subprocess.run(list(args), capture_output=True, text=True, timeout=timeout_sec)
    except subprocess.TimeoutExpired:
        emit(log, "subprocess.failed", tool=tool, operation=operation, timeout_sec=timeout_sec, duration_ms=elapsed_ms(started), error_code="TIMEOUT")
        raise
    event = "subprocess.completed" if proc.returncode == 0 else "subprocess.failed"
    emit(log, event, tool=tool, operation=operation, exit_code=proc.returncode, duration_ms=elapsed_ms(started))
    return proc
```

Map ffprobe, audio extraction, thumbnail extraction, yt-dlp probe, and section download to explicit safe operation names. Wrap streaming audio download with `SubprocessSpan`; call `finish(proc.returncode)` exactly once after `wait()`. Keep existing `JobError` classifications and captured-output behavior unchanged.

- [ ] **Step 4: Run subprocess, FFmpeg, and yt-dlp tests and verify GREEN**

Run: `cd apps/downloader && uv run pytest tests/test_subprocesses.py tests/test_ffmpeg.py tests/test_ytdlp.py -q`

Expected: PASS; log captures contain no URL, path, stdout, or stderr content.

- [ ] **Step 5: Commit subprocess instrumentation**

```bash
git add apps/downloader/app/subprocesses.py apps/downloader/app/ffmpeg.py apps/downloader/app/ytdlp.py apps/downloader/tests/test_subprocesses.py apps/downloader/tests/test_ffmpeg.py apps/downloader/tests/test_ytdlp.py
git commit -m "feat(worker): instrument media subprocesses"
```

---

### Task 4: Provider, storage, and reaper boundaries

**Files:**
- Modify: `apps/downloader/app/storage.py`
- Modify: `apps/downloader/app/providers/transcription.py`
- Modify: `apps/downloader/app/providers/llm.py`
- Modify: `apps/downloader/app/providers/youtube_captions.py`
- Modify: `apps/downloader/app/reaper.py`
- Modify: `apps/downloader/tests/test_storage.py`
- Modify: `apps/downloader/tests/test_transcription.py`
- Modify: `apps/downloader/tests/test_llm.py`
- Modify: `apps/downloader/tests/test_youtube_captions.py`
- Modify: `apps/downloader/tests/test_reaper.py`

**Interfaces:**
- Consumes: `emit` and `elapsed_ms` from Task 1.
- Produces: stable `provider.request.*`, `storage.operation.*`, and `reaper.*` events with only allowlisted summaries.

- [ ] **Step 1: Write failing boundary tests**

```python
def test_storage_put_logs_safe_summary(storage, tmp_path, caplog):
    path = tmp_path / "private-name.mp4"
    path.write_bytes(b"abc")
    storage.put_file("users/private/object.mp4", path, "video/mp4")
    fields = next(r.__dict__["event_fields"] for r in caplog.records if r.__dict__.get("event_name") == "storage.operation.completed")
    assert fields == {"operation": "put_file", "byte_count": 3, "duration_ms": fields["duration_ms"]}
    assert "private-name" not in caplog.text
    assert "users/private" not in caplog.text
```

Add tests covering provider success/failure status and duration, fallback attempt number, response size/count where safe, reaper zero/non-zero summaries, and absence of prompts, transcripts, provider URLs, object keys, and error bodies.

- [ ] **Step 2: Run focused boundary tests and verify RED**

Run: `cd apps/downloader && uv run pytest tests/test_storage.py tests/test_transcription.py tests/test_llm.py tests/test_youtube_captions.py tests/test_reaper.py -q`

Expected: FAIL because structured boundary events are absent.

- [ ] **Step 3: Instrument boundary completion and failure paths**

Use one monotonic timer per attempted operation. For transcription fallback, instrument the existing `_call` boundary as follows:

```python
for attempt, cfg in enumerate(chain, start=1):
    started = time.monotonic()
    try:
        result = _call(cfg, audio, model, client)
    except JobError as error:
        emit(
            log,
            "provider.request.failed",
            provider=cfg.name,
            operation="transcribe",
            attempt=attempt,
            duration_ms=elapsed_ms(started),
            error_code=error.code,
        )
        errors.append(f"{cfg.name}: {error}")
        continue
    emit(
        log,
        "provider.request.completed",
        provider=cfg.name,
        operation="transcribe",
        attempt=attempt,
        duration_ms=elapsed_ms(started),
        result_count=len(result.words),
    )
    return TranscriptResult(
        language=result.language,
        text=result.text,
        words=result.words,
        provider=cfg.name,
        model=model,
        cost_usd=estimate_cost(cfg, duration_sec),
    )
```

For storage, log operation name, static `bucket_role="media"`, duration, and byte count when known; never bucket name, endpoint, key, or path. For LLM, log provider family but not model if it can be user-supplied. For reapers, emit one summary after a successful commit with `reaped_count` and operation; emit a safe failure before re-raising.

- [ ] **Step 4: Run focused boundary tests and verify GREEN**

Run: `cd apps/downloader && uv run pytest tests/test_storage.py tests/test_transcription.py tests/test_llm.py tests/test_youtube_captions.py tests/test_reaper.py -q`

Expected: PASS with provider fallback and storage behavior unchanged.

- [ ] **Step 5: Commit external-boundary logging**

```bash
git add apps/downloader/app/storage.py apps/downloader/app/providers apps/downloader/app/reaper.py apps/downloader/tests/test_storage.py apps/downloader/tests/test_transcription.py apps/downloader/tests/test_llm.py apps/downloader/tests/test_youtube_captions.py apps/downloader/tests/test_reaper.py
git commit -m "feat(worker): log provider and storage boundaries"
```

---

### Task 5: TypeScript observability core and request wrapper

**Files:**
- Create: `apps/web/lib/observability.ts`
- Create: `apps/web/test/observability.test.ts`

**Interfaces:**
- Produces: `type SafeLogValue = string | number | boolean | null`
- Produces: `type RequestLogger = { requestId: string; info(event, fields?): void; error(event, fields?): void }`
- Produces: `parseLogConfig(env) -> { level: LogLevel; format: 'pretty' | 'json' }`
- Produces: `writeEvent(level, event, fields?) -> void`
- Produces: `withRequestLogging<TContext>(route, handler) -> Next route handler`

- [ ] **Step 1: Write failing config, formatting, redaction, and wrapper tests**

```typescript
test('returns and logs one validated request id', async () => {
  const output = vi.spyOn(console, 'info').mockImplementation(() => undefined)
  const handler = withRequestLogging('/api/example', async (_request, _context, log) => {
    log.info('example.work', { project_id: 'p1' })
    return Response.json({ ok: true }, { status: 201 })
  })
  const response = await handler(new Request('http://local/api/example', {
    headers: { 'x-request-id': 'request-123' },
  }), {})
  expect(response.headers.get('x-request-id')).toBe('request-123')
  expect(output.mock.calls.flat().join(' ')).toContain('request-123')
  expect(output.mock.calls.flat().join(' ')).toContain('duration_ms')
})

test('drops unsafe fields and values', () => {
  writeEvent('INFO', 'safe.event', {
    api_key: 'secret',
    source_url: 'https://example.test/?token=secret',
    project_id: 'p1',
  })
  expect(captured()).toContain('project_id')
  expect(captured()).not.toContain('secret')
  expect(captured()).not.toContain('example.test')
})
```

Also test invalid IDs generate UUIDs, thrown handlers emit `http.request.failed` and rethrow, returned 500 responses emit completion with status, JSON/pretty field parity, production default JSON, and invalid `LOG_FORMAT` failure.

- [ ] **Step 2: Run observability tests and verify RED**

Run: `bun x vitest run apps/web/test/observability.test.ts`

Expected: FAIL because `@/lib/observability` does not exist.

- [ ] **Step 3: Implement the TypeScript logger and route wrapper**

```typescript
const REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/
const SAFE_FIELD_KEYS = new Set([
  'request_id', 'method', 'route', 'status_code', 'duration_ms',
  'project_id', 'job_id', 'asset_id', 'clip_id', 'candidate_id',
  'operation', 'error_code', 'error_class', 'byte_count', 'result_count',
  'bucket_role',
])
const SAFE_TOKEN = /^[A-Za-z0-9._:-]{1,128}$/
const SAFE_ROUTE = /^\/[A-Za-z0-9_./\[\]-]{1,200}$/

export function withRequestLogging<TContext>(
  route: string,
  handler: (request: Request, context: TContext, log: RequestLogger) => Promise<Response>,
) {
  return async (request: Request, context: TContext): Promise<Response> => {
    const supplied = request.headers.get('x-request-id') ?? ''
    const requestId = REQUEST_ID.test(supplied) ? supplied : crypto.randomUUID()
    const started = performance.now()
    const log = requestLogger(requestId)
    try {
      const response = await handler(request, context, log)
      writeEvent('INFO', 'http.request.completed', {
        request_id: requestId,
        method: request.method,
        route,
        status_code: response.status,
        duration_ms: Math.round(performance.now() - started),
      })
      response.headers.set('x-request-id', requestId)
      return response
    } catch (error) {
      writeEvent('ERROR', 'http.request.failed', {
        request_id: requestId,
        method: request.method,
        route,
        duration_ms: Math.round(performance.now() - started),
        error_class: error instanceof Error ? error.constructor.name : typeof error,
      })
      throw error
    }
  }
}
```

Make `writeEvent` accept only scalar values whose keys appear in `SAFE_FIELD_KEYS`. String values must match `SAFE_TOKEN`, except static routes which match `SAFE_ROUTE`; drop invalid values instead of truncating them. Serialize a fresh UTC timestamp and fall back to a minimal safe `logging.serialization_failed` line if formatting throws. Unknown keys are dropped even when their names look harmless. Do not include `request.url`. Evaluate `const LOG_CONFIG = parseLogConfig(process.env)` at module import so invalid production configuration fails before a handler processes traffic, and apply level filtering before formatting.

- [ ] **Step 4: Run focused tests and type-check**

Run: `bun x vitest run apps/web/test/observability.test.ts`

Expected: PASS.

Run: `bun --cwd apps/web run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit the web observability core**

```bash
git add apps/web/lib/observability.ts apps/web/test/observability.test.ts
git commit -m "feat(web): add structured request logging"
```

---

### Task 6: Migrate all server routes to request-scoped logging

**Files:**
- Modify: `apps/web/app/api/projects/route.ts`
- Modify: `apps/web/app/api/clips/route.ts`
- Modify: `apps/web/app/api/clips/[id]/route.ts`
- Modify: `apps/web/app/api/clips/[id]/segment/route.ts`
- Modify: `apps/web/app/api/clips/[id]/preview/route.ts`
- Modify: `apps/web/app/api/candidates/[id]/thumbnail/route.ts`
- Modify: `apps/web/app/api/assets/[id]/content/route.ts`
- Modify: `apps/web/app/api/keys/route.ts`
- Modify: `apps/web/app/api/keys/[id]/route.ts`
- Modify: `apps/web/app/api/projects/[id]/assets/route.ts`
- Modify: `apps/web/app/api/projects/[id]/assets/[assetId]/route.ts`
- Modify: `apps/web/app/api/projects/[id]/assets/[assetId]/complete/route.ts`
- Modify: `apps/web/app/auth/callback/route.ts`
- Modify: `apps/web/app/projects/[id]/page.tsx`
- Create: `apps/web/test/projectRoute.test.ts`
- Modify: relevant route tests in `apps/web/test/`

**Interfaces:**
- Consumes: `withRequestLogging` and `RequestLogger` from Task 5.
- Produces: request IDs and consistent completion/failure events for every server route.

- [ ] **Step 1: Add failing route-level correlation tests**

For each route-test family, add one representative assertion that the exported handler returns `x-request-id` and logs its normalized static route, status, and safe domain IDs. Add a project-route failure assertion proving a source URL and error object are absent:

```typescript
test('project route correlates safe failure without source URL', async () => {
  const output = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  const response = await POST(new Request('http://local/api/projects', {
    method: 'POST',
    headers: { 'x-request-id': 'req-project' },
    body: JSON.stringify({ url: 'https://youtube.test/watch?token=secret' }),
  }), {})
  expect(response.headers.get('x-request-id')).toBe('req-project')
  expect(output.mock.calls.flat().join(' ')).not.toContain('token=secret')
})
```

- [ ] **Step 2: Run route tests and verify RED**

Run: `bun x vitest run apps/web/test/projectRoute.test.ts apps/web/test/clipPreviewRoute.test.ts apps/web/test/candidateThumbnailRoute.test.ts apps/web/test/segmentRoute.test.ts apps/web/test/mediaAssetRoutes.test.ts apps/web/test/apiKeys.test.ts`

Expected: FAIL because route exports do not return request IDs or structured events.

- [ ] **Step 3: Wrap every route export and replace ad-hoc logging**

Use this form consistently, preserving each Next.js context type and response behavior:

```typescript
export const POST = withRequestLogging('/api/projects', async (req, _context, log) => {
  const supabase = await supabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Silakan masuk dulu.' } },
      { status: 401 },
    )
  }

  const body = (await req.json().catch(() => null)) as { url?: unknown } | null
  if (typeof body?.url !== 'string' || !body.url.trim()) {
    return NextResponse.json(
      { error: { code: 'SOURCE_UNSUPPORTED', message: messageFor('SOURCE_UNSUPPORTED') } },
      { status: 400 },
    )
  }

  try {
    const result = await createProjectFromUrl(sql, user.id, body.url)
    log.info('project.created', { project_id: result.projectId, job_id: result.jobId })
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    log.error('project.create.failed', { error_class: describeError(error) })
    return NextResponse.json({ error: { code: 'INTERNAL', message: messageFor('INTERNAL') } }, { status: 500 })
  }
})
```

Never log user IDs, request bodies, URLs, asset keys, filenames, or raw errors. Use static normalized route strings such as `/api/clips/[id]`, never `request.url`. Keep `describeError()` only for safe error class/code fields.

Wrap the project server component's data-loading block in `try/catch`; emit `page.project.failed` with only `project_id` and `error_class`, then rethrow so the existing Next.js error boundary remains responsible for the UI.

- [ ] **Step 4: Run all web tests, type-check, and build**

Run: `bun x vitest run apps/web/test`

Expected: PASS.

Run: `bun --cwd apps/web run typecheck`

Expected: PASS.

Run: `bun run build`

Expected: PASS.

- [ ] **Step 5: Commit route migration**

```bash
git add apps/web/app/api apps/web/app/auth/callback/route.ts apps/web/test
git commit -m "feat(web): correlate server route logs"
```

---

### Task 7: Cross-component integration, configuration, and final validation

**Files:**
- Create: `apps/downloader/tests/test_observability_integration.py`
- Modify: `.env.example`
- Modify: `README.md`

**Interfaces:**
- Consumes: all event and correlation interfaces from Tasks 1–6.
- Produces: documented configuration and a synthetic end-to-end worker log contract.

- [ ] **Step 1: Write the failing synthetic worker integration test**

```python
def test_synthetic_job_has_one_correlated_lifecycle(conn, caplog):
    job_id = enqueue(conn, "ingest", {"source_id": "safe"})
    run_once(conn, "integration-worker", {"ingest": lambda c, j: heartbeat(c, j.id, 100)})
    records = [r.__dict__["event_fields"] | {"event": r.__dict__["event_name"]} for r in caplog.records if r.__dict__.get("event_name", "").startswith("job.")]
    assert [r["event"] for r in records] == [
        "job.claimed",
        "job.handler.started",
        "job.progress",
        "job.progress",
        "job.progress",
        "job.progress",
        "job.progress",
        "job.completed",
    ]
    assert {r["job_id"] for r in records} == {job_id}
    assert {r["worker_id"] for r in records} == {"integration-worker"}
```

- [ ] **Step 2: Run the integration contract**

Run: `cd apps/downloader && uv run pytest tests/test_observability_integration.py -q`

Expected: PASS. If it fails, return to the task that owns the missing event or context; do not duplicate lifecycle logging in the integration test task.

- [ ] **Step 3: Document exact environment behavior and operator workflow**

Add to `.env.example`:

```dotenv
# Logging: pretty for local terminals, json for production/container ingestion.
LOG_LEVEL=INFO
LOG_FORMAT=pretty
```

Add a README section with these concrete examples:

```text
LOG_FORMAT=json LOG_LEVEL=INFO bun run dev
docker compose -f docker-compose.dev.yml logs -f worker
```

Explain that `x-request-id` correlates web requests and `job_id` correlates worker operations, list the milestone policy, and state that raw content, URLs, commands, stdout, stderr, SQL, and credentials are intentionally excluded.

- [ ] **Step 4: Run full validation**

Run: `cd apps/downloader && uv run pytest -q`

Expected: all downloader tests PASS.

Run: `cd apps/downloader && uv run ruff check app tests`

Expected: PASS. If Ruff is not installed in the locked dev group, add it to `[dependency-groups].dev`, run `uv lock`, and rerun this exact command.

Run: `bun run test`

Expected: all Vitest workspaces PASS.

Run: `bun run typecheck`

Expected: PASS.

Run: `bun run build`

Expected: PASS.

Run: `git diff --check`

Expected: no whitespace errors.

- [ ] **Step 5: Run formatter smoke checks without user data**

Run: `cd apps/downloader && uv run pytest tests/test_observability.py::test_json_event_contains_context_and_redacts_secret tests/test_observability_integration.py -q`

Expected: PASS with only synthetic IDs and payloads.

Run: `bun x vitest run apps/web/test/observability.test.ts apps/web/test/projectRoute.test.ts`

Expected: PASS; JSON records parse and the synthetic `smoke-request` ID is echoed without any request URL or body.

- [ ] **Step 6: Commit integration coverage and documentation**

```bash
git add apps/downloader/tests/test_observability_integration.py .env.example README.md apps/downloader/pyproject.toml apps/downloader/uv.lock
git commit -m "docs: document structured observability"
```

---

## Final Review Checklist

- [ ] Every success, failure, retry, and timeout event has a stable dotted name.
- [ ] Every worker boundary record inherits job correlation fields.
- [ ] Every server response includes its effective `x-request-id`.
- [ ] Idle polls and per-percent heartbeat noise are absent.
- [ ] Tests prove secrets and user content are absent from pretty and JSON output.
- [ ] Logging failures cannot change business outcomes.
- [ ] Full Python and TypeScript validation is green.
- [ ] Manual smoke output is valid newline-delimited JSON in production mode.
