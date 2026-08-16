# Preload Pipeline Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make 9:16 candidate previews deployable and observable end-to-end, so a rendered candidate opens and plays without creating another clip.

**Architecture:** Align Drizzle's schema and migration journal with the existing SQL migration. Worker state progresses from `pending` to `rendering` before candidate work starts. A small client-side render monitor refreshes the server-rendered candidate list while the per-project render job is active; the modal then receives the pre-rendered URL and plays it in a portrait frame.

**Tech Stack:** Drizzle ORM/Kit, PostgreSQL, Python 3.12/pytest, Next.js App Router, React, Vitest.

## Global Constraints

- Preserve existing candidate ownership checks and read-only web endpoints.
- Preview states are exactly `pending`, `rendering`, `ready`, and `failed`.
- One failed candidate must not abort the worker batch.
- All new behavior starts with a regression test that fails for the reported gap.

---

### Task 1: Make the preview migration deployable

**Files:**
- Modify: `packages/db/src/schema.ts`
- Create: `packages/db/migrations/meta/0003_snapshot.json`
- Modify: `packages/db/migrations/meta/_journal.json`
- Test: `packages/db/test/schema.test.ts`

**Interfaces:**
- Produces `clipCandidates.previewStatus` and `clipCandidates.previewR2Key` in the Drizzle schema.
- Produces a journal entry with tag `0003_candidate_preview_renders` so `drizzle-kit migrate` applies the existing SQL file.

- [ ] **Step 1: Write the failing schema regression test**

```ts
test('clip candidates expose pre-render preview columns', () => {
  expect(clipCandidates.previewStatus.name).toBe('preview_status')
  expect(clipCandidates.previewR2Key.name).toBe('preview_r2_key')
})
```

- [ ] **Step 2: Run the test and confirm it fails because the columns are absent**

Run: `bun test packages/db/test/schema.test.ts`

- [ ] **Step 3: Add the two Drizzle columns and status CHECK constraint**

```ts
previewStatus: text('preview_status').notNull().default('pending'),
previewR2Key: text('preview_r2_key'),
check('clip_candidates_preview_status_chk', sql`${t.previewStatus} in ('pending','rendering','ready','failed')`),
```

- [ ] **Step 4: Generate and verify migration metadata**

Run `bun x drizzle-kit generate --config packages/db/drizzle.config.ts`, retain the existing `0003_candidate_preview_renders.sql` contents, and confirm `_journal.json` contains the generated `0003_candidate_preview_renders` entry plus `0003_snapshot.json`.

- [ ] **Step 5: Run the schema test and commit**

Run: `bun test packages/db/test/schema.test.ts`

Commit: `fix(db): register preview render migration for production`

### Task 2: Publish real `rendering` state from the worker

**Files:**
- Modify: `apps/downloader/app/handlers/render_previews.py`
- Modify: `apps/downloader/tests/test_render_previews.py`

**Interfaces:**
- `handle_render_previews` changes each selected candidate to `rendering` before downloading it, then commits `ready` or `failed`.

- [ ] **Step 1: Write a failing test that observes `rendering` before download**

```python
def test_marks_candidate_rendering_before_download(conn, tmp_path):
    seen: list[str] = []
    def download(_url, _start, _end, dest):
        seen.append(conn.execute(
            "select preview_status from clip_candidates where project_id = %s", (pid,)
        ).fetchone()[0])
        dest.write_bytes(b"video")
        return dest
    # invoke handler with the fake download
    assert seen == ["rendering"]
```

- [ ] **Step 2: Run it and confirm it fails because the status remains pending**

Run: `uv run pytest tests/test_render_previews.py::test_marks_candidate_rendering_before_download -q`

- [ ] **Step 3: Update the candidate at the start of each loop**

```python
conn.execute(
    "update clip_candidates set preview_status = 'rendering', preview_r2_key = null "
    "where id = %s and project_id = %s",
    (cid, project_id),
)
conn.commit()
```

- [ ] **Step 4: Run all render preview tests and commit**

Run: `uv run pytest tests/test_render_previews.py -q`

Commit: `fix(worker): publish preview rendering state`

### Task 3: Refresh candidates while the render job is active

**Files:**
- Create: `apps/web/components/PreviewRenderRefresh.tsx`
- Modify: `apps/web/app/projects/[id]/page.tsx`
- Test: `apps/web/test/PreviewRenderRefresh.test.tsx`

**Interfaces:**
- `PreviewRenderRefresh({ projectId, hasIncompletePreviews })` observes the newest `render_previews` job through Supabase and calls `router.refresh()` on job changes and every three seconds while the job is queued/running.

- [ ] **Step 1: Write failing client tests**

```tsx
test('refreshes while render job is running', async () => {
  render(<PreviewRenderRefresh projectId="project-1" hasIncompletePreviews />)
  await waitFor(() => expect(router.refresh).toHaveBeenCalled())
})

test('stops refreshing after render job is done', async () => {
  // mock latest job status as done and advance the polling interval
  expect(router.refresh).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run the tests and confirm the component does not yet exist**

Run: `bun test apps/web/test/PreviewRenderRefresh.test.tsx`

- [ ] **Step 3: Implement the monitor with interval and realtime cleanup**

```tsx
useEffect(() => {
  if (!hasIncompletePreviews) return
  let active = true
  async function refreshIfActive() {
    const { data } = await supabase.from('jobs').select('status')
      .eq('project_id', projectId).eq('type', 'render_previews')
      .order('created_at', { ascending: false }).limit(1)
    if (active && (data?.[0]?.status === 'queued' || data?.[0]?.status === 'running')) {
      router.refresh()
    }
  }
  void refreshIfActive()
  const timer = window.setInterval(() => void refreshIfActive(), 3000)
  return () => { active = false; window.clearInterval(timer) }
}, [hasIncompletePreviews, projectId, router])
```

- [ ] **Step 4: Render the monitor beside `CandidateList`**

```tsx
<PreviewRenderRefresh
  projectId={id}
  hasIncompletePreviews={candidates.some((candidate) =>
    candidate.previewStatus === 'pending' || candidate.previewStatus === 'rendering')}
/>
```

- [ ] **Step 5: Run monitor and candidate tests, then commit**

Run: `bun test apps/web/test/PreviewRenderRefresh.test.tsx apps/web/test/CandidateList.test.tsx`

Commit: `fix(web): refresh candidates during preview rendering`

### Task 4: Display and play the pre-rendered video as portrait media

**Files:**
- Modify: `apps/web/components/CandidatePreviewModal.tsx`
- Modify: `apps/web/test/CandidatePreviewModal.test.tsx`

**Interfaces:**
- A ready pre-rendered candidate renders an inline, muted, autoplaying `<video>` in a 9:16 media frame.
- The fallback preparation state uses the same 9:16 frame.

- [ ] **Step 1: Write failing modal assertions**

```tsx
expect(screen.getByTestId('candidate-preview-video')).toHaveAttribute('autoplay')
expect(screen.getByTestId('candidate-preview-media')).toHaveClass('aspect-[9/16]')
```

- [ ] **Step 2: Run the test and confirm it fails because the modal is landscape and not autoplaying**

Run: `bun test apps/web/test/CandidatePreviewModal.test.tsx`

- [ ] **Step 3: Make the media frame portrait and enable safe autoplay**

```tsx
<div data-testid="candidate-preview-media" className="relative mx-auto aspect-[9/16] w-[min(100%,calc(70vh*9/16))] overflow-hidden bg-black">
  <video autoPlay muted playsInline ... />
</div>
```

- [ ] **Step 4: Run modal tests and commit**

Run: `bun test apps/web/test/CandidatePreviewModal.test.tsx`

Commit: `fix(web): play pre-rendered previews in portrait`

### Task 5: Full validation

- [ ] **Step 1: Run focused regression suites**

Run:

```bash
uv run --directory apps/downloader pytest tests/test_render_previews.py tests/test_face_focus.py tests/test_ffmpeg.py -q
bun test packages/db/test/schema.test.ts apps/web/test/PreviewRenderRefresh.test.tsx apps/web/test/CandidatePreviewModal.test.tsx apps/web/test/CandidateList.test.tsx apps/web/test/clips.test.ts
```

- [ ] **Step 2: Run static validation**

Run:

```bash
uv run --directory apps/downloader ruff check app tests
bun run typecheck
```

- [ ] **Step 3: Inspect final diff and commit the completion work**

Commit: `fix: complete preload preview pipeline`
