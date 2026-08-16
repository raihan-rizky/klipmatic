# Top-10 Preview Download Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make all Top-10 thumbnails and 9:16 previews from one download per candidate, retry temporary YouTube blocks, and recover the affected project.

**Architecture:** `render_previews` becomes the single Top-10 media pipeline and checkpoints thumbnail/preview readiness independently. A bounded local retry handles short `SOURCE_BLOCKED` bursts; unresolved temporary blocks bubble to the queue so later attempts process only incomplete outputs. Web pipeline watchers move from the retired enqueue path `prepare_thumbnails` to `render_previews`.

**Tech Stack:** Python 3.11+, psycopg 3, pytest, yt-dlp, FFmpeg, MediaPipe, Next.js 15, React 19, TypeScript, Vitest, Docker Compose

## Global Constraints

- Download each Top-10 candidate at most once per render attempt, reusing the local segment for both outputs.
- Keep the legacy `prepare_thumbnails` handler and database job type registered for deployment compatibility, but do not enqueue it for new analyses.
- Preserve content-addressed keys `candidate-thumbnails/{sha256}.webp` and `previews/{sha256}.mp4`.
- Never log source URLs, signed media URLs, raw yt-dlp stderr, or local paths.
- Keep successful output checkpoints across job retries and skip candidates whose two outputs are already ready.
- Do not change face detection, crop geometry, candidate scoring, or visual UI.
- Preserve unrelated dirty-worktree changes; stage only task-owned hunks if committing.

---

## File Map

- `apps/downloader/app/handlers/analyze.py`: enqueue only the combined render job.
- `apps/downloader/app/handlers/render_previews.py`: own one-download/two-output rendering, local retry, pacing, checkpoints, and retry escalation.
- `apps/downloader/tests/test_analyze_handler.py`: enqueue regression coverage.
- `apps/downloader/tests/test_render_previews.py`: combined output, checkpoint, retry, and isolation coverage.
- `apps/web/components/jobProgressLabel.ts`: pure pipeline type/reload contract shared by UI and tests.
- `apps/web/components/JobProgress.tsx`: observe terminal `render_previews` stage.
- `apps/web/lib/candidates.ts`: ownership-checked latest render job status and result gating.
- `apps/web/app/projects/[id]/page.tsx`: consume render job state.
- `apps/web/test/jobProgress.test.ts`: pipeline terminal helper coverage.
- `apps/web/test/candidates.test.ts`: render-job ownership and result-gate coverage.

### Task 1: Stop enqueueing duplicate thumbnail downloads

**Files:**
- Modify: `apps/downloader/tests/test_analyze_handler.py`
- Modify: `apps/downloader/app/handlers/analyze.py`

**Interfaces:**
- Consumes: `_write_candidates(conn, project_id, source_id, llm_run_id, candidates, words, job, storage)`.
- Produces: exactly one active `render_previews` job per project and zero new `prepare_thumbnails` jobs.

- [ ] **Step 1: Replace thumbnail enqueue expectations with a failing absence test**

Replace `test_analyze_enqueues_thumbnail_job` and
`test_analyze_retry_keeps_one_active_thumbnail_job` with:

```python
def test_analyze_does_not_enqueue_legacy_thumbnail_job(conn, deps):
    uid, sid, pid = _setup(conn, external_id="analysis-no-thumb-job")
    handle_analyze(conn, _job(conn, sid, pid, uid), **deps)

    count = conn.execute(
        "select count(*) from jobs where type='prepare_thumbnails' and project_id=%s",
        (pid,),
    ).fetchone()[0]
    assert count == 0
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
Set-Location apps/downloader
uv run pytest tests/test_analyze_handler.py::test_analyze_does_not_enqueue_legacy_thumbnail_job -v
```

Expected: FAIL because `_write_candidates` still inserts `prepare_thumbnails`.

- [ ] **Step 3: Remove only the legacy enqueue block**

Delete `active_thumbnail_job = ...` through its conditional insert from
`_write_candidates`. Keep old thumbnail object cleanup and the active
`render_previews` deduplication unchanged.

- [ ] **Step 4: Verify GREEN and analyze regressions**

Run:

```powershell
uv run pytest tests/test_analyze_handler.py -v
uv run ruff check app/handlers/analyze.py tests/test_analyze_handler.py
```

Expected: all tests PASS and Ruff reports no errors.

- [ ] **Step 5: Commit only task-owned hunks**

```powershell
git add apps/downloader/app/handlers/analyze.py apps/downloader/tests/test_analyze_handler.py
git commit -m "fix(worker): enqueue one top-10 media pipeline"
```

### Task 2: Produce thumbnail and preview from one segment

**Files:**
- Modify: `apps/downloader/tests/test_render_previews.py`
- Modify: `apps/downloader/app/handlers/render_previews.py`

**Interfaces:**
- Consumes: `extract_thumbnail(src: Path, dest: Path) -> Path`, `sha256_file(path: Path) -> str`, `Storage.put_file(key, path, content_type)`.
- Produces: `handle_render_previews(..., extract_thumbnail: Callable[[Path, Path], Path] = _default_extract_thumbnail, ...) -> None` with independent thumbnail and preview checkpoints.

- [ ] **Step 1: Add a failing one-download/two-output test**

Add a fake thumbnail helper and regression:

```python
def fake_extract_thumbnail(_src: Path, dest: Path) -> Path:
    dest.write_bytes(b"thumbnail")
    return dest


def test_one_download_produces_thumbnail_and_preview(conn, tmp_path):
    uid, _sid, pid, _ids = setup_project_with_candidates(conn, count=1)
    storage = MagicMock()
    downloads = 0

    def fake_download(_url, _start, _end, dest):
        nonlocal downloads
        downloads += 1
        dest.write_bytes(b"video")
        return dest

    render_previews.handle_render_previews(
        conn,
        render_job(conn, uid, pid),
        storage=storage,
        download=fake_download,
        extract_thumbnail=fake_extract_thumbnail,
        extract_frames=fake_extract_frames,
        compute_focus=lambda _frames: 0.5,
        crop=fake_crop,
        workdir=tmp_path,
    )

    row = conn.execute(
        "select thumbnail_status, thumbnail_r2_key, preview_status, preview_r2_key "
        "from clip_candidates where project_id=%s",
        (pid,),
    ).fetchone()
    assert downloads == 1
    assert row[0] == "ready"
    assert str(row[1]).startswith("candidate-thumbnails/")
    assert row[2] == "ready"
    assert str(row[3]).startswith("previews/")
    assert {call.args[2] for call in storage.put_file.call_args_list} == {
        "image/webp",
        "video/mp4",
    }
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
uv run pytest tests/test_render_previews.py::test_one_download_produces_thumbnail_and_preview -v
```

Expected: FAIL because `handle_render_previews` has no `extract_thumbnail`
parameter and never updates thumbnail columns.

- [ ] **Step 3: Extend the candidate query and combined render path**

Import the existing helper:

```python
from app.ffmpeg import extract_thumbnail as _default_extract_thumbnail
```

Add the dependency parameter:

```python
extract_thumbnail: Callable[[Path, Path], Path] = _default_extract_thumbnail,
```

Select `thumbnail_status` and `preview_status` with each candidate. For each
row, compute:

```python
needs_thumbnail = thumbnail_status != "ready"
needs_preview = preview_status != "ready"
if not needs_thumbnail and not needs_preview:
    heartbeat(conn, job.id, (index + 1) * 100 // len(rows))
    continue
```

Download once. If `needs_thumbnail`, extract to `<cid>_thumbnail.webp`, upload
`candidate-thumbnails/{sha256}.webp`, then update only the thumbnail columns.
If `needs_preview`, run the existing frames/focus/crop path and update only the
preview columns. Wrap the two output stages in separate `try/except` blocks so
one post-download failure does not suppress the other output.

- [ ] **Step 4: Add and verify a ready-checkpoint test**

```python
def test_ready_outputs_are_skipped_without_download(conn, tmp_path):
    uid, _sid, pid, _ids = setup_project_with_candidates(conn, count=1)
    conn.execute(
        "update clip_candidates set thumbnail_status='ready', "
        "thumbnail_r2_key='candidate-thumbnails/ready.webp', "
        "preview_status='ready', preview_r2_key='previews/ready.mp4' "
        "where project_id=%s",
        (pid,),
    )
    conn.commit()
    download = MagicMock()

    render_previews.handle_render_previews(
        conn,
        render_job(conn, uid, pid),
        storage=MagicMock(),
        download=download,
        workdir=tmp_path,
    )

    download.assert_not_called()
```

Run:

```powershell
uv run pytest tests/test_render_previews.py -v
uv run ruff check app/handlers/render_previews.py tests/test_render_previews.py
```

Expected: combined-output and existing render tests PASS.

- [ ] **Step 5: Commit only task-owned hunks**

```powershell
git add apps/downloader/app/handlers/render_previews.py apps/downloader/tests/test_render_previews.py
git commit -m "fix(worker): reuse candidate segments for thumbnails"
```

### Task 3: Retry temporary blocks and checkpoint partial success

**Files:**
- Modify: `apps/downloader/tests/test_render_previews.py`
- Modify: `apps/downloader/app/handlers/render_previews.py`

**Interfaces:**
- Produces: `_download_with_retry(download, url, start, end, dest, *, sleep, jitter) -> Path`.
- Produces constants `LOCAL_RETRY_DELAYS_SEC = (2.0, 4.0)` and `INTER_CANDIDATE_DELAY_SEC = 2.0`.
- Extends `handle_render_previews` with injectable `sleep: Callable[[float], None] = time.sleep` and `jitter: Callable[[], float] = random.random`.

- [ ] **Step 1: Add a failing bounded-retry unit test**

Add `import pytest` and `from app.errors import JobError` to the test module,
then add:

```python
def test_download_retries_source_block_with_backoff(tmp_path):
    dest = tmp_path / "segment.mp4"
    attempts = 0
    sleeps: list[float] = []

    def flaky(_url, _start, _end, target):
        nonlocal attempts
        attempts += 1
        if attempts < 3:
            raise JobError("SOURCE_BLOCKED", "redacted", terminal=False)
        target.write_bytes(b"video")
        return target

    result = render_previews._download_with_retry(
        flaky,
        "https://example.test/redacted",
        0,
        10,
        dest,
        sleep=sleeps.append,
        jitter=lambda: 0.0,
    )

    assert result == dest
    assert attempts == 3
    assert sleeps == [2.0, 4.0]
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
uv run pytest tests/test_render_previews.py::test_download_retries_source_block_with_backoff -v
```

Expected: FAIL because `_download_with_retry` does not exist.

- [ ] **Step 3: Implement retry and inter-candidate pacing**

Implement the helper so only non-terminal `SOURCE_BLOCKED` errors retry. Add
`jitter()` to each retry delay. Re-raise all other errors immediately. Before
each actual candidate download after the first, call:

```python
sleep(INTER_CANDIDATE_DELAY_SEC + jitter())
```

Pass the same injected functions to `_download_with_retry`. Update all existing
handler tests to pass `sleep=lambda _delay: None` and `jitter=lambda: 0.0` so
unit tests never wait.

- [ ] **Step 4: Add a failing batch-escalation test**

```python
def test_exhausted_source_block_retries_job_after_other_candidates(conn, tmp_path):
    uid, _sid, pid, ids = setup_project_with_candidates(conn, count=2)

    def selective_download(_url, start, _end, dest):
        if float(start) == 0.0:
            raise JobError("SOURCE_BLOCKED", "redacted", terminal=False)
        dest.write_bytes(b"video")
        return dest

    with pytest.raises(JobError) as error:
        render_previews.handle_render_previews(
            conn,
            render_job(conn, uid, pid),
            storage=MagicMock(),
            download=selective_download,
            extract_thumbnail=fake_extract_thumbnail,
            extract_frames=fake_extract_frames,
            compute_focus=lambda _frames: 0.5,
            crop=fake_crop,
            sleep=lambda _delay: None,
            jitter=lambda: 0.0,
            workdir=tmp_path,
        )

    assert error.value.code == "SOURCE_BLOCKED"
    assert error.value.terminal is False
    rows = conn.execute(
        "select id, thumbnail_status, preview_status from clip_candidates "
        "where project_id=%s order by score desc",
        (pid,),
    ).fetchall()
    states = {str(row[0]): (row[1], row[2]) for row in rows}
    assert states[ids[0]] == ("failed", "failed")
    assert states[ids[1]] == ("ready", "ready")
```

- [ ] **Step 5: Escalate unresolved temporary errors after the batch**

Track the first exhausted non-terminal `SOURCE_BLOCKED` error while continuing
the remaining candidates. Mark only needed outputs failed. After the loop and
heartbeats finish, raise a new safe error without raw stderr:

```python
if retryable_source_error is not None:
    raise JobError(
        "SOURCE_BLOCKED",
        "satu atau lebih kandidat masih diblokir sementara",
        terminal=False,
    )
```

- [ ] **Step 6: Verify retry, isolation, structured logs, and lint**

Run:

```powershell
uv run pytest tests/test_render_previews.py tests/test_prepare_thumbnails.py tests/test_worker.py -v
uv run ruff check app/handlers/render_previews.py tests/test_render_previews.py
```

Expected: all PASS; raw `redacted` detail is absent from structured log text.

- [ ] **Step 7: Commit only task-owned hunks**

```powershell
git add apps/downloader/app/handlers/render_previews.py apps/downloader/tests/test_render_previews.py
git commit -m "fix(worker): retry blocked preview downloads"
```

### Task 4: Move web pipeline gating to render_previews

**Files:**
- Modify: `apps/web/components/jobProgressLabel.ts`
- Modify: `apps/web/components/JobProgress.tsx`
- Modify: `apps/web/lib/candidates.ts`
- Modify: `apps/web/app/projects/[id]/page.tsx`
- Modify: `apps/web/test/jobProgress.test.ts`
- Modify: `apps/web/test/candidates.test.ts`

**Interfaces:**
- Produces: `PIPELINE_TYPES = ['ingest', 'transcribe', 'analyze', 'render_previews'] as const`.
- Produces: `PipelineJobType` from `PIPELINE_TYPES`.
- Produces: `shouldReloadForTerminalPipelineJob(type, status) -> boolean`.
- Renames: `latestThumbnailJobStatus` to `latestPreviewJobStatus`.
- Renames: `projectViewState({ thumbnailJobStatus })` argument to `previewJobStatus`.

- [ ] **Step 1: Add failing pure pipeline contract tests**

In `apps/web/test/jobProgress.test.ts`:

```typescript
import {
  PIPELINE_TYPES,
  progressLabel,
  shouldReloadForTerminalPipelineJob,
} from '../components/jobProgressLabel'

test('render_previews is the terminal pipeline stage', () => {
  expect(PIPELINE_TYPES).toEqual(['ingest', 'transcribe', 'analyze', 'render_previews'])
  expect(shouldReloadForTerminalPipelineJob('render_previews', 'done')).toBe(true)
  expect(shouldReloadForTerminalPipelineJob('render_previews', 'dead')).toBe(true)
  expect(shouldReloadForTerminalPipelineJob('analyze', 'done')).toBe(false)
})
```

- [ ] **Step 2: Convert candidate job tests to the combined render job**

Change the ownership test to insert `render_previews` and call
`latestPreviewJobStatus`. Rename test state arguments to `previewJobStatus` and
keep the same queued/running versus terminal expectations.

- [ ] **Step 3: Run focused web tests and verify RED**

Run:

```powershell
bun x vitest run apps/web/test/jobProgress.test.ts apps/web/test/candidates.test.ts
```

Expected: FAIL because exports/helper names and the watched job type still use
`prepare_thumbnails`.

- [ ] **Step 4: Implement the pure terminal-stage contract**

Add to `jobProgressLabel.ts`:

```typescript
export const PIPELINE_TYPES = ['ingest', 'transcribe', 'analyze', 'render_previews'] as const
export type PipelineJobType = (typeof PIPELINE_TYPES)[number]

export function shouldReloadForTerminalPipelineJob(
  type: PipelineJobType,
  status: JobState['status'],
): boolean {
  return type === 'render_previews' && ['done', 'failed', 'dead'].includes(status)
}
```

Import these values in `JobProgress.tsx`, remove its local type/constant, and use
the helper for reload. Keep the four existing labels and presentation intact.

- [ ] **Step 5: Implement the ownership-checked render job gate**

Rename `latestThumbnailJobStatus` to `latestPreviewJobStatus`, query
`j.type = 'render_previews'`, rename `thumbnailJobStatus` to `previewJobStatus`
inside `projectViewState`, and update the project page import/local/argument.

- [ ] **Step 6: Verify focused tests and types**

Run:

```powershell
bun x vitest run apps/web/test/jobProgress.test.ts apps/web/test/candidates.test.ts
bun --cwd apps/web run typecheck
```

Expected: tests and TypeScript PASS.

- [ ] **Step 7: Commit only task-owned hunks**

`JobProgress.tsx` already has an unrelated dirty style hunk. Stage only the
pipeline wiring hunks (for example with `git add -p`) and leave the style hunk
untouched.

```powershell
git add -p apps/web/components/JobProgress.tsx
git add apps/web/components/jobProgressLabel.ts apps/web/lib/candidates.ts apps/web/app/projects/[id]/page.tsx apps/web/test/jobProgress.test.ts apps/web/test/candidates.test.ts
git commit -m "fix(web): follow combined preview render stage"
```

### Task 5: Full validation, rebuild, and targeted recovery

**Files:**
- No production file changes expected.
- Runtime state: only project `085468cf-e6a6-4571-92b2-6c9753c4ce9f` receives a new `render_previews` job.

**Interfaces:**
- Consumes: worker queue, Docker Compose worker image, Postgres project ownership, MinIO media objects.
- Produces: Top-10 candidates with both output statuses ready and readable storage objects.

- [ ] **Step 1: Run downloader validation**

```powershell
Set-Location apps/downloader
uv run pytest tests/test_analyze_handler.py tests/test_render_previews.py tests/test_prepare_thumbnails.py tests/test_worker.py tests/test_ytdlp.py -v
uv run ruff check app tests
Set-Location ../..
```

Expected: all tests PASS and Ruff reports no errors.

- [ ] **Step 2: Run web and repository validation**

```powershell
bun x vitest run apps/web/test/jobProgress.test.ts apps/web/test/candidates.test.ts
bun run typecheck
bun run test
```

Expected: focused and full suites PASS. If unrelated pre-existing failures exist,
record them with exact test names and prove focused suites remain green.

- [ ] **Step 3: Rebuild and restart only the worker**

```powershell
docker compose -f docker-compose.dev.yml build worker
docker compose -f docker-compose.dev.yml up -d --no-deps worker
docker compose -f docker-compose.dev.yml ps worker
```

Expected: `cheapclipper-worker-1` is Up with the rebuilt image.

- [ ] **Step 4: Enqueue targeted recovery without touching editor jobs**

Run this idempotent snippet. It selects the project's owner, refuses to proceed
if the project is absent, avoids a duplicate active render job, and does not
reset or delete existing jobs or candidates:

```powershell
@'
import json
import os
import psycopg

project_id = "085468cf-e6a6-4571-92b2-6c9753c4ce9f"
with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
    owner = conn.execute(
        "select user_id from projects where id=%s",
        (project_id,),
    ).fetchone()
    if owner is None:
        raise SystemExit("project recovery target tidak ditemukan")
    active = conn.execute(
        "select id from jobs where type='render_previews' and project_id=%s "
        "and status in ('queued','running') order by created_at desc limit 1",
        (project_id,),
    ).fetchone()
    if active is not None:
        job_id = str(active[0])
    else:
        job_id = str(conn.execute(
            "insert into jobs (type,payload,user_id,project_id) "
            "values ('render_previews',%s::jsonb,%s,%s) returning id",
            (json.dumps({"project_id": project_id}), owner[0], project_id),
        ).fetchone()[0])
        conn.commit()
print(f"recovery_job_id={job_id}")
'@ | docker compose -f docker-compose.dev.yml exec -T worker uv run python -
```

Expected: one `recovery_job_id` is printed.

- [ ] **Step 5: Monitor to a terminal outcome**

Poll the newest job with the following read-only command and inspect worker logs:

```powershell
@'
import os
import psycopg

project_id = "085468cf-e6a6-4571-92b2-6c9753c4ce9f"
with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
    row = conn.execute(
        "select id,status,attempts,error_code,run_after from jobs "
        "where type='render_previews' and project_id=%s "
        "order by created_at desc limit 1",
        (project_id,),
    ).fetchone()
print(row)
'@ | docker compose -f docker-compose.dev.yml exec -T worker uv run python -
docker compose -f docker-compose.dev.yml logs --tail=120 worker
```

Repeat at intervals no longer than 30 seconds while status is `queued` or
`running`. Success requires `done`; `failed` or `dead` requires returning to
systematic debugging.

- [ ] **Step 6: Verify database and storage invariants**

Query the ranked Top-10 and assert:

```text
count(*) = 10
count(*) filter (where thumbnail_status = 'ready') = 10
count(*) filter (where preview_status = 'ready') = 10
count(*) filter (where thumbnail_r2_key is not null) = 10
count(*) filter (where preview_r2_key is not null) = 10
```

For every distinct key, call `Storage.exists(key)` inside the worker:

```powershell
@'
import os
import psycopg
from app.storage import storage_from_env

project_id = "085468cf-e6a6-4571-92b2-6c9753c4ce9f"
with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
    rows = conn.execute(
        "select thumbnail_status,preview_status,thumbnail_r2_key,preview_r2_key "
        "from clip_candidates where project_id=%s "
        "order by score desc,start_sec asc limit 10",
        (project_id,),
    ).fetchall()
if len(rows) != 10:
    raise SystemExit(f"expected 10 candidates, found {len(rows)}")
if any(row[0] != "ready" or row[1] != "ready" for row in rows):
    raise SystemExit(f"candidate outputs incomplete: {rows}")
storage = storage_from_env()
keys = {key for row in rows for key in row[2:] if key}
missing = sorted(key for key in keys if not storage.exists(key))
if missing:
    raise SystemExit(f"missing object count={len(missing)}")
print(f"ready_candidates={len(rows)} existing_objects={len(keys)}")
'@ | docker compose -f docker-compose.dev.yml exec -T worker uv run python -
```

Expected: `ready_candidates=10`; every referenced object exists.

- [ ] **Step 7: Inspect final diff without disturbing user changes**

```powershell
git status --short
git diff --check
git diff -- apps/downloader/app/handlers/analyze.py apps/downloader/app/handlers/render_previews.py apps/downloader/tests/test_analyze_handler.py apps/downloader/tests/test_render_previews.py apps/web/components/jobProgressLabel.ts apps/web/components/JobProgress.tsx apps/web/lib/candidates.ts apps/web/app/projects/[id]/page.tsx apps/web/test/jobProgress.test.ts apps/web/test/candidates.test.ts
```

Expected: no whitespace errors; unrelated pre-existing modifications remain
untouched.
