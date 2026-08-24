# Top 10 Candidate Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show ten ranked candidates with unique thumbnails and an authenticated modal that prepares and reuses full video segments on demand.

**Architecture:** Chain a new `prepare_thumbnails` worker job atomically after analysis, persist per-candidate WebP state in Postgres, and proxy thumbnail bytes through an ownership-checked route. The web gallery opens a Radix modal; pressing Play creates/reuses the existing draft clip, polls a lightweight preview endpoint, and plays the existing same-origin segment URL without autoplay.

**Tech Stack:** Next.js 15, React 19, TypeScript, Radix Dialog, Tailwind CSS, Vitest/Testing Library, PostgreSQL/Drizzle, Python 3.11, psycopg, pytest, yt-dlp, FFmpeg, Cloudflare R2/MinIO.

## Global Constraints

- Return at most 10 candidates ordered by `score desc, start_sec asc` and assign one-based rank after the query.
- Capture each thumbnail at `start_sec + min(2 seconds, candidate_duration * 0.20)` and encode a bounded 16:9 WebP.
- Wait for the thumbnail job to become terminal before showing new results; terminal failure uses source-thumbnail fallback.
- Fetch the complete candidate range only after Play and reuse the same draft clip, job, and segment in the editor.
- Never autoplay after asynchronous preparation; only one video may produce audio.
- Previous/Next navigation must not prepare the destination candidate until Play is pressed.
- Do not serialize R2 keys or signed URLs into candidate page props; serve media through authenticated same-origin routes.
- Preserve existing seven-day video-segment retention and existing editor behavior.
- Keep legacy projects without a thumbnail job visible with source-thumbnail fallback.
- Do not add new runtime dependencies; `@radix-ui/react-dialog` is already installed.

---

## File Structure

### Database and worker

- `packages/db/src/schema.ts`: candidate thumbnail columns/check and allowed job type.
- `packages/db/migrations/0002_candidate_previews.sql`: generated database migration.
- `packages/db/migrations/meta/0002_snapshot.json`: generated Drizzle snapshot.
- `packages/db/migrations/meta/_journal.json`: generated migration journal entry.
- `packages/db/test/helpers.ts`: apply migration 0002 in TypeScript DB tests.
- `packages/db/test/schema.test.ts`: database contract tests.
- `apps/downloader/tests/conftest.py`: apply migration 0002 in Python DB tests.
- `apps/downloader/app/ffmpeg.py`: deterministic WebP frame extraction only.
- `apps/downloader/app/handlers/prepare_thumbnails.py`: owned Top 10 query, per-candidate extraction, upload, status, and progress.
- `apps/downloader/app/handlers/analyze.py`: atomically enqueue thumbnail preparation and clean replaced thumbnail objects.
- `apps/downloader/app/worker.py`: register the new handler.
- `apps/downloader/tests/test_prepare_thumbnails.py`: handler and media-helper behavior.
- `apps/downloader/tests/test_analyze_handler.py`: chaining, idempotency, and cleanup tests.
- `apps/downloader/tests/test_worker.py`: registration-visible job execution regression.

### Web data and APIs

- `apps/web/lib/candidates.ts`: ranked Top 10 DTO, fallback URL, thumbnail ownership lookup, and results gating.
- `apps/web/lib/clipTypes.ts`: lightweight `ClipPreviewStatus` contract.
- `apps/web/lib/clips.ts`: ownership-checked preview status query.
- `apps/web/app/api/candidates/[id]/thumbnail/route.ts`: same-origin thumbnail proxy.
- `apps/web/app/api/clips/[id]/preview/route.ts`: lightweight preview polling endpoint.
- `apps/web/app/projects/[id]/page.tsx`: use thumbnail job state when choosing progress versus results.
- `apps/web/components/JobProgress.tsx`: fourth pipeline stage and terminal reload.
- `apps/web/test/candidates.test.ts`: query, rank, fallback, legacy, and page-state tests.
- `apps/web/test/candidateThumbnailRoute.test.ts`: thumbnail authorization and proxy tests.
- `apps/web/test/clips.test.ts`: preview status and concurrent create/reuse tests.
- `apps/web/test/clipPreviewRoute.test.ts`: route auth/error/response tests.

### Web components

- `apps/web/components/ui/dialog.tsx`: reusable centered Radix Dialog primitive.
- `apps/web/lib/candidatePreviewClient.ts`: typed create/status client calls.
- `apps/web/components/CandidatePreviewModal.tsx`: modal state machine, polling, media, context, and navigation.
- `apps/web/components/CandidateList.tsx`: stable thumbnail cards and active candidate ownership.
- `apps/web/app/dev/candidate-preview-fixture/page.tsx`: deterministic local visual-QA gallery.
- `apps/web/test/ui/primitives.test.tsx`: Dialog primitive behavior.
- `apps/web/test/CandidatePreviewModal.test.tsx`: modal state/navigation tests.
- `apps/web/test/CandidateList.test.tsx`: card poster and modal integration tests.

---

### Task 1: Add The Candidate Thumbnail Database Contract

**Files:**
- Modify: `packages/db/src/schema.ts`
- Create: `packages/db/migrations/0002_candidate_previews.sql`
- Create: `packages/db/migrations/meta/0002_snapshot.json`
- Modify: `packages/db/migrations/meta/_journal.json`
- Modify: `packages/db/test/helpers.ts`
- Modify: `packages/db/test/schema.test.ts`
- Modify: `apps/downloader/tests/conftest.py`

**Interfaces:**
- Consumes: existing `clip_candidates` and `jobs` tables.
- Produces: `clip_candidates.thumbnail_status`, `clip_candidates.thumbnail_r2_key`, and allowed job type `prepare_thumbnails`.

- [ ] **Step 1: Write failing schema tests**

Add tests that accept the new job and valid thumbnail states but reject an invalid state:

```ts
test('prepare_thumbnails is an allowed job type', async () => {
  await expect(sql`
    insert into jobs (type, payload)
    values ('prepare_thumbnails', '{"project_id":"p"}'::jsonb)
  `).resolves.toBeDefined()
})

test('candidate thumbnail status is constrained', async () => {
  const userId = await makeUser(sql, 'thumbnail-schema@test.id')
  const [source] = await sql`
    insert into sources (kind, external_id, is_public, url_original, status)
    values ('youtube', 'thumbschema1', true, 'https://youtu.be/thumbschema1', 'ready')
    returning id`
  const [project] = await sql`
    insert into projects (user_id, source_id, title)
    values (${userId}, ${source!.id}, 'Thumb') returning id`
  await expect(sql`
    insert into clip_candidates
      (project_id, start_sec, end_sec, score, title, hook_text,
       transcript_slice, thumbnail_status)
    values (${project!.id}, 10, 80, 0.9, 'c', 'h', 't', 'unknown')
  `).rejects.toThrow(/check constraint/)
})
```

- [ ] **Step 2: Run the schema test and verify RED**

Run: `bun x vitest run packages/db/test/schema.test.ts`

Expected: FAIL because `prepare_thumbnails` violates `jobs_type_chk` and `thumbnail_status` does not exist.

- [ ] **Step 3: Extend the Drizzle schema and generate migration 0002**

Add to `clipCandidates`:

```ts
thumbnailStatus: text('thumbnail_status').notNull().default('pending'),
thumbnailR2Key: text('thumbnail_r2_key'),
```

Add this check beside `clip_candidates_range_chk`:

```ts
check(
  'clip_candidates_thumbnail_status_chk',
  sql`${t.thumbnailStatus} in ('pending','ready','failed')`,
),
```

Change `jobs_type_chk` to:

```ts
sql`${t.type} in ('ingest','transcribe','analyze','prepare_thumbnails','fetch_segments','probe_asset')`
```

Generate the migration and metadata:

```powershell
bun --cwd packages/db run generate --name candidate_previews
```

Verify `0002_candidate_previews.sql` adds both columns/checks and replaces the jobs type check without weakening any existing job type validation.

- [ ] **Step 4: Apply migration 0002 in both test harnesses**

In `packages/db/test/helpers.ts`, after migration 0001:

```ts
await sql.unsafe(readFileSync(join(HERE, '../migrations/0002_candidate_previews.sql'), 'utf8'))
```

In `apps/downloader/tests/conftest.py`, after migration 0001:

```py
c.execute((DB_PKG / "migrations" / "0002_candidate_previews.sql").read_text())
```

- [ ] **Step 5: Run focused database validation**

Run: `bun x vitest run packages/db/test/schema.test.ts packages/db/test/rls.test.ts`

Expected: PASS; existing RLS and job constraints remain intact.

- [ ] **Step 6: Commit the database contract**

```powershell
git add packages/db/src/schema.ts packages/db/migrations packages/db/test/helpers.ts packages/db/test/schema.test.ts apps/downloader/tests/conftest.py
git commit -m "feat(db): add candidate thumbnail state"
```

---

### Task 2: Chain Thumbnail Preparation After Analysis

**Files:**
- Modify: `apps/downloader/app/handlers/analyze.py`
- Modify: `apps/downloader/tests/test_analyze_handler.py`

**Interfaces:**
- Consumes: `Job`, candidate rows, injected `Storage`.
- Produces: one queued `prepare_thumbnails` job per active analysis result and best-effort deletion of replaced thumbnail keys.

- [ ] **Step 1: Write failing analyze-handler tests**

Add assertions for atomic chaining, retry idempotency, and cleanup:

```py
def test_analyze_enqueues_thumbnail_job(conn, deps):
    uid, sid, pid = _setup(conn, external_id="analysis-thumb-job")
    handle_analyze(conn, _job(conn, sid, pid, uid), **deps)
    row = conn.execute(
        "select type, payload, user_id, project_id from jobs "
        "where type = 'prepare_thumbnails' and project_id = %s",
        (pid,),
    ).fetchone()
    assert row[0] == "prepare_thumbnails"
    assert row[1]["source_id"] == sid
    assert row[1]["project_id"] == pid
    assert str(row[2]) == uid

def test_analyze_retry_keeps_one_active_thumbnail_job(conn, deps):
    uid, sid, pid = _setup(conn, external_id="analysis-thumb-retry")
    job = _job(conn, sid, pid, uid)
    handle_analyze(conn, job, **deps)
    handle_analyze(conn, job, **deps)
    count = conn.execute(
        "select count(*) from jobs where type='prepare_thumbnails' "
        "and project_id=%s and status in ('queued','running')", (pid,)
    ).fetchone()[0]
    assert count == 1

def test_reanalysis_deletes_replaced_thumbnail_object(conn, deps):
    uid, sid, pid = _setup(conn, external_id="analysis-thumb-cleanup")
    handle_analyze(conn, _job(conn, sid, pid, uid), **deps)
    conn.execute(
        "update clip_candidates set thumbnail_status='ready', "
        "thumbnail_r2_key='candidate-thumbnails/old.webp' where project_id=%s", (pid,)
    )
    conn.commit()
    handle_analyze(conn, _job(conn, sid, pid, uid), **deps)
    deps["storage"].delete.assert_called_with("candidate-thumbnails/old.webp")
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `Set-Location apps/downloader; uv run pytest tests/test_analyze_handler.py -v`

Expected: FAIL because analysis neither enqueues the job nor deletes thumbnail objects.

- [ ] **Step 3: Insert the thumbnail job in the candidate transaction**

Change `_write_candidates` to accept `job`, `storage`, collect old keys before deletion, insert candidates, and enqueue only when no queued/running thumbnail job exists:

```py
active = conn.execute(
    "select id from jobs where type='prepare_thumbnails' and project_id=%s "
    "and status in ('queued','running') limit 1", (project_id,)
).fetchone()
if active is None:
    conn.execute(
        "insert into jobs (type, payload, user_id, project_id) "
        "values ('prepare_thumbnails', %s::jsonb, %s, %s)",
        (json.dumps({"source_id": source_id, "project_id": project_id}),
         job.user_id, project_id),
    )
conn.commit()
```

Pass `source_id`, `job`, and `storage` from both the cache-hit and fresh-LLM branches. After the commit, delete distinct non-null old keys with per-key logging:

```py
for key in old_thumbnail_keys:
    try:
        storage.delete(key)
    except Exception:  # cleanup must not erase a valid analysis result
        log.exception("gagal menghapus thumbnail kandidat lama %s", key)
```

- [ ] **Step 4: Run analyze tests and verify GREEN**

Run: `Set-Location apps/downloader; uv run pytest tests/test_analyze_handler.py -v`

Expected: PASS, including existing cache and retry behavior.

- [ ] **Step 5: Commit the pipeline chain**

```powershell
git add apps/downloader/app/handlers/analyze.py apps/downloader/tests/test_analyze_handler.py
git commit -m "feat(worker): queue candidate thumbnails after analysis"
```

---

### Task 3: Implement Thumbnail Extraction And Worker Handling

**Files:**
- Modify: `apps/downloader/app/ffmpeg.py`
- Create: `apps/downloader/app/handlers/prepare_thumbnails.py`
- Modify: `apps/downloader/app/worker.py`
- Create: `apps/downloader/tests/test_prepare_thumbnails.py`
- Modify: `apps/downloader/tests/test_worker.py`

**Interfaces:**
- Produces: `thumbnail_time(start: float, end: float) -> float`, `extract_thumbnail(src: Path, dest: Path) -> Path`, and an injectable `handle_prepare_thumbnails` handler whose default dependencies are `storage_from_env`, `download_section`, and `extract_thumbnail`.
- Consumes: `Storage.put_file`, `ytdlp.download_section`, `heartbeat`, candidate thumbnail columns from Task 1.

- [ ] **Step 1: Write failing thumbnail unit and handler tests**

Create tests covering timestamp math, stable ordering/limit, partial failure, upload, and ownership:

```py
def setup_project_with_candidates(conn, count: int):
    uid = conn.execute(
        "insert into auth.users (email) values (%s) returning id",
        (f"thumb-{count}@test.id",),
    ).fetchone()[0]
    conn.execute("insert into profiles (user_id) values (%s)", (uid,))
    sid = conn.execute(
        "insert into sources (kind,external_id,is_public,url_original,status,duration_sec) "
        "values ('youtube',%s,true,'https://youtu.be/thumbs','ready',600) returning id",
        (f"thumb-source-{count}",),
    ).fetchone()[0]
    pid = conn.execute(
        "insert into projects (user_id,source_id,title) values (%s,%s,'Thumbs') returning id",
        (uid, sid),
    ).fetchone()[0]
    ids = []
    for index in range(count):
        ids.append(str(conn.execute(
            "insert into clip_candidates "
            "(project_id,start_sec,end_sec,score,title,hook_text,transcript_slice) "
            "values (%s,%s,%s,%s,%s,'hook','words') returning id",
            (pid, index * 20, index * 20 + 15, 1 - index / 100, f"C{index}"),
        ).fetchone()[0]))
    conn.commit()
    return str(uid), str(sid), str(pid), ids

def thumbnail_job(conn, uid: str, sid: str, pid: str) -> Job:
    payload = {"source_id": sid, "project_id": pid}
    job_id = enqueue(conn, "prepare_thumbnails", payload, user_id=uid, project_id=pid)
    return Job(job_id, "prepare_thumbnails", payload, 1, 3, pid, uid)

def test_thumbnail_time_uses_twenty_percent_capped_at_two_seconds():
    assert thumbnail_time(10, 15) == pytest.approx(11)
    assert thumbnail_time(10, 80) == pytest.approx(12)

def test_handler_prepares_only_ranked_top_ten(conn, tmp_path):
    uid, sid, pid, candidate_ids = setup_project_with_candidates(conn, count=12)
    downloaded = []
    storage = MagicMock()

    def fake_download(url, start, end, dest):
        downloaded.append((start, end))
        dest.write_bytes(b"video")
        return dest

    def fake_extract(src, dest):
        dest.write_bytes(b"webp")
        return dest

    handle_prepare_thumbnails(
        conn, thumbnail_job(conn, uid, sid, pid), storage=storage,
        download=fake_download, extract=fake_extract, workdir=tmp_path,
    )
    rows = conn.execute(
        "select thumbnail_status from clip_candidates where project_id=%s "
        "order by score desc, start_sec asc", (pid,)
    ).fetchall()
    assert [row[0] for row in rows[:10]] == ["ready"] * 10
    assert [row[0] for row in rows[10:]] == ["pending"] * 2
    assert len(downloaded) == 10

def test_one_thumbnail_failure_does_not_fail_batch(conn, tmp_path):
    uid, sid, pid, _ = setup_project_with_candidates(conn, count=2)
    calls = 0
    def flaky_download(url, start, end, dest):
        nonlocal calls
        calls += 1
        if calls == 1:
            raise JobError("SOURCE_BLOCKED", "temporary")
        dest.write_bytes(b"video")
        return dest
    storage = MagicMock()
    def fake_extract(src, dest):
        dest.write_bytes(b"webp")
        return dest
    handle_prepare_thumbnails(
        conn, thumbnail_job(conn, uid, sid, pid), storage=storage,
        download=flaky_download,
        extract=fake_extract,
        workdir=tmp_path,
    )
    states = [row[0] for row in conn.execute(
        "select thumbnail_status from clip_candidates where project_id=%s "
        "order by score desc", (pid,)
    ).fetchall()]
    assert states == ["failed", "ready"]
```

- [ ] **Step 2: Run the new tests and verify RED**

Run: `Set-Location apps/downloader; uv run pytest tests/test_prepare_thumbnails.py -v`

Expected: FAIL because the module and helper functions do not exist.

- [ ] **Step 3: Add deterministic FFmpeg WebP extraction**

Add to `ffmpeg.py`:

```py
def extract_thumbnail(src: Path, dest: Path) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    proc = subprocess.run(
        [
            "ffmpeg", "-i", str(src), "-frames:v", "1",
            "-vf", "scale=640:360:force_original_aspect_ratio=increase,crop=640:360",
            "-c:v", "libwebp", "-quality", "78", "-y", str(dest),
        ],
        capture_output=True, text=True, timeout=120,
    )
    if proc.returncode != 0 or not dest.exists():
        raise JobError("INTERNAL", f"thumbnail ffmpeg gagal: {proc.stderr[-500:]}")
    return dest
```

- [ ] **Step 4: Implement the isolated handler**

Use these public helpers and per-row loop:

```py
def thumbnail_time(start: float, end: float) -> float:
    return start + min(2.0, (end - start) * 0.20)

def handle_prepare_thumbnails(conn, job, *, storage=None, download=_download_section,
                              extract=_extract_thumbnail, workdir=None):
    storage = storage or storage_from_env()
    owned = conn.execute(
        "select s.url_original from projects p join sources s on s.id=p.source_id "
        "where p.id=%s and s.id=%s and p.user_id=%s",
        (job.project_id, job.payload["source_id"], job.user_id),
    ).fetchone()
    if owned is None:
        raise JobError("INTERNAL", "project thumbnail tidak ditemukan", terminal=True)
    rows = conn.execute(
        "select id, start_sec, end_sec from clip_candidates where project_id=%s "
        "order by score desc, start_sec asc limit 10", (job.project_id,)
    ).fetchall()
    owns_workdir = workdir is None
    root = workdir or Path(tempfile.mkdtemp(prefix="cc-thumbnails-"))
    try:
        for index, (candidate_id, raw_start, raw_end) in enumerate(rows):
            start, end = float(raw_start), float(raw_end)
            capture = thumbnail_time(start, end)
            segment = root / f"{candidate_id}.mp4"
            thumbnail = root / f"{candidate_id}.webp"
            try:
                download(owned[0], capture, min(capture + 1.0, end), segment)
                extract(segment, thumbnail)
                key = f"candidate-thumbnails/{sha256_file(thumbnail)}.webp"
                storage.put_file(key, thumbnail, "image/webp")
                conn.execute(
                    "update clip_candidates set thumbnail_status='ready', "
                    "thumbnail_r2_key=%s where id=%s and project_id=%s",
                    (key, candidate_id, job.project_id),
                )
            except Exception:
                log.exception("gagal membuat thumbnail kandidat %s", candidate_id)
                conn.execute(
                    "update clip_candidates set thumbnail_status='failed', "
                    "thumbnail_r2_key=null where id=%s and project_id=%s",
                    (candidate_id, job.project_id),
                )
            conn.commit()
            heartbeat(conn, job.id, (index + 1) * 100 // max(1, len(rows)))
    finally:
        if owns_workdir:
            shutil.rmtree(root, ignore_errors=True)
```

Import `logging`, `shutil`, `tempfile`, `Path`, and the injected helper defaults explicitly. The handler logs per-candidate failures without rethrowing them, so successful candidate rows remain usable.

- [ ] **Step 5: Register the handler and test worker execution**

In `worker.main()` import and register:

```py
from app.handlers.prepare_thumbnails import handle_prepare_thumbnails

handlers = {
    "ingest": handle_ingest,
    "transcribe": handle_transcribe,
    "analyze": handle_analyze,
    "prepare_thumbnails": handle_prepare_thumbnails,
    "fetch_segments": handle_fetch_segments,
    "probe_asset": handle_probe_asset,
}
```

Add a `run_once` regression using an enqueued `prepare_thumbnails` job and injected test handler to prove the queue accepts and completes it.

- [ ] **Step 6: Run worker tests and verify GREEN**

Run: `Set-Location apps/downloader; uv run pytest tests/test_prepare_thumbnails.py tests/test_analyze_handler.py tests/test_worker.py -v`

Expected: PASS.

- [ ] **Step 7: Commit thumbnail generation**

```powershell
git add apps/downloader/app/ffmpeg.py apps/downloader/app/handlers/prepare_thumbnails.py apps/downloader/app/worker.py apps/downloader/tests/test_prepare_thumbnails.py apps/downloader/tests/test_worker.py
git commit -m "feat(worker): generate ranked candidate thumbnails"
```

---

### Task 4: Return Ranked Candidate Media And Gate Results

**Files:**
- Modify: `apps/web/lib/candidates.ts`
- Modify: `apps/web/app/projects/[id]/page.tsx`
- Modify: `apps/web/components/JobProgress.tsx`
- Modify: `apps/web/test/candidates.test.ts`

**Interfaces:**
- Produces: enriched `CandidateView`, `latestThumbnailJobStatus(sql, userId, projectId)`, and thumbnail-aware `projectViewState`.
- Consumes: candidate thumbnail schema and `prepare_thumbnails` jobs.

- [ ] **Step 1: Write failing ranked/fallback/state tests**

Extend fixtures to insert a source thumbnail and 12 candidates. Add:

```ts
test('returns only ranked Top 10 with candidate and source fallbacks', async () => {
  const rows = await listCandidates(sql, alice, projectId)
  expect(rows).toHaveLength(10)
  expect(rows.map((row) => row.rank)).toEqual([1,2,3,4,5,6,7,8,9,10])
  expect(rows[0]!.thumbnailUrl).toBe(`/api/candidates/${rows[0]!.id}/thumbnail`)
  expect(rows[1]!.thumbnailUrl).toBe('https://img.test/source.webp')
})

test('queued thumbnail job keeps candidate rows behind progress', () => {
  expect(projectViewState({
    hasActiveJob: false, candidateCount: 10, thumbnailJobStatus: 'queued',
  })).toBe('progress')
})

test('terminal or legacy thumbnail state reveals results', () => {
  for (const thumbnailJobStatus of ['done', 'failed', 'dead', null] as const) {
    expect(projectViewState({
      hasActiveJob: false, candidateCount: 10, thumbnailJobStatus,
    })).toBe('results')
  }
})
```

- [ ] **Step 2: Run candidate tests and verify RED**

Run: `bun x vitest run apps/web/test/candidates.test.ts`

Expected: FAIL because rank, thumbnail state, limit, and job gating are absent.

- [ ] **Step 3: Implement the ranked candidate query**

Extend `CandidateView`:

```ts
export interface CandidateView {
  id: string
  rank: number
  startSec: number
  endSec: number
  score: number
  title: string
  hookText: string
  reason: string | null
  transcriptSlice: string
  thumbnailStatus: 'pending' | 'ready' | 'failed'
  thumbnailUrl: string | null
}
```

Join `projects` to `sources`, select `thumbnail_status`, `thumbnail_r2_key`, and source thumbnail, add `limit 10`, then map:

```ts
thumbnailStatus: r.thumbnail_status as CandidateView['thumbnailStatus'],
thumbnailUrl: r.thumbnail_status === 'ready' && r.thumbnail_r2_key
  ? `/api/candidates/${r.id}/thumbnail`
  : (r.source_thumbnail_url as string | null) ?? null,
rank: index + 1,
```

- [ ] **Step 4: Add latest thumbnail job lookup and result gating**

Define:

```ts
export type PipelineJobStatus = 'queued' | 'running' | 'done' | 'failed' | 'dead'

export async function latestThumbnailJobStatus(
  sql: Sql, userId: string, projectId: string,
): Promise<PipelineJobStatus | null>
```

The query must join `jobs` to `projects`, filter both project and user, order newest first, and return `null` for invalid UUID or legacy projects. Update `projectViewState` so queued/running thumbnail work wins over candidate count; terminal/null states allow existing candidates.

Update the server page to load both candidates and status, pass both into `projectViewState`, and render `<JobProgress projectId={id} />` whenever state is `progress`, not only when the original `?job=` parameter exists.

- [ ] **Step 5: Add the fourth progress stage**

In `JobProgress.tsx`:

```ts
type PipelineJob = JobState & {
  id: string
  type: 'ingest' | 'transcribe' | 'analyze' | 'prepare_thumbnails'
}
const PIPELINE_TYPES = ['ingest', 'transcribe', 'analyze', 'prepare_thumbnails'] as const
const labels = ['Ambil video', 'Transkripsi', 'Cari highlight', 'Siapkan preview']
```

Reload when the latest type is `prepare_thumbnails` and status is `done`, `failed`, or `dead`. Do not reload on `analyze:done` because the thumbnail job is the new result gate.

- [ ] **Step 6: Run focused web tests and verify GREEN**

Run: `bun x vitest run apps/web/test/candidates.test.ts apps/web/test/jobProgress.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit ranked result gating**

```powershell
git add apps/web/lib/candidates.ts apps/web/app/projects/[id]/page.tsx apps/web/components/JobProgress.tsx apps/web/test/candidates.test.ts
git commit -m "feat(web): gate ranked results on candidate thumbnails"
```

---

### Task 5: Proxy Candidate Thumbnails Securely

**Files:**
- Modify: `apps/web/lib/candidates.ts`
- Create: `apps/web/app/api/candidates/[id]/thumbnail/route.ts`
- Create: `apps/web/test/candidateThumbnailRoute.test.ts`

**Interfaces:**
- Produces: `loadCandidateThumbnail(sql, userId, candidateId) -> { key: string }` and authenticated GET route.
- Consumes: `signedR2Get`, candidate ownership relation.

- [ ] **Step 1: Write failing ownership and proxy tests**

Create route tests with mocked auth, lookup, signed URL, and fetch:

```ts
test('owner receives same-origin WebP bytes', async () => {
  deps.load.mockResolvedValueOnce({ key: 'candidate-thumbnails/a.webp' })
  deps.fetch.mockResolvedValueOnce(new Response(new Uint8Array([1,2,3]), {
    headers: { 'content-type': 'image/webp' },
  }))
  const response = await GET(new Request('http://localhost/thumb'), {
    params: Promise.resolve({ id: 'candidate-1' }),
  })
  expect(response.status).toBe(200)
  expect(response.headers.get('content-type')).toBe('image/webp')
  expect(response.headers.get('cache-control')).toBe('private, max-age=3600')
})

test('unowned candidate is rejected before signing', async () => {
  deps.load.mockRejectedValueOnce(new deps.NotFound())
  const response = await GET(new Request('http://localhost/thumb'), {
    params: Promise.resolve({ id: 'candidate-bob' }),
  })
  expect(response.status).toBe(404)
  expect(deps.signedGet).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run route tests and verify RED**

Run: `bun x vitest run apps/web/test/candidateThumbnailRoute.test.ts`

Expected: FAIL because the route and lookup do not exist.

- [ ] **Step 3: Implement ownership lookup and route**

Add a `CandidateNotFoundError` and query only ready thumbnails:

```ts
select c.thumbnail_r2_key
  from clip_candidates c
  join projects p on p.id = c.project_id
 where c.id = ${candidateId}
   and p.user_id = ${userId}
   and c.thumbnail_status = 'ready'
   and c.thumbnail_r2_key is not null
```

The route follows the segment proxy pattern: 401 when unauthenticated, 404 for invalid/unowned/not-ready, signed upstream fetch with `cache: 'no-store'`, and a private one-hour response. Do not return the key in JSON or headers.

- [ ] **Step 4: Run candidate data and route tests**

Run: `bun x vitest run apps/web/test/candidates.test.ts apps/web/test/candidateThumbnailRoute.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit secure thumbnails**

```powershell
git add apps/web/lib/candidates.ts apps/web/app/api/candidates/[id]/thumbnail/route.ts apps/web/test/candidateThumbnailRoute.test.ts
git commit -m "feat(web): proxy candidate thumbnails securely"
```

---

### Task 6: Add Lightweight Clip Preview Status

**Files:**
- Modify: `apps/web/lib/clipTypes.ts`
- Modify: `apps/web/lib/clips.ts`
- Create: `apps/web/app/api/clips/[id]/preview/route.ts`
- Modify: `apps/web/test/clips.test.ts`
- Create: `apps/web/test/clipPreviewRoute.test.ts`

**Interfaces:**
- Produces: `ClipPreviewStatus` and `loadClipPreview(sql, userId, clipId)`.
- Consumes: existing `createClipFromCandidate`, `media_segments`, and `fetch_segments` jobs.

- [ ] **Step 1: Write failing domain tests**

Add pending, ready, failed, ownership, and concurrent create tests:

```ts
test('preview status is lightweight and pending before segment exists', async () => {
  await expect(loadClipPreview(sql, alice, clipId)).resolves.toMatchObject({
    clipId,
    status: 'pending',
    url: null,
  })
})

test('preview status returns existing same-origin segment', async () => {
  await sql`
    insert into media_segments (source_id,start_sec,end_sec,r2_key,bytes,expires_at)
    values (${sourceId},10,80,'segments/preview.mp4',123,now()+interval '7 days')
    on conflict (source_id,start_sec,end_sec) do update
      set r2_key=excluded.r2_key, bytes=excluded.bytes, expires_at=excluded.expires_at`
  await expect(loadClipPreview(sql, alice, clipId)).resolves.toMatchObject({
    status: 'ready', url: `/api/clips/${clipId}/segment`,
  })
})

test('parallel create requests reuse one clip and active job', async () => {
  const results = await Promise.all([
    createClipFromCandidate(sql, alice, candidateId),
    createClipFromCandidate(sql, alice, candidateId),
  ])
  expect(new Set(results.map((r) => r.clipId))).toHaveSize(1)
  expect(await sql`select id from clips where candidate_id=${candidateId}`).toHaveLength(1)
})
```

- [ ] **Step 2: Run clip tests and verify RED**

Run: `bun x vitest run apps/web/test/clips.test.ts`

Expected: FAIL because `loadClipPreview` and `ClipPreviewStatus` do not exist.

- [ ] **Step 3: Implement the lightweight query**

Add:

```ts
export interface ClipPreviewStatus {
  clipId: string
  status: 'pending' | 'ready' | 'failed'
  url: string | null
  jobId: string | null
  errorCode: string | null
}
```

`loadClipPreview` must validate UUID, join clip → candidate → project, check user ownership, and use subqueries for an unexpired matching segment plus latest `fetch_segments` job. Map `failed/dead` to failed, an existing segment to ready, otherwise pending. It must not call `readR2Json`, `resolveProjectAssets`, or `upsertCandidateAsset`.

- [ ] **Step 4: Add the authenticated preview route**

Create `GET /api/clips/[id]/preview` matching the existing clip route error shape:

```ts
try {
  return NextResponse.json(await loadClipPreview(sql, uid, (await ctx.params).id))
} catch (error) {
  if (error instanceof ClipNotFoundError) return missing()
  return NextResponse.json(
    { error: { code: 'INTERNAL', message: 'Gagal memuat preview.' } },
    { status: 500 },
  )
}
```

- [ ] **Step 5: Run domain and route tests**

Run: `bun x vitest run apps/web/test/clips.test.ts apps/web/test/clipPreviewRoute.test.ts apps/web/test/segmentRoute.test.ts`

Expected: PASS; segment proxy behavior remains unchanged.

- [ ] **Step 6: Commit preview status**

```powershell
git add apps/web/lib/clipTypes.ts apps/web/lib/clips.ts apps/web/app/api/clips/[id]/preview/route.ts apps/web/test/clips.test.ts apps/web/test/clipPreviewRoute.test.ts
git commit -m "feat(web): expose lightweight clip preview status"
```

---

### Task 7: Add The Accessible Dialog Primitive

**Files:**
- Create: `apps/web/components/ui/dialog.tsx`
- Modify: `apps/web/test/ui/primitives.test.tsx`

**Interfaces:**
- Produces: `Dialog`, `DialogTrigger`, `DialogContent`, `DialogTitle`, `DialogDescription`, `DialogClose`.
- Consumes: installed `@radix-ui/react-dialog`, `lucide-react`, and `cn`.

- [ ] **Step 1: Write a failing Dialog primitive test**

```tsx
test('Dialog exposes an accessible title and icon close control', async () => {
  const user = userEvent.setup()
  render(
    <Dialog>
      <DialogTrigger>Preview candidate</DialogTrigger>
      <DialogContent>
        <DialogTitle>Candidate #1</DialogTitle>
        <DialogDescription>Hook candidate</DialogDescription>
      </DialogContent>
    </Dialog>,
  )
  await user.click(screen.getByRole('button', { name: 'Preview candidate' }))
  expect(screen.getByRole('dialog', { name: 'Candidate #1' })).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Tutup preview' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run primitive tests and verify RED**

Run: `bun x vitest run apps/web/test/ui/primitives.test.tsx`

Expected: FAIL because `ui/dialog.tsx` does not exist.

- [ ] **Step 3: Implement the centered responsive Dialog**

Create the file with this centered composition:

```tsx
import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger
export const DialogClose = DialogPrimitive.Close

export const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm" />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        'fixed left-1/2 top-1/2 z-50 max-h-[calc(100vh-2rem)] w-[calc(100%-2rem)] max-w-4xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-border bg-surface-raised p-4 shadow-2xl outline-none sm:p-6',
        className,
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close
        aria-label="Tutup preview"
        className="absolute right-3 top-3 grid size-11 place-items-center rounded-lg text-muted hover:bg-surface-soft hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <X className="size-5" aria-hidden="true" />
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
))
DialogContent.displayName = DialogPrimitive.Content.displayName

export const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('text-xl font-black tracking-normal', className)}
    {...props}
  />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

export const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('text-sm leading-6 text-muted', className)}
    {...props}
  />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName
```

- [ ] **Step 4: Run primitive tests and verify GREEN**

Run: `bun x vitest run apps/web/test/ui/primitives.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit the primitive**

```powershell
git add apps/web/components/ui/dialog.tsx apps/web/test/ui/primitives.test.tsx
git commit -m "feat(ui): add accessible preview dialog"
```

---

### Task 8: Build The Preview Modal State Machine

**Files:**
- Create: `apps/web/lib/candidatePreviewClient.ts`
- Create: `apps/web/components/CandidatePreviewModal.tsx`
- Create: `apps/web/test/CandidatePreviewModal.test.tsx`

**Interfaces:**
- Consumes: `CandidateView`, `ClipPreviewStatus`, POST `/api/clips`, GET `/api/clips/:id/preview`, Dialog from Task 7.
- Produces: controlled `CandidatePreviewModal` with idle/preparing/ready/failed states, `onPrevious`/`onNext`, and clip-ID handoff callbacks.

- [ ] **Step 1: Write failing modal behavior tests**

Use fake timers and mocked `fetch` to cover no-fetch-on-open, Play preparation, no autoplay, navigation cleanup, Retry, and Edit:

```tsx
const candidate3: CandidateView = {
  id: 'candidate-3', rank: 3, startSec: 20, endSec: 80, score: 0.91,
  title: 'Candidate tiga', hookText: 'Hook candidate tiga', reason: 'Strong payoff',
  transcriptSlice: 'Transcript tiga', thumbnailStatus: 'ready',
  thumbnailUrl: '/api/candidates/candidate-3/thumbnail',
}
const onNext = vi.fn()
const modalProps = {
  candidate: candidate3,
  open: true,
  hasPrevious: true,
  hasNext: true,
  onOpenChange: vi.fn(),
  onPrevious: vi.fn(),
  onNext,
  initialClipId: null,
  onClipResolved: vi.fn(),
}

test('opening shows context but does not create a clip until Play', async () => {
  render(<CandidatePreviewModal {...modalProps} />)
  expect(screen.getByText('#3')).toBeVisible()
  expect(screen.getByText(candidate3.hookText)).toBeVisible()
  expect(screen.getByLabelText('skor 91')).toBeVisible()
  expect(screen.getByText('Strong payoff')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Edit klip' })).toBeVisible()
  expect(fetchMock).not.toHaveBeenCalled()
})

test('Play creates clip, polls ready, and never autoplays', async () => {
  const user = userEvent.setup()
  fetchMock
    .mockResolvedValueOnce(jsonResponse({ clipId: 'clip-3', jobId: 'job-3' }, 201))
    .mockResolvedValueOnce(jsonResponse({
      clipId: 'clip-3', status: 'ready',
      url: '/api/clips/clip-3/segment', jobId: 'job-3', errorCode: null,
    }))
  render(<CandidatePreviewModal {...modalProps} />)
  await user.click(screen.getByRole('button', { name: /Putar preview/i }))
  await waitFor(() => expect(screen.getByTestId('candidate-preview-video')).toHaveAttribute(
    'src', '/api/clips/clip-3/segment',
  ))
  expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled()
})

test('Next pauses video and does not fetch the next candidate', async () => {
  const user = userEvent.setup()
  fetchMock
    .mockResolvedValueOnce(jsonResponse({ clipId: 'clip-3', jobId: null }, 201))
    .mockResolvedValueOnce(jsonResponse({
      clipId: 'clip-3', status: 'ready',
      url: '/api/clips/clip-3/segment', jobId: null, errorCode: null,
    }))
  render(<CandidatePreviewModal {...modalProps} />)
  await user.click(screen.getByRole('button', { name: /Putar preview/i }))
  await screen.findByTestId('candidate-preview-video')
  fetchMock.mockClear()
  await user.click(screen.getByRole('button', { name: /Candidate berikutnya/i }))
  expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled()
  expect(onNext).toHaveBeenCalled()
  expect(fetchMock).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run modal tests and verify RED**

Run: `bun x vitest run apps/web/test/CandidatePreviewModal.test.tsx`

Expected: FAIL because the client helper and modal do not exist.

- [ ] **Step 3: Add typed client calls**

Implement:

```ts
export async function createPreviewClip(candidateId: string, signal?: AbortSignal) {
  const response = await fetch('/api/clips', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ candidateId }),
    signal,
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok || typeof body.clipId !== 'string') {
    throw new Error(body.error?.message ?? 'Gagal menyiapkan preview.')
  }
  return body as { clipId: string; jobId: string | null }
}

export async function fetchClipPreviewStatus(clipId: string, signal?: AbortSignal) {
  const response = await fetch(`/api/clips/${clipId}/preview`, { signal, cache: 'no-store' })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error?.message ?? 'Gagal memuat preview.')
  return body as ClipPreviewStatus
}
```

- [ ] **Step 4: Implement modal state and bounded polling**

Use explicit state:

```ts
type PreviewState =
  | { kind: 'idle' }
  | { kind: 'preparing'; clipId: string }
  | { kind: 'ready'; clipId: string; url: string }
  | { kind: 'failed'; clipId: string | null; message: string }
```

Define props explicitly:

```ts
interface CandidatePreviewModalProps {
  candidate: CandidateView
  open: boolean
  hasPrevious: boolean
  hasNext: boolean
  initialClipId: string | null
  onOpenChange(open: boolean): void
  onPrevious(): void
  onNext(): void
  onClipResolved(candidateId: string, clipId: string): void
}
```

On Play, use `initialClipId` when known; otherwise create/reuse the clip and call `onClipResolved`. Poll immediately and with delays `1000, 1500, 2000, 3000` ms capped at 3000 ms until terminal. Abort pending fetch/timer on candidate change or close. Network errors keep `preparing` and retry; API `status: 'failed'` enters failed. Retry always calls `createPreviewClip` so a terminal job can enqueue a fresh attempt. Edit reuses `clipId` when present, otherwise creates it, then calls ``window.location.assign(`/clips/${clipId}`)``.

Render poster for idle/preparing/failed; render `<video controls preload="metadata" poster={candidate.thumbnailUrl ?? undefined}>` only for ready. Do not set `autoPlay` and never call `.play()`. Pause/reset the video in cleanup. The header renders rank, score badge, title, and formatted duration; the context renders hook and optional reason; the footer renders icon-backed Previous, **Edit klip**, and Next actions with boundary disables. Add ArrowLeft/ArrowRight handling only when the event target is not `VIDEO`, `INPUT`, `TEXTAREA`, `SELECT`, or `BUTTON`.

- [ ] **Step 5: Run modal tests and verify GREEN**

Run: `bun x vitest run apps/web/test/CandidatePreviewModal.test.tsx`

Expected: PASS for all state, retry, navigation, cleanup, and no-autoplay cases.

- [ ] **Step 6: Commit modal behavior**

```powershell
git add apps/web/lib/candidatePreviewClient.ts apps/web/components/CandidatePreviewModal.tsx apps/web/test/CandidatePreviewModal.test.tsx
git commit -m "feat(web): add on-demand candidate preview modal"
```

---

### Task 9: Integrate Stable Candidate Cards With The Modal

**Files:**
- Modify: `apps/web/components/CandidateList.tsx`
- Create: `apps/web/app/dev/candidate-preview-fixture/page.tsx`
- Modify: `apps/web/test/CandidateList.test.tsx`
- Modify: `apps/web/test/candidates.test.ts`

**Interfaces:**
- Consumes: ranked `CandidateView[]` and `CandidatePreviewModal`.
- Produces: interactive Top 10 gallery with stable posters, fallback placeholder, and active-index navigation.

- [ ] **Step 1: Write failing card and integration tests**

Update candidate fixtures with rank/status/URL and add:

```tsx
const candidate1: CandidateView = {
  id: 'candidate-1', rank: 1, startSec: 10, endSec: 70, score: 0.95,
  title: 'Candidate satu', hookText: 'Hook satu', reason: 'Reason satu',
  transcriptSlice: 'Transcript satu', thumbnailStatus: 'ready',
  thumbnailUrl: '/api/candidates/candidate-1/thumbnail',
}
const candidate2: CandidateView = {
  ...candidate1,
  id: 'candidate-2', rank: 2, score: 0.91, title: 'Candidate dua',
  hookText: 'Hook dua', thumbnailUrl: '/api/candidates/candidate-2/thumbnail',
}
const candidate = candidate1

test('renders stable candidate poster with rank, duration, and Play label', () => {
  render(<CandidateList candidates={[candidate]} />)
  expect(screen.getByRole('img', { name: candidate.title })).toHaveAttribute(
    'src', candidate.thumbnailUrl,
  )
  expect(screen.getByRole('button', { name: `Preview ${candidate.title}` })).toBeVisible()
  expect(screen.getByText('#1')).toBeVisible()
})

test('card opens modal and Next moves context without preparing video', async () => {
  const user = userEvent.setup()
  const fetchMock = vi.spyOn(globalThis, 'fetch')
  render(<CandidateList candidates={[candidate1, candidate2]} />)
  await user.click(screen.getByRole('button', { name: `Preview ${candidate1.title}` }))
  expect(screen.getByRole('dialog', { name: candidate1.title })).toBeVisible()
  await user.click(screen.getByRole('button', { name: /Candidate berikutnya/i }))
  expect(screen.getByRole('dialog', { name: candidate2.title })).toBeVisible()
  expect(fetchMock).not.toHaveBeenCalled()
})

test('broken poster falls back without changing media dimensions', () => {
  render(<CandidateList candidates={[{ ...candidate, thumbnailUrl: null }]} />)
  expect(screen.getByTestId('candidate-thumbnail-placeholder')).toHaveClass('aspect-video')
})
```

- [ ] **Step 2: Run candidate component tests and verify RED**

Run: `bun x vitest run apps/web/test/CandidateList.test.tsx apps/web/test/candidates.test.ts`

Expected: FAIL because cards lack posters and the modal integration.

- [ ] **Step 3: Convert CandidateList into the gallery owner**

Add `'use client'`, hold `activeIndex: number | null` plus the session clip map, and render a stable media wrapper:

```ts
const [activeIndex, setActiveIndex] = useState<number | null>(null)
const [clipIds, setClipIds] = useState<Record<string, string>>({})

function rememberClip(candidateId: string, clipId: string) {
  setClipIds((current) => ({ ...current, [candidateId]: clipId }))
}
```

Render each media area as:

```tsx
<div className="relative aspect-video w-full overflow-hidden rounded-t-lg bg-surface-soft">
  {candidate.thumbnailUrl && !broken[candidate.id] ? (
    <img
      src={candidate.thumbnailUrl}
      alt={candidate.title}
      className="size-full object-cover"
      onError={() => setBroken((old) => ({ ...old, [candidate.id]: true }))}
    />
  ) : (
    <div data-testid="candidate-thumbnail-placeholder" className="aspect-video size-full bg-surface-soft" />
  )}
  <Button
    type="button" size="icon" aria-label={`Preview ${candidate.title}`}
    onClick={() => setActiveIndex(index)}
    className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
  >
    <Play className="size-5" aria-hidden="true" />
  </Button>
</div>
```

Use `candidate.rank`, not `index + 1`, for rank badges. Keep existing text, transcript accordion, and `CreateClipButton`. Render one controlled modal after the list with boundary-aware Previous/Next callbacks, `initialClipId={clipIds[activeCandidate.id] ?? null}`, and `onClipResolved={rememberClip}`. Returning to an already prepared candidate therefore skips duplicate clip creation while still waiting for an explicit Play before status lookup.

- [ ] **Step 4: Add a deterministic browser fixture**

Create `apps/web/app/dev/candidate-preview-fixture/page.tsx` using local preset assets so browser QA does not need a network download:

```tsx
import { CandidateList } from '@/components/CandidateList'
import type { CandidateView } from '@/lib/candidates'

const thumbnails = [
  '/presets/photos/mountain-morning.webp',
  '/presets/photos/creative-workspace.webp',
  '/presets/photos/city-night.webp',
  '/presets/photos/abstract-neon.webp',
  '/presets/backgrounds/sunset-gradient.svg',
  '/presets/backgrounds/dark-grid.svg',
  '/presets/stickers/subscribe-badge.svg',
  '/presets/stickers/sparkle-callout.svg',
  '/presets/stickers/red-arrow.svg',
  '/presets/stickers/highlight-circle.svg',
]

const candidates: CandidateView[] = thumbnails.map((thumbnailUrl, index) => ({
  id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
  rank: index + 1,
  startSec: index * 70,
  endSec: index * 70 + 65,
  score: 0.97 - index * 0.04,
  title: `Candidate preview ${index + 1}`,
  hookText: `Hook context untuk candidate ranking ${index + 1}`,
  reason: 'Fixture lokal untuk verifikasi layout modal dan ranked gallery.',
  transcriptSlice: 'Potongan transcript fixture yang cukup panjang untuk menguji wrapping.',
  thumbnailStatus: 'ready',
  thumbnailUrl,
}))

export default function CandidatePreviewFixturePage() {
  return (
    <main className="mx-auto max-w-7xl p-4 sm:p-8">
      <CandidateList candidates={candidates} />
    </main>
  )
}
```

The fixture is development-only by route convention and uses the production gallery/modal components. Pressing Play without a session intentionally exercises the failed/Retry UI via the real 401 response.

- [ ] **Step 5: Run component and page regressions**

Run: `bun x vitest run apps/web/test/CandidateList.test.tsx apps/web/test/candidates.test.ts apps/web/test/AppShell.test.tsx`

Expected: PASS; empty state, transcript, and Edit clip remain present.

- [ ] **Step 6: Commit gallery integration**

```powershell
git add apps/web/components/CandidateList.tsx apps/web/app/dev/candidate-preview-fixture/page.tsx apps/web/test/CandidateList.test.tsx apps/web/test/candidates.test.ts
git commit -m "feat(web): add thumbnail candidate gallery"
```

---

### Task 10: Run Full Validation And Browser QA

**Files:**
- Verify files produced by Tasks 1-9; any discovered defect returns to its owning task for a new failing regression test before correction.

**Interfaces:**
- Consumes: complete candidate thumbnail and preview workflow.
- Produces: verified desktop/mobile UI and green repository checks.

- [ ] **Step 1: Run all focused TypeScript tests**

```powershell
bun x vitest run packages/db/test/schema.test.ts packages/db/test/rls.test.ts apps/web/test/candidates.test.ts apps/web/test/candidateThumbnailRoute.test.ts apps/web/test/clips.test.ts apps/web/test/clipPreviewRoute.test.ts apps/web/test/segmentRoute.test.ts apps/web/test/ui/primitives.test.tsx apps/web/test/CandidatePreviewModal.test.tsx apps/web/test/CandidateList.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run focused Python tests**

```powershell
Set-Location apps/downloader
uv run pytest tests/test_prepare_thumbnails.py tests/test_analyze_handler.py tests/test_fetch_segments.py tests/test_worker.py -v
Set-Location ../..
```

Expected: PASS.

- [ ] **Step 3: Run repository-wide validation**

```powershell
bun run test
bun run typecheck
bun run build
Set-Location apps/downloader
uv run pytest -v
Set-Location ../..
```

Expected: all commands exit 0. If a failure is unrelated and pre-existing, capture its exact test/file and do not modify unrelated code.

- [ ] **Step 4: Start the app with the deterministic visual fixture**

Run the existing dev stack and web server:

```powershell
bun run db:up
$env:PORT='3001'
bun run dev
```

Open `http://localhost:3001/dev/candidate-preview-fixture`. If port 3001 is occupied, increment `PORT` until the server starts. The committed fixture exposes ten candidates with local thumbnails and does not depend on an external YouTube download.

- [ ] **Step 5: Verify desktop and mobile with Playwright**

Check 1440×900 and 390×844:

1. Top 10 cards have stable 16:9 media with no layout shift.
2. Rank, score, title, hook, duration, transcript, and Edit remain readable.
3. Opening rank 3 shows the same rank/score/hook in the modal.
4. Next changes to rank 4 without calling clip creation until Play.
5. The real unauthenticated Play response shows failed and Retry controls without overlap.
6. The ready-video component test from Task 8 proves controls render and playback does not autoplay.
7. Escape closes; focus returns to the opening Play button.
8. Mobile modal scrolls context while close and footer actions remain reachable.

Save screenshots under `output/top-10-preview-desktop.png` and `output/top-10-preview-mobile.png`. Inspect the screenshots and browser console; zero uncaught errors or failed owned-media requests are acceptable.

- [ ] **Step 6: Confirm the final diff and commit sequence are clean**

```powershell
git diff --check
git status -sb
git log -10 --oneline
```

Expected: no whitespace errors; only pre-existing unrelated working-tree changes remain unstaged; Tasks 1-9 each have their intended focused commit. A QA defect must be fixed through RED/GREEN in its owning task and committed with that task's exact file list before this check is repeated.

---

## Completion Checklist

- [ ] Database migration is generated, applied by both test harnesses, and backwards-compatible.
- [ ] Analysis atomically enqueues thumbnail preparation and cleanup does not invalidate results.
- [ ] Worker prepares only deterministic Top 10 WebPs and isolates per-candidate failure.
- [ ] Result page gates on thumbnail terminal state while legacy projects remain visible.
- [ ] Thumbnail and preview routes enforce ownership before signing R2.
- [ ] Clip creation and segment jobs remain idempotent under concurrent Play.
- [ ] Modal preserves candidate context, navigation, focus, and single-audio behavior.
- [ ] No destination candidate fetch occurs before Play and no async autoplay occurs.
- [ ] Focused tests, full tests, typecheck, build, Python suite, and browser QA pass.
