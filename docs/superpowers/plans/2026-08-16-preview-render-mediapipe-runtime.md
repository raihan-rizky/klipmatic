# Preview Render MediaPipe Runtime Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the downloader worker load MediaPipe's face detector so pre-rendered candidate previews complete their face-aware 9:16 crop and upload.

**Architecture:** The worker's Debian runtime image installs `libgles2`, which supplies the missing `libGLESv2.so.2` shared library required by MediaPipe. A container smoke check verifies that the vendored model initializes at image build time. Preview-handler failures are emitted through the project's structured observability layer so production logs preserve safe diagnostics.

**Tech Stack:** Docker, Debian Bookworm, Python 3.12, MediaPipe, pytest, ruff.

## Global Constraints

- Preserve the existing face-aware crop behavior; do not silently switch to center crops.
- Do not alter yt-dlp download selection, retry behavior, or raw-error redaction.
- Logs may contain only safe structured fields and safe traceback metadata.
- Preserve the existing batch behavior: a failed candidate does not abort other candidates.

---

## File Structure

- `apps/downloader/Dockerfile`: installs the MediaPipe native runtime dependency and runs an image-build smoke check.
- `apps/downloader/app/handlers/render_previews.py`: emits structured per-candidate failure events.
- `apps/downloader/tests/test_render_previews.py`: proves failed candidate rendering produces a safe structured event.
- `apps/downloader/tests/test_worker_image.py`: verifies Dockerfile declares the runtime package and detector smoke check.

### Task 1: Lock the worker image's MediaPipe runtime contract

**Files:**
- Create: `apps/downloader/tests/test_worker_image.py`
- Modify: `apps/downloader/Dockerfile:7-14`

**Interfaces:**
- Consumes: `apps/downloader/app/face_focus.py::MODEL_PATH` and `_create_detector()`.
- Produces: an image that contains `libGLESv2.so.2` through Debian package `libgles2`, and fails its build if the detector cannot initialize.

- [ ] **Step 1: Write the failing Dockerfile contract test**

```python
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
DOCKERFILE = ROOT / "apps/downloader/Dockerfile"


def test_worker_image_installs_mediapipe_gles_runtime_and_smoke_checks_detector():
    dockerfile = DOCKERFILE.read_text(encoding="utf-8")

    assert "libgles2" in dockerfile
    assert "from app.face_focus import _create_detector" in dockerfile
    assert "_create_detector().close()" in dockerfile
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `uv run --directory apps/downloader pytest tests/test_worker_image.py -q`

Expected: FAIL because `libgles2` and the detector smoke-check command do not exist in the Dockerfile.

- [ ] **Step 3: Add the minimal Docker runtime dependency and build-time smoke check**

```dockerfile
RUN apt-get update -qq \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates libgles2 \
    && rm -rf /var/lib/apt/lists/* \
    && deno --version \
    && ffmpeg -version >/dev/null

COPY apps/downloader /work/apps/downloader
RUN uv sync --locked --no-dev \
    && uv run python -c "from app.face_focus import _create_detector; _create_detector().close()"
```

Keep the repository mount and worker command unchanged; the smoke check belongs after the downloader source is copied and dependencies are synchronized.

- [ ] **Step 4: Run the contract test to verify it passes**

Run: `uv run --directory apps/downloader pytest tests/test_worker_image.py -q`

Expected: PASS.

- [ ] **Step 5: Build the worker image and verify detector initialization**

Run: `docker compose -f docker-compose.dev.yml build worker`

Expected: build exits 0; the `uv run python -c` layer initializes and closes the detector without `libGLESv2.so.2` errors.

- [ ] **Step 6: Commit the image contract**

```bash
git add apps/downloader/Dockerfile apps/downloader/tests/test_worker_image.py
git commit -m "fix(worker): install mediapipe GLES runtime"
```

### Task 2: Make preview failures structured and diagnosable

**Files:**
- Modify: `apps/downloader/app/handlers/render_previews.py:18-23,123-131`
- Modify: `apps/downloader/tests/test_render_previews.py:1-5,109-149`

**Interfaces:**
- Consumes: `app.observability.emit(logger, event, *, level, exception, **fields)`.
- Produces: `preview.failed` log event with safe `candidate_id`, `error_code`, `error_class`, and safe traceback metadata.

- [ ] **Step 1: Write the failing structured-event test**

```python
import logging


def test_failed_candidate_emits_structured_safe_event(conn, tmp_path, caplog):
    uid, _sid, pid, ids = setup_project_with_candidates(conn, count=1)
    caplog.set_level(logging.INFO)

    render_previews.handle_render_previews(
        conn,
        render_job(conn, uid, pid),
        storage=MagicMock(),
        download=lambda *_args: (_ for _ in ()).throw(RuntimeError("boom")),
        workdir=tmp_path,
    )

    record = next(record for record in caplog.records if record.event_name == "preview.failed")
    assert record.event_fields["candidate_id"] == ids[0]
    assert record.event_fields["error_code"] == "INTERNAL"
    assert record.event_fields["error_class"] == "RuntimeError"
    assert record.safe_trace
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `uv run --directory apps/downloader pytest tests/test_render_previews.py::test_failed_candidate_emits_structured_safe_event -q`

Expected: FAIL because the handler uses Python's unstructured `log.exception`, so no record has `event_name == "preview.failed"`.

- [ ] **Step 3: Replace the unstructured exception logger with `emit`**

```python
from app.observability import emit

# inside the per-candidate except block
emit(
    log,
    "preview.failed",
    level=logging.ERROR,
    exception=exc,
    candidate_id=cid,
    error_code=error_code,
    error_class=type(exc).__name__,
)
```

Keep the status update to `failed`, commit, and heartbeat exactly as they are.

- [ ] **Step 4: Run the focused handler tests to verify they pass**

Run: `uv run --directory apps/downloader pytest tests/test_render_previews.py -q`

Expected: PASS, including candidate isolation and the new structured-event case.

- [ ] **Step 5: Commit the observability fix**

```bash
git add apps/downloader/app/handlers/render_previews.py apps/downloader/tests/test_render_previews.py
git commit -m "fix(worker): log preview render failures structurally"
```

### Task 3: Validate the repaired pipeline

**Files:**
- Modify: no source changes expected.

**Interfaces:**
- Consumes: rebuilt `worker` image and the existing compose worker service.
- Produces: a worker able to initialize face focus and publish ready preview artifacts.

- [ ] **Step 1: Run the downloader validation suite**

Run: `uv run --directory apps/downloader pytest tests/test_render_previews.py tests/test_face_focus.py tests/test_ffmpeg.py tests/test_worker_image.py -q`

Expected: PASS.

- [ ] **Step 2: Run downloader lint**

Run: `uv run --directory apps/downloader ruff check app tests`

Expected: PASS with no diagnostics.

- [ ] **Step 3: Recreate the worker with the rebuilt image**

Run: `docker compose -f docker-compose.dev.yml up -d --force-recreate worker`

Expected: worker starts and logs `worker.started`; no MediaPipe shared-library failure occurs.

- [ ] **Step 4: Verify an actual preview render after the worker restart**

Run: query the candidate rows for a newly enqueued `render_previews` job and inspect `docker compose -f docker-compose.dev.yml logs worker --tail 200`.

Expected: successful candidates become `preview_status = 'ready'` with a `previews/<sha256>.mp4` key; `crop_vertical` and storage upload events follow successful frame extraction.

- [ ] **Step 5: Commit no validation-only changes**

Do not create a commit unless an additional source change is required by a failing validation.

## Self-review

- Spec coverage: Task 1 fixes and verifies the missing OS dependency; Task 2 removes the blind `log.message` failure mode; Task 3 proves both focused behavior and running-worker behavior.
- Placeholder scan: no unresolved requirements or vague implementation steps remain.
- Type consistency: Task 2 uses `emit`'s established signature and only safe fields defined by `app.observability`.
