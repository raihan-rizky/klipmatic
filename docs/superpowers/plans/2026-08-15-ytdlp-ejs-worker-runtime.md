# yt-dlp EJS Worker Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the downloader worker a reproducible Deno/EJS runtime so YouTube section downloads stop failing with HTTP 403, while making future failures safely diagnosable.

**Architecture:** Build the worker from a focused Dockerfile that layers pinned Deno and FFmpeg onto the existing `uv` Python image, then let Compose run the worker without boot-time package installation. Keep yt-dlp's public Python wrapper stable; extend only its stable error classification and replace the thumbnail handler's free-form exception log with the existing structured observability API.

**Tech Stack:** Docker Compose, multi-stage Docker builds, Deno 2.9.4, Python 3.12, uv, `yt-dlp[default]==2026.7.4`, pytest, Ruff.

## Global Constraints

- Preserve all unrelated dirty-worktree changes, especially the existing database connection change in `apps/downloader/app/worker.py`.
- Keep `yt-dlp` pinned at exactly `2026.7.4`; add its `default` dependency extra rather than enabling remote EJS downloads.
- Pin the worker JavaScript runtime to Deno `2.9.4`, which exceeds yt-dlp's minimum supported Deno `2.3.0`.
- Never log source URLs, signed Googlevideo URLs, raw yt-dlp stderr, local paths, or exception messages.
- Preserve the thumbnail handler's best-effort contract: one failed candidate does not fail the batch.
- Do not change format selection, ranking, storage, job retry semantics, or UI behavior.

---

## File Structure

- Create `apps/downloader/Dockerfile`: reproducible worker system runtime containing FFmpeg and pinned Deno.
- Modify `docker-compose.dev.yml`: build the worker Dockerfile and remove boot-time `apt-get` work.
- Modify `apps/downloader/pyproject.toml`: request yt-dlp's matching default EJS dependency set.
- Modify `apps/downloader/uv.lock`: lock the EJS companion package resolved by uv.
- Modify `apps/downloader/tests/test_compose_worker_config.py`: static packaging/dependency regression coverage.
- Modify `apps/downloader/app/ytdlp.py`: classify media-CDN HTTP 403 as retryable source blocking.
- Modify `apps/downloader/tests/test_ytdlp.py`: classification regression coverage.
- Modify `apps/downloader/app/handlers/prepare_thumbnails.py`: emit safe structured per-candidate failure events.
- Modify `apps/downloader/tests/test_prepare_thumbnails.py`: structured logging regression coverage.

### Task 1: Reproducible Worker Runtime and EJS Dependency

**Files:**
- Create: `apps/downloader/Dockerfile`
- Modify: `docker-compose.dev.yml`
- Modify: `apps/downloader/pyproject.toml`
- Modify: `apps/downloader/uv.lock`
- Test: `apps/downloader/tests/test_compose_worker_config.py`

**Interfaces:**
- Consumes: Docker Compose worker service and uv dependency resolution.
- Produces: a worker image with `deno` and `ffmpeg` on `PATH`, plus `yt-dlp-ejs` in `/venv`.

- [ ] **Step 1: Write failing packaging tests**

Append tests that describe the desired image and dependency contract:

```python
import tomllib


def test_worker_builds_image_with_pinned_deno_and_ffmpeg():
    dockerfile = (COMPOSE_FILE.parent / "apps" / "downloader" / "Dockerfile")
    compose = COMPOSE_FILE.read_text()

    assert "denoland/deno:bin-2.9.4" in dockerfile.read_text()
    assert "COPY --from=deno /deno /usr/local/bin/deno" in dockerfile.read_text()
    assert "apt-get install -y --no-install-recommends ffmpeg" in dockerfile.read_text()
    assert "deno --version" in dockerfile.read_text()
    assert "dockerfile: apps/downloader/Dockerfile" in compose
    assert "apt-get install -y -qq ffmpeg" not in compose


def test_worker_locks_default_ytdlp_ejs_dependencies():
    downloader = COMPOSE_FILE.parent / "apps" / "downloader"
    config = tomllib.loads((downloader / "pyproject.toml").read_text())
    lock = (downloader / "uv.lock").read_text()

    assert "yt-dlp[default]==2026.7.4" in config["project"]["dependencies"]
    assert 'name = "yt-dlp-ejs"' in lock
```

- [ ] **Step 2: Run the tests and confirm RED**

Run:

```powershell
Set-Location apps/downloader
uv run pytest tests/test_compose_worker_config.py -v
```

Expected: the Dockerfile test fails because the file does not exist, and the dependency test fails because the project still requests bare `yt-dlp`.

- [ ] **Step 3: Add the dedicated worker Dockerfile**

Create `apps/downloader/Dockerfile`:

```dockerfile
FROM denoland/deno:bin-2.9.4 AS deno

FROM ghcr.io/astral-sh/uv:python3.12-bookworm

COPY --from=deno /deno /usr/local/bin/deno

RUN apt-get update -qq \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && deno --version \
    && ffmpeg -version >/dev/null

WORKDIR /work/apps/downloader

CMD ["uv", "run", "python", "-m", "app.worker"]
```

- [ ] **Step 4: Point Compose at the worker image build**

Replace the worker's `image` and boot-time installer with:

```yaml
  worker:
    build:
      context: .
      dockerfile: apps/downloader/Dockerfile
    image: klipmatic-worker:dev
    # Preserve the existing restart, init, working_dir, environment, volumes,
    # depends_on, and stop_grace_period entries unchanged.
    command: uv run python -m app.worker
```

- [ ] **Step 5: Request and lock yt-dlp's default dependency group**

Change the Python dependency to:

```toml
"yt-dlp[default]==2026.7.4",
```

Then regenerate the lock without upgrading unrelated packages:

```powershell
Set-Location apps/downloader
uv lock
```

Inspect `uv.lock` and confirm it contains a `yt-dlp-ejs` package and records the `default` extra on the downloader project's yt-dlp requirement.

- [ ] **Step 6: Run targeted tests and confirm GREEN**

Run:

```powershell
Set-Location apps/downloader
uv run pytest tests/test_compose_worker_config.py -v
uv run ruff check tests/test_compose_worker_config.py
```

Expected: both commands pass with no warnings.

- [ ] **Step 7: Commit the packaging slice**

```powershell
git add apps/downloader/Dockerfile docker-compose.dev.yml apps/downloader/pyproject.toml apps/downloader/uv.lock apps/downloader/tests/test_compose_worker_config.py
git commit -m "fix(worker): add yt-dlp JavaScript runtime"
```

### Task 2: Classify YouTube Media 403 Failures

**Files:**
- Modify: `apps/downloader/app/ytdlp.py:15-27`
- Test: `apps/downloader/tests/test_ytdlp.py:32-52`

**Interfaces:**
- Consumes: `classify_ytdlp_error(stderr: str) -> JobError`.
- Produces: retryable `JobError(code="SOURCE_BLOCKED", terminal=False)` for HTTP 403 media failures.

- [ ] **Step 1: Add the failing classification case**

Add this row to the existing parametrized classifier test:

```python
(
    "HTTP error 403 Forbidden; Server returned 403 Forbidden (access denied)",
    "SOURCE_BLOCKED",
    False,
),
```

- [ ] **Step 2: Run the focused test and confirm RED**

```powershell
Set-Location apps/downloader
uv run pytest tests/test_ytdlp.py::test_classify_ytdlp_error -v
```

Expected: the new case fails because its actual code is `INTERNAL`.

- [ ] **Step 3: Extend the existing blocked-source pattern**

Change only the relevant `_ERROR_PATTERNS` entry:

```python
(
    r"not a bot|Sign in to confirm|too many requests|HTTP Error (?:403|429)|403 Forbidden",
    "SOURCE_BLOCKED",
    False,
),
```

- [ ] **Step 4: Run focused validation and confirm GREEN**

```powershell
Set-Location apps/downloader
uv run pytest tests/test_ytdlp.py -v
uv run ruff check app/ytdlp.py tests/test_ytdlp.py
```

Expected: classifier and all yt-dlp unit tests pass.

- [ ] **Step 5: Commit the classification slice**

```powershell
git add apps/downloader/app/ytdlp.py apps/downloader/tests/test_ytdlp.py
git commit -m "fix(worker): classify YouTube media 403 errors"
```

### Task 3: Structured Thumbnail Failure Events

**Files:**
- Modify: `apps/downloader/app/handlers/prepare_thumbnails.py:3-75`
- Test: `apps/downloader/tests/test_prepare_thumbnails.py:89-121`

**Interfaces:**
- Consumes: `emit(logger, event, *, level, exception, **fields)` and `JobError.code`.
- Produces: `thumbnail.failed` events with `candidate_id`, `error_code`, and `error_class` safe fields.

- [ ] **Step 1: Extend the existing batch-survival test with RED assertions**

Add `logging` and `caplog` to the test, then assert the event contract:

```python
def test_one_thumbnail_failure_does_not_fail_batch(conn, tmp_path, caplog):
    caplog.set_level(logging.INFO)
    # Keep the existing setup, flaky_download, handler call, and state assertions.

    events = [
        (record.event_name, record.event_fields)
        for record in caplog.records
        if hasattr(record, "event_name")
        and record.event_name == "thumbnail.failed"
    ]
    assert len(events) == 1
    assert events[0][1]["error_code"] == "SOURCE_BLOCKED"
    assert events[0][1]["error_class"] == "JobError"
    assert events[0][1]["candidate_id"]
    assert "temporary" not in caplog.text
```

- [ ] **Step 2: Run the focused test and confirm RED**

```powershell
Set-Location apps/downloader
uv run pytest tests/test_prepare_thumbnails.py::test_one_thumbnail_failure_does_not_fail_batch -v
```

Expected: the states remain correct, but no `thumbnail.failed` structured event exists.

- [ ] **Step 3: Replace free-form exception logging with safe structured logging**

Import `logging`, `emit`, and use the caught exception:

```python
import logging

from app.observability import emit

# ...
            except Exception as exc:  # noqa: BLE001 - satu thumbnail tidak membatalkan batch
                error_code = exc.code if isinstance(exc, JobError) else "INTERNAL"
                emit(
                    log,
                    "thumbnail.failed",
                    level=logging.ERROR,
                    exception=exc,
                    candidate_id=str(candidate_id),
                    error_code=error_code,
                    error_class=type(exc).__name__,
                )
```

Keep the existing failed-state database update directly after the event.

- [ ] **Step 4: Run focused validation and confirm GREEN**

```powershell
Set-Location apps/downloader
uv run pytest tests/test_prepare_thumbnails.py -v
uv run ruff check app/handlers/prepare_thumbnails.py tests/test_prepare_thumbnails.py
```

Expected: all thumbnail tests pass and Ruff reports no errors.

- [ ] **Step 5: Commit the observability slice**

```powershell
git add apps/downloader/app/handlers/prepare_thumbnails.py apps/downloader/tests/test_prepare_thumbnails.py
git commit -m "fix(worker): structure thumbnail failure logs"
```

### Task 4: Build and End-to-End Verification

**Files:**
- Verify only; do not persist diagnostic scripts or generated media.

**Interfaces:**
- Consumes: rebuilt `klipmatic-worker:dev`, the existing project row `48a38d8c-8999-4d78-8557-86b1ecf1b0b5`, and `app.ytdlp.download_section`.
- Produces: evidence that the original one-second section downloads successfully with Deno/EJS enabled.

- [ ] **Step 1: Validate the resolved Compose configuration**

```powershell
docker compose -f docker-compose.dev.yml config --quiet
```

Expected: exit code 0.

- [ ] **Step 2: Build and recreate the worker**

```powershell
docker compose -f docker-compose.dev.yml build worker
docker compose -f docker-compose.dev.yml up -d --force-recreate worker
docker compose -f docker-compose.dev.yml exec -T worker deno --version
docker compose -f docker-compose.dev.yml exec -T worker uv run python -c "import yt_dlp_ejs; print('yt-dlp-ejs=ready')"
```

Expected: Deno reports `2.9.4`, the EJS import prints `yt-dlp-ejs=ready`, and the worker stays running.

- [ ] **Step 3: Re-run the exact failing section without exposing its URL**

Execute a temporary in-container Python program through stdin. It queries the existing project and top candidate, computes the same thumbnail range, calls the production wrapper, prints only the output byte count, and deletes the temporary segment:

```powershell
@'
import os
import tempfile
from pathlib import Path

import psycopg

from app.ytdlp import download_section

project_id = "48a38d8c-8999-4d78-8557-86b1ecf1b0b5"
with psycopg.connect(os.environ["DATABASE_URL"], prepare_threshold=None) as conn:
    row = conn.execute(
        "select s.url_original, c.start_sec, c.end_sec "
        "from projects p join sources s on s.id=p.source_id "
        "join clip_candidates c on c.project_id=p.id "
        "where p.id=%s order by c.score desc, c.start_sec asc limit 1",
        (project_id,),
    ).fetchone()
start = float(row[1]) + min(2.0, (float(row[2]) - float(row[1])) * 0.2)
end = min(start + 1.0, float(row[2]))
dest = Path(tempfile.gettempdir()) / "codex-ytdlp-ejs-check.mp4"
download_section(str(row[0]), start, end, dest)
print(f"section_bytes={dest.stat().st_size}")
dest.unlink(missing_ok=True)
'@ | docker compose -f docker-compose.dev.yml exec -T worker uv run python -
```

Expected: exit code 0, `section_bytes` is greater than zero, and stderr has neither the missing-JavaScript-runtime warning nor HTTP 403.

- [ ] **Step 4: Run the downloader validation suite**

```powershell
Set-Location apps/downloader
uv run pytest tests/test_compose_worker_config.py tests/test_ytdlp.py tests/test_prepare_thumbnails.py tests/test_fetch_segments.py tests/test_subprocesses.py -v
uv run ruff check app tests
```

Expected: every test passes and Ruff reports no errors.

- [ ] **Step 5: Run full repository checks relevant to the changed configuration**

```powershell
Set-Location ../..
bun run test
docker compose -f docker-compose.dev.yml ps
docker compose -f docker-compose.dev.yml logs --tail 100 worker
```

Expected: repository tests pass, the worker is `Up`, and recent logs contain no startup loop, missing-runtime warning, raw URL, or blank `ERROR log.message` from thumbnail processing.

- [ ] **Step 6: Inspect the final diff and commit any verification-only correction**

```powershell
git diff --check
git status -sb
git diff -- apps/downloader/Dockerfile docker-compose.dev.yml apps/downloader/pyproject.toml apps/downloader/uv.lock apps/downloader/app/ytdlp.py apps/downloader/app/handlers/prepare_thumbnails.py apps/downloader/tests/test_compose_worker_config.py apps/downloader/tests/test_ytdlp.py apps/downloader/tests/test_prepare_thumbnails.py
```

Expected: no whitespace errors, no diagnostic media/scripts, and no unrelated file included in the implementation diff.
