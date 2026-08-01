# Draggable Caption and Uploaded Media Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add persistent image/audio/video uploads, EditSpecV3 asset references, spatial and timeline dragging, visual resize, global caption dragging, multi-asset preview/export, quota, and three-day retention.

**Architecture:** A project-scoped `media_assets` table and private R2 objects form the uploaded Asset Catalog. EditSpecV3 stores stable `assetId` values and normalized transforms; server loaders resolve them to same-origin media URLs after ownership checks. Pure engine commands remain the only persisted timeline mutation path, while React uses transient pointer state and commits once on pointer-up.

**Tech Stack:** PostgreSQL + Drizzle, Cloudflare R2/S3, Next.js 15 App Router, React 19, TypeScript 5.7, HTML Canvas, Mediabunny, Python 3 worker + ffprobe, Vitest, Testing Library, pytest.

## Global Constraints

- Preserve the existing uncommitted polling changes in `apps/web/components/ClipEditor.tsx` and `apps/web/test/EditorWorkspace.test.tsx`; merge around them.
- Edit specs migrate deterministically from V2 to V3 and autosave V3 only.
- Image limit is 10 MB, audio limit is 25 MB, video limit is 100 MB, and active upload quota is 300 MB per project.
- Uploaded assets expire after three days without project-open or export activity; warn one day before expiry.
- Incomplete uploads expire after one hour.
- Uploaded video creates a linked audio clip that starts muted.
- Image default duration is five seconds; audio/video use native duration and clamp to the existing primary output duration.
- Visual coordinates use normalized `0..1` values; move and resize commit one history entry per completed gesture.
- Caption dragging updates one global caption X/Y position, not individual caption segments.
- No rotation, filters, keyframes, custom effects, cloud rendering, or audio crossfade.
- Every drag action has button or numeric-input parity; mobile touch targets are at least 44 × 44 pixels.
- Follow strict RED → GREEN → REFACTOR for every behavior and run focused validation after every production edit.

---

## File Structure

### Database and worker

- `packages/db/src/schema.ts`: `mediaAssets` table and `probe_asset` job type.
- `packages/db/migrations/0001_media_assets.sql`: generated table, constraints, indexes, and project-delete expiry trigger.
- `packages/db/migrations/meta/0001_snapshot.json`: generated Drizzle snapshot.
- `packages/db/migrations/meta/_journal.json`: generated migration journal entry.
- `packages/db/sql/900_rls.sql`: uploaded/candidate asset RLS.
- `packages/db/test/schema.test.ts`: asset constraint and quota-query fixtures.
- `packages/db/test/rls.test.ts`: owner isolation.
- `apps/downloader/app/ffmpeg.py`: ffprobe metadata reader.
- `apps/downloader/app/handlers/probe_asset.py`: media validation and ready/failed state.
- `apps/downloader/app/reaper.py`: expired/incomplete upload deletion.
- `apps/downloader/app/storage.py`: object deletion.
- `apps/downloader/app/worker.py`: probe handler and cleanup cadence.
- `apps/downloader/tests/test_probe_asset.py`: probe handler behavior.
- `apps/downloader/tests/test_reaper.py`: three-day and one-hour cleanup.

### Engine

- `packages/engine/src/timeline/types.ts`: EditSpecV3, asset context, transforms, muted clips, and new commands.
- `packages/engine/src/timeline/defaults.ts`: V3 candidate defaults.
- `packages/engine/src/timeline/normalize.ts`: V1/V2 → V3 migration and asset authorization normalization.
- `packages/engine/src/timeline/commands.ts`: insert, transform, mute, move, and caption commands.
- `packages/engine/src/timeline/mapping.ts`: asset-aware active item mapping.
- `packages/engine/src/compositor.ts`: transformed image/video drawing.
- `packages/engine/src/index.ts`: public V3 exports.
- `packages/engine/test/timelineNormalize.test.ts`: migration and invalid asset repair.
- `packages/engine/test/timelineCommands.test.ts`: media insertion and transform mutations.
- `packages/engine/test/timelineMapping.test.ts`: image/audio/video active mapping.
- `packages/engine/test/compositor.test.ts`: transformed draw rectangles.

### Web API and UI

- `apps/web/lib/r2.ts`: presigned PUT, HEAD, and delete helpers.
- `apps/web/lib/mediaAssets.ts`: limits, ownership, quota, create/finalize/list/resolve/touch domain logic.
- `apps/web/lib/clipTypes.ts`: resolved media payload and EditSpecV3.
- `apps/web/lib/clips.ts`: candidate asset upsert, V3 load/save, reference validation, and retention touch.
- `apps/web/app/api/projects/[id]/assets/route.ts`: list and create upload.
- `apps/web/app/api/projects/[id]/assets/[assetId]/complete/route.ts`: finalize and enqueue probe.
- `apps/web/app/api/projects/[id]/assets/[assetId]/route.ts`: delete upload.
- `apps/web/app/api/assets/[id]/content/route.ts`: same-origin protected asset stream.
- `apps/web/test/mediaAssets.test.ts`: domain tests with PostgreSQL.
- `apps/web/test/mediaAssetRoutes.test.ts`: route authentication and response tests.
- `apps/web/components/editor/assetUpload.ts`: XHR upload progress client.
- `apps/web/components/editor/MediaLibrary.tsx`: upload queue and project asset list.
- `apps/web/components/editor/canvasGeometry.ts`: pure normalized drag/resize math.
- `apps/web/components/editor/CanvasSelectionOverlay.tsx`: pointer/touch selection overlay.
- `apps/web/components/editor/AssetInspector.tsx`: numeric transform and clip mute controls.
- `apps/web/components/editor/EditorWorkspace.tsx`: desktop media rail and mobile media sheet.
- `apps/web/components/editor/TimelineClip.tsx`: timeline drag affordance.
- `apps/web/components/editor/TimelinePreview.tsx`: per-asset image/video/audio pool and canvas overlay.
- `apps/web/components/editor/timelinePlayback.ts`: skip image elements during media transport.
- `apps/web/components/ClipEditor.tsx`: asset loading, insertion, selection, warnings, and command wiring.
- `apps/web/lib/browserExport.ts`: multiple asset decoders and transformed composition.
- `apps/web/test/assetUpload.test.ts`: progress/retry client.
- `apps/web/test/CanvasSelectionOverlay.test.tsx`: move/resize/caption commits.
- `apps/web/test/MediaLibrary.test.tsx`: upload and insert UI.
- `apps/web/test/TimelineEditor.test.tsx`: timeline move.
- `apps/web/test/EditorWorkspace.test.tsx`: integrated asset persistence and warnings.
- `apps/web/test/browserExport.test.ts`: multi-asset video/image/audio export.

---

### Task 1: Persist the Media Asset Catalog with RLS

**Files:**
- Modify: `packages/db/src/schema.ts`
- Create: `packages/db/migrations/0001_media_assets.sql`
- Create: `packages/db/migrations/meta/0001_snapshot.json`
- Modify: `packages/db/migrations/meta/_journal.json`
- Modify: `packages/db/sql/900_rls.sql`
- Modify: `packages/db/test/schema.test.ts`
- Modify: `packages/db/test/rls.test.ts`

**Interfaces:**
- Consumes: existing `profiles`, `projects`, `clips`, and `jobs` tables.
- Produces: exported `mediaAssets` Drizzle table and allowed job type `probe_asset`.

- [ ] **Step 1: Write failing schema and RLS tests**

Append concrete tests that create a project, insert one upload, reject invalid source ownership, and prove Bob cannot read Alice's asset:

```ts
test('uploaded media asset requires owner project expiry and storage key', async () => {
  const userId = await makeUser(sql, 'asset-owner@test.id')
  const [source] = await sql`
    insert into sources (kind, external_id, is_public, url_original, status)
    values ('youtube', 'assetsource1', true, 'https://youtu.be/assetsource1', 'ready')
    returning id`
  const [project] = await sql`
    insert into projects (user_id, source_id, title)
    values (${userId}, ${source!.id}, 'Asset project') returning id`

  await expect(sql`
    insert into media_assets
      (project_id, source, media_type, status, name, mime_type, bytes)
    values
      (${project!.id}, 'upload', 'image', 'uploading', 'logo.png', 'image/png', 20)
  `).rejects.toThrow(/check constraint/)
})

test('bob cannot read alice uploaded media asset', async () => {
  const rows = await asUser(
    sql,
    bob,
    (tx) => tx`select id from media_assets where user_id = ${alice}`,
  )
  expect(rows).toHaveLength(0)
})
```

- [ ] **Step 2: Run the database tests and verify RED**

Run:

```bash
bun x vitest run packages/db/test/schema.test.ts packages/db/test/rls.test.ts
```

Expected: FAIL because `media_assets` does not exist and `probe_asset` violates `jobs_type_chk`.

- [ ] **Step 3: Add the Drizzle table and RLS policy**

Add this exported table shape and extend `jobs_type_chk`:

```ts
export const mediaAssets = pgTable(
  'media_assets',
  {
    id: id(),
    userId: uuid('user_id').references(() => profiles.userId, {
      onDelete: 'cascade',
    }),
    projectId: uuid('project_id').references(() => projects.id, {
      onDelete: 'set null',
    }),
    candidateClipId: uuid('candidate_clip_id').references(() => clips.id, {
      onDelete: 'cascade',
    }),
    source: text('source').notNull(),
    mediaType: text('media_type').notNull(),
    status: text('status').notNull().default('uploading'),
    name: text('name').notNull(),
    storageKey: text('storage_key'),
    mimeType: text('mime_type').notNull(),
    bytes: bigint('bytes', { mode: 'number' }).notNull().default(0),
    width: integer('width'),
    height: integer('height'),
    durationSec: numeric('duration_sec', { precision: 10, scale: 3 }),
    hasAudio: boolean('has_audio').notNull().default(false),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('media_assets_source_chk', sql`${t.source} in ('candidate','upload')`),
    check('media_assets_type_chk', sql`${t.mediaType} in ('image','audio','video')`),
    check('media_assets_status_chk', sql`${t.status} in ('uploading','ready','failed','expired')`),
    check(
      'media_assets_owner_chk',
      sql`${t.userId} is not null and ${t.projectId} is not null or ${t.status} = 'expired'`,
    ),
    check(
      'media_assets_upload_chk',
      sql`${t.source} <> 'upload' or (${t.candidateClipId} is null and ${t.storageKey} is not null and ${t.expiresAt} is not null)`,
    ),
    check(
      'media_assets_candidate_chk',
      sql`${t.source} <> 'candidate' or ${t.candidateClipId} is not null`,
    ),
    uniqueIndex('media_assets_candidate_uniq').on(t.candidateClipId),
    uniqueIndex('media_assets_storage_key_uniq').on(t.storageKey),
    index('media_assets_project_idx').on(t.projectId, t.status),
    index('media_assets_expiry_idx').on(t.status, t.expiresAt),
  ],
)
```

Declare `mediaAssets` after `clips` so the candidate foreign-key callback does
not introduce a declaration-order cycle.

Add RLS:

```sql
alter table media_assets enable row level security;

create policy media_assets_self on media_assets
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
```

- [ ] **Step 4: Generate migration metadata and run GREEN**

Run:

```bash
bun --cwd packages/db run generate --name media_assets
```

Append this project cleanup trigger to `0001_media_assets.sql` after the
generated table/index statements:

```sql
create or replace function public.expire_project_media_assets()
returns trigger language plpgsql as $$
begin
  update media_assets
     set status = 'expired', expires_at = now(), project_id = null,
         updated_at = now()
   where project_id = old.id and source = 'upload';
  return old;
end;
$$;

create trigger projects_expire_media_assets
before delete on projects
for each row execute function public.expire_project_media_assets();
```

Then run:

```bash
bun x vitest run packages/db/test/schema.test.ts packages/db/test/rls.test.ts
```

Expected: PASS, including job insertion with type `probe_asset`.

- [ ] **Step 5: Commit the schema slice**

```bash
git add packages/db/src/schema.ts packages/db/migrations packages/db/sql/900_rls.sql packages/db/test/schema.test.ts packages/db/test/rls.test.ts
git commit -m "feat(db): add project media assets"
```

---

### Task 2: Add R2 Upload Primitives and Asset Domain Logic

**Files:**
- Modify: `apps/web/lib/r2.ts`
- Create: `apps/web/lib/mediaAssets.ts`
- Create: `apps/web/test/mediaAssets.test.ts`

**Interfaces:**
- Consumes: `media_assets`, `projects`, and `jobs`; existing authenticated user/project IDs.
- Produces:
  - `MEDIA_LIMITS: Record<MediaType, number>`
  - `createMediaUpload(sql, userId, projectId, input, deps): Promise<CreateMediaUploadResult>`
  - `finalizeMediaUpload(sql, userId, projectId, assetId, deps): Promise<{ assetId: string; jobId: string }>`
  - `listProjectUploads(sql, userId, projectId): Promise<{ assets: MediaAssetDto[]; usage: { usedBytes: number; limitBytes: number } }>`
  - `resolveClipAssets(sql, userId, clipId): Promise<ResolvedMediaAsset[]>`
  - `touchClipAssets(sql, userId, clipId): Promise<void>`
  - `deleteProjectUpload(sql, userId, projectId, assetId, deps): Promise<void>`

- [ ] **Step 1: Write failing ownership, quota, and finalization tests**

Use `freshDb()` and injected R2 methods. Cover exact limits and a 300 MB aggregate:

```ts
test('createMediaUpload enforces per-type and project quota', async () => {
  await expect(
    createMediaUpload(sql, alice, projectId, {
      name: 'huge.mp4',
      mediaType: 'video',
      mimeType: 'video/mp4',
      bytes: 100 * 1024 * 1024 + 1,
    }, fakeR2),
  ).rejects.toMatchObject({ code: 'ASSET_TOO_LARGE' })
})

test('finalize verifies the object before enqueueing probe_asset', async () => {
  const created = await createMediaUpload(sql, alice, projectId, imageInput, fakeR2)
  fakeR2.head.mockResolvedValue({ bytes: imageInput.bytes, contentType: 'image/png' })

  const result = await finalizeMediaUpload(
    sql,
    alice,
    projectId,
    created.asset.id,
    fakeR2,
  )

  expect(result.jobId).toMatch(UUID_RE)
  const [job] = await sql`select type, payload from jobs where id = ${result.jobId}`
  expect(job).toMatchObject({ type: 'probe_asset' })
})

test('opening a referenced upload refreshes three-day retention and warning state', async () => {
  await sql`
    update media_assets
       set status = 'ready', expires_at = now() + interval '12 hours'
     where id = ${assetId}`
  await touchClipAssets(sql, alice, clipId)
  const [asset] = await sql`
    select expires_at > now() + interval '71 hours' as refreshed
      from media_assets where id = ${assetId}`
  expect(asset!.refreshed).toBe(true)
})
```

- [ ] **Step 2: Run focused tests and verify RED**

```bash
bun x vitest run apps/web/test/mediaAssets.test.ts
```

Expected: FAIL because asset helpers and R2 PUT/HEAD/delete methods do not exist.

- [ ] **Step 3: Implement exact limits, errors, and R2 helpers**

Define:

```ts
export type MediaType = 'image' | 'audio' | 'video'

export const MEDIA_LIMITS: Record<MediaType, number> = {
  image: 10 * 1024 * 1024,
  audio: 25 * 1024 * 1024,
  video: 100 * 1024 * 1024,
}

export const PROJECT_MEDIA_QUOTA_BYTES = 300 * 1024 * 1024
export const UPLOAD_RETENTION_MS = 3 * 24 * 60 * 60 * 1000

export const ALLOWED_MEDIA_MIME = {
  image: ['image/png', 'image/jpeg', 'image/webp'],
  audio: ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4', 'audio/webm'],
  video: ['video/mp4', 'video/webm', 'video/quicktime'],
} as const

export type CreateMediaUploadResult = {
  asset: MediaAssetDto
  upload: { url: string; method: 'PUT'; headers: { 'content-type': string } }
}
```

Add `PutObjectCommand`, `DeleteObjectCommand`, and reusable HEAD output in `r2.ts`:

```ts
export async function signedR2Put(
  key: string,
  contentType: string,
  expiresIn = 900,
): Promise<string>

export async function headR2Object(
  key: string,
): Promise<{ bytes: number; contentType: string | null }>

export async function deleteR2Object(key: string): Promise<void>
```

Create storage keys only on the server as `uploads/{userId}/{projectId}/{assetId}/{safeExtension}`. All domain queries must join `projects p on p.id = media_assets.project_id` and filter `p.user_id = userId`. Treat `ready` and `uploading` upload bytes as active quota. `finalizeMediaUpload` HEAD-checks byte count and content type, then enqueues one active `probe_asset` job using the asset ID.

- [ ] **Step 4: Run tests and typecheck**

```bash
bun x vitest run apps/web/test/mediaAssets.test.ts
bun --cwd apps/web run typecheck
```

Expected: PASS with no unsafe cross-project query.

- [ ] **Step 5: Commit the asset domain slice**

```bash
git add apps/web/lib/r2.ts apps/web/lib/mediaAssets.ts apps/web/test/mediaAssets.test.ts
git commit -m "feat(web): add media upload domain"
```

---

### Task 3: Expose Authenticated Asset Routes

**Files:**
- Create: `apps/web/app/api/projects/[id]/assets/route.ts`
- Create: `apps/web/app/api/projects/[id]/assets/[assetId]/complete/route.ts`
- Create: `apps/web/app/api/projects/[id]/assets/[assetId]/route.ts`
- Create: `apps/web/app/api/assets/[id]/content/route.ts`
- Create: `apps/web/test/mediaAssetRoutes.test.ts`

**Interfaces:**
- Consumes: Task 2 domain functions and `supabaseServer()`.
- Produces: JSON upload/list/finalize/delete endpoints and a same-origin streamed media endpoint.

- [ ] **Step 1: Write failing route contract tests**

Mock auth/domain dependencies and assert these responses:

```ts
test('POST asset returns a presigned upload contract', async () => {
  const response = await POST(new Request('http://localhost/api/projects/project-1/assets', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'logo.png',
      mediaType: 'image',
      mimeType: 'image/png',
      bytes: 1200,
    }),
  }), { params: Promise.resolve({ id: 'project-1' }) })

  expect(response.status).toBe(201)
  await expect(response.json()).resolves.toMatchObject({
    upload: { method: 'PUT', headers: { 'content-type': 'image/png' } },
  })
})

test('asset content rejects a different owner before signing R2', async () => {
  loadAssetObject.mockRejectedValueOnce(new MediaAssetNotFoundError())
  const response = await GET_CONTENT(request, {
    params: Promise.resolve({ id: 'asset-bob' }),
  })
  expect(response.status).toBe(404)
  expect(signedR2Get).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run routes tests and verify RED**

```bash
bun x vitest run apps/web/test/mediaAssetRoutes.test.ts
```

Expected: FAIL because the route modules are absent.

- [ ] **Step 3: Implement consistent route responses**

Use these status mappings in every route:

```ts
const STATUS_BY_CODE = {
  ASSET_INVALID: 400,
  ASSET_TOO_LARGE: 413,
  ASSET_QUOTA_EXCEEDED: 413,
  ASSET_NOT_FOUND: 404,
  ASSET_NOT_READY: 409,
} as const
```

The content route calls `loadAssetObject` before `signedR2Get`, fetches upstream with `cache: 'no-store'`, and returns `cache-control: private, max-age=3600`, the stored MIME type, and content length. Do not expose `storageKey` in JSON DTOs.

- [ ] **Step 4: Run focused tests and typecheck**

```bash
bun x vitest run apps/web/test/mediaAssetRoutes.test.ts apps/web/test/segmentRoute.test.ts
bun --cwd apps/web run typecheck
```

Expected: PASS; the existing candidate segment route stays green.

- [ ] **Step 5: Commit the route slice**

```bash
git add apps/web/app/api/projects apps/web/app/api/assets apps/web/test/mediaAssetRoutes.test.ts
git commit -m "feat(web): expose secure media asset routes"
```

---

### Task 4: Probe Uploaded Media and Reap Expired Objects

**Files:**
- Modify: `apps/downloader/app/ffmpeg.py`
- Create: `apps/downloader/app/handlers/probe_asset.py`
- Modify: `apps/downloader/app/reaper.py`
- Modify: `apps/downloader/app/storage.py`
- Modify: `apps/downloader/app/worker.py`
- Create: `apps/downloader/tests/test_probe_asset.py`
- Modify: `apps/downloader/tests/test_reaper.py`
- Modify: `apps/downloader/tests/test_storage.py`

**Interfaces:**
- Consumes: `probe_asset` jobs with `{ "asset_id": string }` and private R2 object keys.
- Produces:
  - `probe_media(path: Path) -> MediaProbe`
  - `handle_probe_asset(conn, job, *, storage=None, probe=probe_media, workdir=None) -> None`
  - `reap_expired_media_assets(conn, storage, *, limit=100) -> int`
  - `Storage.delete(key: str) -> None`

- [ ] **Step 1: Write failing probe and cleanup tests**

Use generated ffmpeg fixtures and injected storage:

```python
def test_probe_video_marks_asset_ready_with_dimensions_and_audio(conn, job, tmp_path):
    storage = FakeStorage(download=tmp_path / "clip.mp4")
    handle_probe_asset(
        conn,
        job,
        storage=storage,
        probe=lambda _: MediaProbe("video", 4.2, 1920, 1080, True),
        workdir=tmp_path,
    )
    row = conn.execute(
        "select status, duration_sec, width, height, has_audio from media_assets where id = %s",
        (job.payload["asset_id"],),
    ).fetchone()
    assert row == ("ready", Decimal("4.200"), 1920, 1080, True)

def test_reaper_deletes_three_day_and_incomplete_one_hour_objects(conn):
    storage = FakeStorage()
    assert reap_expired_media_assets(conn, storage) == 2
    assert storage.deleted == ["uploads/expired.mp4", "uploads/incomplete.png"]
```

- [ ] **Step 2: Run pytest and verify RED**

```bash
uv run --directory apps/downloader pytest tests/test_probe_asset.py tests/test_reaper.py tests/test_storage.py -q
```

Expected: FAIL because probe, delete, and asset reaper interfaces are absent.

- [ ] **Step 3: Implement ffprobe validation and idempotent cleanup**

Define:

```python
@dataclass(frozen=True)
class MediaProbe:
    media_type: Literal["image", "audio", "video"]
    duration_sec: float | None
    width: int | None
    height: int | None
    has_audio: bool
```

`probe_media` runs `ffprobe -v error -show_streams -show_format -of json`. The handler locks the asset through owner/project/job matching, downloads to a private temporary directory, rejects detected media type mismatch with terminal `JobError("ASSET_INVALID", ...)`, and commits `ready` metadata. On terminal failure, set asset status `failed` before re-raising.

`reap_expired_media_assets` selects `upload` rows where either `expires_at <= now()` or `status = 'uploading' and created_at <= now() - interval '1 hour'`, locks at most 100 with `for update skip locked`, deletes each R2 key, then marks the row `expired`. Calling it twice returns zero the second time.

Register `probe_asset` in `worker.main()` and call the asset reaper once per hour while stale-job reaping remains once per minute.

- [ ] **Step 4: Run worker tests and lint-equivalent validation**

```bash
uv run --directory apps/downloader pytest tests/test_probe_asset.py tests/test_reaper.py tests/test_storage.py tests/test_worker.py -q
uv run --directory apps/downloader python -m compileall -q app tests
```

Expected: PASS with no object deletion on candidate assets.

- [ ] **Step 5: Commit the worker slice**

```bash
git add apps/downloader/app apps/downloader/tests
git commit -m "feat(worker): validate and expire media uploads"
```

---

### Task 5: Introduce EditSpecV3 and Deterministic Asset Migration

**Files:**
- Modify: `packages/engine/src/timeline/types.ts`
- Modify: `packages/engine/src/timeline/defaults.ts`
- Modify: `packages/engine/src/timeline/normalize.ts`
- Modify: `packages/engine/src/timeline/index.ts`
- Modify: `packages/engine/src/index.ts`
- Modify: `packages/engine/test/timelineFixtures.ts`
- Modify: `packages/engine/test/timelineNormalize.test.ts`

**Interfaces:**
- Consumes: V1/V2 unknown input plus authorized `TimelineAssetContext` records.
- Produces: `EditSpecV3`, `normalizeEditSpecV3(input, context)`, and V3 defaults.

- [ ] **Step 1: Write failing V2 migration and unauthorized asset tests**

```ts
const context: TimelineContext = {
  candidateDuration: 30,
  sourceId: 'clip-1',
  candidateAssetId: 'asset-candidate',
  assets: {
    'asset-candidate': {
      id: 'asset-candidate',
      mediaType: 'video',
      duration: 30,
      width: 1920,
      height: 1080,
      hasAudio: true,
    },
  },
}

test('migrates V2 sourceId to the authorized candidate asset', () => {
  const migrated = normalizeEditSpecV3(createDefaultEditSpecV2(legacyContext), context)
  expect(migrated.version).toBe(3)
  expect(migrated.timeline.tracks[0]!.clips[0]).toMatchObject({
    assetId: 'asset-candidate',
    transform: { x: 0, y: 0, width: 1, height: 1 },
  })
  expect(migrated.captions.positionX).toBe(0.5)
})

test('drops clips that reference assets outside the normalization context', () => {
  const normalized = normalizeEditSpecV3(v3WithAsset('asset-bob'), context)
  expect(normalized.timeline.tracks.flatMap((track) => track.clips))
    .not.toContainEqual(expect.objectContaining({ assetId: 'asset-bob' }))
})
```

- [ ] **Step 2: Run engine normalization and verify RED**

```bash
bun x vitest run packages/engine/test/timelineNormalize.test.ts
```

Expected: FAIL because V3 types and normalizer do not exist.

- [ ] **Step 3: Implement V3 types and normalizer**

Use these exact public contracts:

```ts
export type MediaType = 'image' | 'audio' | 'video'

export interface VisualTransform {
  x: number
  y: number
  width: number
  height: number
}

export interface TimelineAssetContext {
  id: string
  mediaType: MediaType
  duration: number | null
  width: number | null
  height: number | null
  hasAudio: boolean
}

export interface TimelineContext {
  candidateDuration: number
  sourceId: string
  candidateAssetId: string
  assets: Record<string, TimelineAssetContext>
}

export interface TimelineClip {
  id: string
  assetId: string
  linkGroupId?: string
  timelineStart: number
  sourceIn: number
  sourceOut: number
  muted: boolean
  transform?: VisualTransform
}

export interface EditSpecV3 {
  version: 3
  output: EditSpecV1['output']
  crop: EditSpecV1['crop']
  captions: EditSpecV1['captions'] & { positionX: number }
  timeline: {
    primaryTrackId: string
    duration: number
    tracks: TimelineTrack[]
    transitions: TimelineTransition[]
  }
}
```

Define the transition contract now for Plan 3, but normalize all transition input to `[]` until that plan adds validation:

```ts
export type TimelineTransition = {
  id: string
  type: 'fade' | 'cross-dissolve' | 'dip-to-black'
  duration: number
  target:
    | { kind: 'clip-edge'; clipId: string; edge: 'in' | 'out' }
    | { kind: 'between-clips'; trackId: string; fromClipId: string; toClipId: string }
}
```

Keep `normalizeEditSpecV2` exported for compatibility tests, but switch web/editor callers in Task 7. V3 clamps caption X/Y to `0.05..0.95`, transform size to `0.05..2`, and position to `-1..1`; this permits intentional partial off-canvas placement without losing the asset.

- [ ] **Step 4: Run engine normalization and typecheck**

```bash
bun x vitest run packages/engine/test/timelineNormalize.test.ts
bun --cwd packages/engine run typecheck
```

Expected: PASS and repeated V3 normalization is deeply equal.

- [ ] **Step 5: Commit V3 migration**

```bash
git add packages/engine/src packages/engine/test/timelineFixtures.ts packages/engine/test/timelineNormalize.test.ts
git commit -m "feat(engine): migrate timeline assets to edit spec v3"
```

---

### Task 6: Add Pure Media Insert, Transform, Mute, and Move Commands

**Files:**
- Modify: `packages/engine/src/timeline/types.ts`
- Modify: `packages/engine/src/timeline/commands.ts`
- Modify: `packages/engine/src/timeline/mapping.ts`
- Modify: `packages/engine/test/timelineCommands.test.ts`
- Modify: `packages/engine/test/timelineMapping.test.ts`

**Interfaces:**
- Consumes: Task 5 V3 types and authorized asset context.
- Produces: `insertAsset`, `replaceAsset`, `updateVisualTransform`, `setClipMuted`, and asset-aware `moveClip` behavior.

- [ ] **Step 1: Write failing command tests**

```ts
const findClip = (input: EditSpecV3, clipId: string) =>
  input.timeline.tracks.flatMap((track) => track.clips)
    .find((clip) => clip.id === clipId)

test('inserts a five-second image at playhead with a centered transform', () => {
  const next = applyTimelineCommand(spec, {
    type: 'insertAsset',
    assetId: 'asset-image',
    trackId: 'overlay-images',
    trackName: 'Images',
    clipId: 'image-1',
    timelineStart: 8,
  }, contextWithImage)

  expect(findClip(next, 'image-1')).toMatchObject({
    assetId: 'asset-image',
    timelineStart: 8,
    sourceIn: 0,
    sourceOut: 5,
    muted: false,
    transform: { x: 0.2, y: 0.2, width: 0.6, height: 0.6 },
  })
})

test('uploaded video inserts linked muted audio', () => {
  const next = applyTimelineCommand(spec, videoInsertCommand, contextWithVideo)
  const linked = next.timeline.tracks.flatMap((track) => track.clips)
    .filter((clip) => clip.linkGroupId === videoInsertCommand.linkGroupId)
  expect(linked).toHaveLength(2)
  expect(linked.find((clip) => clip.id === 'video-audio')).toMatchObject({ muted: true })
})

test('replaces an expired image without losing timing or transform', () => {
  const next = applyTimelineCommand(specWithExpiredImage, {
    type: 'replaceAsset',
    fromAssetId: 'asset-expired',
    toAssetId: 'asset-replacement',
  }, contextWithReplacement)
  expect(findClip(next, 'image-1')).toMatchObject({
    assetId: 'asset-replacement',
    timelineStart: 8,
    transform: { x: 0.2, y: 0.2, width: 0.6, height: 0.6 },
  })
})
```

- [ ] **Step 2: Run command tests and verify RED**

```bash
bun x vitest run packages/engine/test/timelineCommands.test.ts packages/engine/test/timelineMapping.test.ts
```

Expected: FAIL because the new command union and asset-aware mapping are absent.

- [ ] **Step 3: Implement the command contracts**

Add:

```ts
export type AssetTimelineCommand =
  | {
      type: 'insertAsset'
      assetId: string
      trackId: string
      trackName: string
      clipId: string
      timelineStart: number
      initialTransform?: VisualTransform
      linkGroupId?: string
      linkedAudio?: { trackId: string; trackName: string; clipId: string }
    }
  | {
      type: 'updateVisualTransform'
      trackId: string
      clipId: string
      transform: VisualTransform
    }
  | { type: 'setClipMuted'; trackId: string; clipId: string; muted: boolean }
  | { type: 'replaceAsset'; fromAssetId: string; toAssetId: string }
```

Append every `AssetTimelineCommand` variant to the existing `TimelineCommand`
union. `insertAsset` rejects unknown assets and audio assets on video tracks,
creates a non-primary track only when missing, clips duration to
`spec.timeline.duration - timelineStart`, uses five seconds for images, applies
an optional normalized `initialTransform`, and
adds linked muted audio only for `video.hasAudio`. `replaceAsset` requires a
same-media-type authorized replacement, swaps every matching clip reference,
clamps `sourceOut` to the new native duration, and preserves transform,
timeline start, mute, and link group. `moveClip` clamps non-primary clips to
`0..timeline.duration - clipDuration`. Locked tracks remain immutable.

Extend `ActiveTimelineItem`:

```ts
export interface ActiveTimelineItem {
  trackId: string
  trackType: TrackType
  clipId: string
  assetId: string
  mediaType: MediaType
  outputTime: number
  sourceTime: number
  order: number
  muted: boolean
  transform?: VisualTransform
}
```

- [ ] **Step 4: Run engine tests and typecheck**

```bash
bun x vitest run packages/engine/test/timelineCommands.test.ts packages/engine/test/timelineMapping.test.ts
bun --cwd packages/engine run typecheck
```

Expected: PASS, including unchanged primary ripple tests.

- [ ] **Step 5: Commit the engine command slice**

```bash
git add packages/engine/src/timeline packages/engine/test/timelineCommands.test.ts packages/engine/test/timelineMapping.test.ts
git commit -m "feat(engine): add asset timeline commands"
```

---

### Task 7: Load, Authorize, Touch, and Save V3 Assets with Clips

**Files:**
- Modify: `apps/web/lib/clipTypes.ts`
- Modify: `apps/web/lib/clips.ts`
- Modify: `apps/web/app/api/clips/[id]/route.ts`
- Modify: `apps/web/test/clips.test.ts`
- Modify: `apps/web/test/editorFixtures.ts`

**Interfaces:**
- Consumes: Task 2 asset queries and Task 5 `normalizeEditSpecV3`.
- Produces: `ClipEditorPayload.assets: ResolvedMediaAsset[]` and V3 PATCH validation.

- [ ] **Step 1: Write failing load/save authorization tests**

```ts
test('loadClipEditor migrates candidate to V3 and returns resolved assets', async () => {
  const payload = await loadClipEditor(sql, ownerId, clipId)
  expect(payload.clip.editSpec.version).toBe(3)
  expect(payload.assets).toEqual([
    expect.objectContaining({
      mediaType: 'video',
      url: `/api/clips/${clipId}/segment`,
      status: 'ready',
    }),
  ])
})

test('updateClip drops a cross-project asset reference', async () => {
  const result = await updateClip(sql, alice, clipId, {
    editSpec: specReferencing(bobAssetId),
  })
  expect(result.editSpec.timeline.tracks.flatMap((track) => track.clips))
    .not.toContainEqual(expect.objectContaining({ assetId: bobAssetId }))
})
```

- [ ] **Step 2: Run clip tests and verify RED**

```bash
bun x vitest run apps/web/test/clips.test.ts
```

Expected: FAIL because payloads still return EditSpecV2 and one segment URL.

- [ ] **Step 3: Implement candidate upsert, V3 context, and resolved payloads**

Define DTO:

```ts
export interface ResolvedMediaAsset {
  id: string
  name: string
  mediaType: 'image' | 'audio' | 'video'
  status: 'uploading' | 'ready' | 'failed' | 'expired'
  url: string | null
  bytes: number
  width: number | null
  height: number | null
  duration: number | null
  hasAudio: boolean
  expiresAt: string | null
  expiresSoon: boolean
}
```

Inside `loadClipEditor`, upsert one `source='candidate'` row keyed by `candidate_clip_id`, query every uploaded asset ID referenced by stored JSON only when it belongs to the same project/user, build `TimelineContext.assets`, normalize V3, touch ready upload expiries to `now() + interval '3 days'`, and return same-origin URLs. Inside `updateClip`, perform the same authorized asset query before normalization, touch referenced ready uploads, and never trust IDs from the body.

Keep `segment.url` during compatibility; the candidate entry in `assets` points to it. Existing `markRenderStatus('rendering')` calls PATCH immediately before export, so export refreshes asset retention without a separate endpoint.

- [ ] **Step 4: Run clips and workspace fixtures tests**

```bash
bun x vitest run apps/web/test/clips.test.ts apps/web/test/editorViewState.test.ts
bun --cwd apps/web run typecheck
```

Expected: PASS with V3 fixture payloads.

- [ ] **Step 5: Commit V3 web persistence**

```bash
git add apps/web/lib/clipTypes.ts apps/web/lib/clips.ts apps/web/app/api/clips apps/web/test/clips.test.ts apps/web/test/editorFixtures.ts
git commit -m "feat(web): persist authorized edit spec v3 assets"
```

---

### Task 8: Build the Upload Queue and Media Library

**Files:**
- Create: `apps/web/components/editor/assetUpload.ts`
- Create: `apps/web/components/editor/MediaLibrary.tsx`
- Create: `apps/web/test/assetUpload.test.ts`
- Create: `apps/web/test/MediaLibrary.test.tsx`

**Interfaces:**
- Consumes: Task 3 asset API routes.
- Produces:
  - `uploadMediaAsset(projectId, file, onProgress): Promise<ResolvedMediaAsset>`
  - `MediaLibrary({ projectId, assets, playhead, onAssetsChange, onInsert })`
  - `onInsert(asset, placement?: { timelineStart?: number; transform?: VisualTransform })`

- [ ] **Step 1: Write failing progress, retry, validation, and insert tests**

```ts
test('uploadMediaAsset reports PUT progress then finalizes', async () => {
  const progress: number[] = []
  const result = await uploadMediaAsset('project-1', pngFile, (value) => progress.push(value), {
    fetch: fetchMock,
    createXhr: () => fakeXhr,
  })
  expect(progress).toEqual([0, 0.5, 1])
  expect(fetchMock).toHaveBeenLastCalledWith(
    '/api/projects/project-1/assets/asset-1/complete',
    expect.objectContaining({ method: 'POST' }),
  )
  expect(result.id).toBe('asset-1')
})

test('clicking ready image inserts it at the current playhead', async () => {
  const onInsert = vi.fn()
  render(<MediaLibrary {...props} onInsert={onInsert} />)
  await userEvent.click(screen.getByRole('button', { name: 'Tambahkan logo.png' }))
  expect(onInsert).toHaveBeenCalledWith(expect.objectContaining({ id: 'asset-image' }))
})
```

- [ ] **Step 2: Run focused tests and verify RED**

```bash
bun x vitest run apps/web/test/assetUpload.test.ts apps/web/test/MediaLibrary.test.tsx
```

Expected: FAIL because upload client and library do not exist.

- [ ] **Step 3: Implement the upload client and accessible library**

Use XHR only for the R2 PUT so progress events are real; keep create/list/finalize on `fetch`. Validate against exported limits before POST. Poll the list endpoint every two seconds only while an asset is `uploading`, stop on unmount, and expose Retry/Delete buttons with asset names.

Use this insert callback:

```ts
export type InsertMediaAsset = (
  asset: ResolvedMediaAsset,
  placement?: { timelineStart?: number; transform?: VisualTransform },
) => void
```

The library groups uploads by `ready`, `uploading`, `failed`, and `expired` and
shows `usage.usedBytes / usage.limitBytes`. Ready items support click/tap insert
and `application/x-cheapclipper-asset` drag data. Expired items expose Replace:
upload the selected file as a new asset, wait for `ready`, then dispatch one
`replaceAsset` command from the expired ID to the new ID. Failed upload Retry
creates a fresh upload record but never inserts either record into the timeline
until ready, so it cannot duplicate a timeline clip. Announce progress and
outcomes through an `aria-live="polite"` region.

- [ ] **Step 4: Run component tests and typecheck**

```bash
bun x vitest run apps/web/test/assetUpload.test.ts apps/web/test/MediaLibrary.test.tsx
bun --cwd apps/web run typecheck
```

Expected: PASS with timers cleaned up and no duplicate finalize call.

- [ ] **Step 5: Commit the upload UI slice**

```bash
git add apps/web/components/editor/assetUpload.ts apps/web/components/editor/MediaLibrary.tsx apps/web/test/assetUpload.test.ts apps/web/test/MediaLibrary.test.tsx
git commit -m "feat(web): add media upload library"
```

---

### Task 9: Add Canvas Move/Resize and Global Caption Dragging

**Files:**
- Create: `apps/web/components/editor/canvasGeometry.ts`
- Create: `apps/web/components/editor/CanvasSelectionOverlay.tsx`
- Create: `apps/web/components/editor/AssetInspector.tsx`
- Modify: `apps/web/components/editor/CaptionControls.tsx`
- Modify: `apps/web/components/editor/TimelinePreview.tsx`
- Modify: `packages/engine/src/compositor.ts`
- Create: `packages/engine/test/compositor.test.ts`
- Create: `apps/web/test/CanvasSelectionOverlay.test.tsx`
- Modify: `apps/web/test/EditorControls.test.tsx`

**Interfaces:**
- Consumes: V3 transforms and `updateVisualTransform`/`updateCaptions` commands.
- Produces: one commit callback per pointer gesture and transformed canvas rendering.

- [ ] **Step 1: Write failing geometry, component, and compositor tests**

```ts
test('drag converts CSS pixel delta into normalized position', () => {
  expect(moveTransform(
    { x: 0.2, y: 0.3, width: 0.4, height: 0.2 },
    { x: 54, y: -96 },
    { width: 540, height: 960 },
  )).toEqual({ x: 0.3, y: 0.2, width: 0.4, height: 0.2 })
})

test('caption pointer drag commits global X and Y once', () => {
  const pointerAt = (clientX: number, clientY: number) => ({
    pointerId: 1,
    clientX,
    clientY,
  })
  render(<CanvasSelectionOverlay {...captionProps} />)
  fireEvent.pointerDown(screen.getByLabelText('Pindahkan caption'), pointerAt(100, 100))
  fireEvent.pointerMove(window, pointerAt(140, 160))
  fireEvent.pointerUp(window, pointerAt(140, 160))
  expect(onCommit).toHaveBeenCalledTimes(1)
  expect(onCommit).toHaveBeenCalledWith(expect.objectContaining({ kind: 'caption' }))
})
```

- [ ] **Step 2: Run focused tests and verify RED**

```bash
bun x vitest run apps/web/test/CanvasSelectionOverlay.test.tsx apps/web/test/EditorControls.test.tsx packages/engine/test/compositor.test.ts
```

Expected: FAIL because geometry, overlay, X caption position, and transformed drawing are absent.

- [ ] **Step 3: Implement transient pointer geometry and transformed drawing**

Export pure helpers:

```ts
export function moveTransform(
  start: VisualTransform,
  delta: { x: number; y: number },
  bounds: { width: number; height: number },
): VisualTransform

export function resizeTransform(
  start: VisualTransform,
  corner: 'nw' | 'ne' | 'sw' | 'se',
  delta: { x: number; y: number },
  bounds: { width: number; height: number },
  aspectRatio: number,
): VisualTransform
```

The overlay keeps local transform state during pointer move, captures the pointer, and invokes `onCommit` only at pointer-up/cancel. Media gets four 44 × 44 corner handles; caption gets a move region only. `AssetInspector` provides numeric X/Y/width/height and clip mute checkbox.

Extend `TimelineVisualLayer` with `clipId`, `transform`, `opacity`, and `primary`. Primary full-canvas video keeps existing crop behavior. Non-primary video/image uses its transform destination rectangle and `contain` math so resize never stretches the media.

- [ ] **Step 4: Run focused tests and typecheck**

```bash
bun x vitest run apps/web/test/CanvasSelectionOverlay.test.tsx apps/web/test/EditorControls.test.tsx packages/engine/test/compositor.test.ts
bun run typecheck
```

Expected: PASS; pointer moves do not dispatch before pointer-up.

- [ ] **Step 5: Commit canvas manipulation**

```bash
git add apps/web/components/editor packages/engine/src/compositor.ts packages/engine/test/compositor.test.ts apps/web/test/CanvasSelectionOverlay.test.tsx apps/web/test/EditorControls.test.tsx
git commit -m "feat(editor): drag captions and resize visual media"
```

---

### Task 10: Add Timeline Dragging and Workspace Integration

**Files:**
- Modify: `apps/web/components/editor/EditorWorkspace.tsx`
- Modify: `apps/web/components/editor/TimelineClip.tsx`
- Modify: `apps/web/components/editor/TimelineEditor.tsx`
- Modify: `apps/web/components/editor/LayerInspector.tsx`
- Modify: `apps/web/components/ClipEditor.tsx`
- Modify: `apps/web/app/globals.css`
- Modify: `apps/web/test/TimelineEditor.test.tsx`
- Modify: `apps/web/test/EditorWorkspace.test.tsx`

**Interfaces:**
- Consumes: Tasks 6–9 commands/components.
- Produces: desktop media rail, mobile media sheet, playhead insertion, timeline move, expiry warnings, and one synchronized selection.

- [ ] **Step 1: Write failing integrated editor tests**

```ts
function assetTransfer(assetId: string): DataTransfer {
  const payload = JSON.stringify({ assetId })
  return {
    effectAllowed: 'copy',
    dropEffect: 'copy',
    files: [] as unknown as FileList,
    items: [] as unknown as DataTransferItemList,
    types: ['application/x-cheapclipper-asset'],
    clearData: () => undefined,
    getData: (format: string) =>
      format === 'application/x-cheapclipper-asset' ? payload : '',
    setData: () => undefined,
    setDragImage: () => undefined,
  }
}

test('inserted image starts at playhead and autosaves V3', async () => {
  render(<ClipEditor clipId="clip-1" />)
  await screen.findByLabelText('Preview video vertikal')
  fireEvent.change(screen.getByLabelText('Posisi playhead'), { target: { value: '8' } })
  await userEvent.click(screen.getByRole('button', { name: 'Tambahkan logo.png' }))

  await waitFor(() => {
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH')!
    const body = JSON.parse(String(patch[1]!.body))
    expect(body.editSpec.version).toBe(3)
    const clips = body.editSpec.timeline.tracks.flatMap(
      (track: { clips: unknown[] }) => track.clips,
    )
    expect(clips).toContainEqual(expect.objectContaining({
      assetId: 'asset-image',
      timelineStart: 8,
    }))
  })
})

test('timeline pointer drag commits one move command', () => {
  render(<TimelineEditor {...propsWithOverlayClip} />)
  const clip = screen.getByRole('button', { name: /Images, 5.0 detik/ })
  fireEvent.pointerDown(clip, { pointerId: 1, clientX: 100 })
  fireEvent.pointerMove(window, { pointerId: 1, clientX: 172 })
  fireEvent.pointerUp(window, { pointerId: 1, clientX: 172 })
  expect(onCommand).toHaveBeenCalledTimes(1)
  expect(onCommand).toHaveBeenCalledWith(expect.objectContaining({
    type: 'moveClip',
    timelineStart: 2,
  }))
})

test('dropping an image on canvas inserts it at the normalized drop point', () => {
  render(<TimelinePreview {...previewProps} />)
  const transfer = assetTransfer('asset-image')
  const canvas = screen.getByLabelText('Preview video vertikal')
  fireEvent.dragOver(canvas, { dataTransfer: transfer })
  fireEvent.drop(canvas, { dataTransfer: transfer, clientX: 405, clientY: 240 })
  expect(onAssetDrop).toHaveBeenCalledWith(
    'asset-image',
    expect.objectContaining({ transform: expect.objectContaining({ x: 0.6, y: 0.2 }) }),
  )
})

test('dropping audio on a timeline track uses the pointer time', () => {
  render(<TimelineEditor {...propsWithAudioTrack} />)
  const transfer = assetTransfer('asset-audio')
  fireEvent.drop(screen.getByLabelText('Audio timeline drop area'), {
    dataTransfer: transfer,
    clientX: 372,
  })
  expect(onAssetDrop).toHaveBeenCalledWith(
    'asset-audio',
    expect.objectContaining({ timelineStart: 5 }),
  )
})
```

- [ ] **Step 2: Run editor tests and verify RED**

```bash
bun x vitest run apps/web/test/TimelineEditor.test.tsx apps/web/test/EditorWorkspace.test.tsx
```

Expected: FAIL because workspace has no media rail and clips cannot move.

- [ ] **Step 3: Wire media, canvas, inspector, and timeline interactions**

Add `mediaLibrary: ReactNode` to `EditorWorkspaceProps`. Desktop grid becomes `14rem minmax(0,1fr) 20rem`; mobile gets a `Media` sheet beside `Inspector`. Keep the existing polling recovery changes intact.

Map inserted assets to deterministic client IDs with `crypto.randomUUID()`.
Use a dedicated overlay video/image track and audio track when suitable; pass
exact IDs and optional initial transform through `insertAsset`. Add
`application/x-cheapclipper-asset` drop handling to the preview stage and
timeline track bodies. Canvas drop converts the pointer to normalized X/Y and
centers the asset's default box at that point. Timeline drop converts pointer X
through `pixelsPerSecond` and snapping. Audio dropped on the canvas uses the
current playhead because it has no spatial transform. Keep one
`TimelineSelection` shared by canvas, timeline, and inspector.

Both surfaces expose the same callback shape:

```ts
onAssetDrop(
  assetId: string,
  placement: { timelineStart?: number; transform?: VisualTransform },
): void
```

Timeline dragging uses pointer capture and `deltaX / pixelsPerSecond`, snaps to frame/playhead/clip edges, renders local drag position, and dispatches one `moveClip` at pointer-up. Locked clips do not start drag. Display one-day warning and expired placeholders above the action bar.

- [ ] **Step 4: Run integration tests and typecheck**

```bash
bun x vitest run apps/web/test/TimelineEditor.test.tsx apps/web/test/EditorWorkspace.test.tsx apps/web/test/MediaLibrary.test.tsx
bun --cwd apps/web run typecheck
```

Expected: PASS on desktop and mobile DOM variants.

- [ ] **Step 5: Commit editor integration**

```bash
git add apps/web/components apps/web/app/globals.css apps/web/test/TimelineEditor.test.tsx apps/web/test/EditorWorkspace.test.tsx
git commit -m "feat(editor): integrate media canvas and timeline dragging"
```

---

### Task 11: Resolve Multiple Media Sources in Preview and Playback

**Files:**
- Modify: `apps/web/components/editor/TimelinePreview.tsx`
- Modify: `apps/web/components/editor/timelinePlayback.ts`
- Modify: `apps/web/components/ClipEditor.tsx`
- Modify: `apps/web/test/EditorControls.test.tsx`
- Modify: `apps/web/test/timelinePlayback.test.ts`

**Interfaces:**
- Consumes: `ResolvedMediaAsset[]`, V3 `ActiveTimelineItem`, and transformed compositor layers.
- Produces: asset-ID media pool that renders image/video and plays only unmuted audio/video media.

- [ ] **Step 1: Write failing multi-asset preview tests**

```ts
test('preview renders distinct image and video asset elements', () => {
  render(<TimelinePreview {...props} assets={[candidateVideo, overlayImage, soundEffect]} />)
  expect(screen.getByTestId('asset-media-candidate')).toHaveAttribute('src', candidateVideo.url)
  expect(screen.getByTestId('asset-media-overlay')).toHaveAttribute('src', overlayImage.url)
  expect(screen.getByTestId('asset-media-sfx')).toHaveAttribute('src', soundEffect.url)
})

test('playback keeps a muted linked audio clip silent', async () => {
  await controller.seek(4)
  expect(linkedAudio.muted).toBe(true)
  expect(linkedAudio.play).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run preview/playback tests and verify RED**

```bash
bun x vitest run apps/web/test/EditorControls.test.tsx apps/web/test/timelinePlayback.test.ts
```

Expected: FAIL because preview accepts one `mediaUrl` and assumes video for visual layers.

- [ ] **Step 3: Implement an asset-ID media pool**

Change preview props to:

```ts
type TimelinePreviewProps = {
  spec: EditSpecV3
  assets: ResolvedMediaAsset[]
  words: TranscriptWord[]
  playhead: number
  playing: boolean
  selected: TimelineSelection | null
  onPlayheadChange(time: number): void
  onPlayingChange(playing: boolean): void
  onSelectionChange(selection: TimelineSelection | null): void
  onAssetDrop(assetId: string, placement: { transform?: VisualTransform }): void
  onCommand(command: TimelineCommand): void
  onStall(message: string): void
  onPrimaryVideoChange?(video: HTMLVideoElement | null): void
}
```

Create one element per ready non-caption clip: `<img>` for images, `<video
muted>` for visual video, and `<audio>` for audio. Key the element pool by
`clipId` and resolve each element URL through its `assetId`; this stays
deterministic when two clips from the same asset overlap at different source
times. Images never enter `PlaybackMedia`. Audio items with `item.muted` stay
paused and muted.

- [ ] **Step 4: Run focused tests and typecheck**

```bash
bun x vitest run apps/web/test/EditorControls.test.tsx apps/web/test/timelinePlayback.test.ts
bun --cwd apps/web run typecheck
```

Expected: PASS and all media elements are detached/revoked on unmount.

- [ ] **Step 5: Commit multi-asset preview**

```bash
git add apps/web/components/editor/TimelinePreview.tsx apps/web/components/editor/timelinePlayback.ts apps/web/components/ClipEditor.tsx apps/web/test/EditorControls.test.tsx apps/web/test/timelinePlayback.test.ts
git commit -m "feat(editor): preview multiple media assets"
```

---

### Task 12: Export Multiple Assets with Spatial Transforms and Audio Mute

**Files:**
- Modify: `apps/web/lib/browserExport.ts`
- Modify: `apps/web/test/browserExport.test.ts`
- Modify: `apps/web/components/ClipEditor.tsx`

**Interfaces:**
- Consumes: V3 spec, resolved asset map, transformed compositor, and asset-aware mapping.
- Produces: browser MP4 export matching preview for uploaded image/video/audio.

- [ ] **Step 1: Write failing multi-asset export tests**

```ts
test('opens each distinct asset and draws transformed image overlay', async () => {
  const { runtime, context } = fakeRuntime()
  await createTimelineExporter(runtime)({
    assets: [candidateVideo, overlayImage],
    spec: specWithOverlay,
    words: [],
    title: 'multi-asset',
  })
  expect(runtime.open.mock.calls.map(([asset]) => asset.id)).toEqual([
    'asset-candidate',
    'asset-image',
  ])
  expect(context.drawImage).toHaveBeenCalledWith(
    expect.anything(),
    expect.any(Number),
    expect.any(Number),
    expect.any(Number),
    expect.any(Number),
    216,
    384,
    648,
    1152,
  )
})

test('does not mix a muted linked audio clip', async () => {
  const { runtime, readAudioByAsset } = fakeRuntime()
  await createTimelineExporter(runtime)({ assets, spec: mutedLinkedAudioSpec, words: [], title: 'silent' })
  expect(readAudioByAsset.get('asset-uploaded-video')).not.toHaveBeenCalled()
})
```

Refactor the existing test helper to return `context` and a stable map:

```ts
const readAudioByAsset = new Map<string, ReturnType<typeof vi.fn>>()
const open = vi.fn(async (asset: ResolvedMediaAsset) => {
  const readAudio = vi.fn(async function* () {})
  readAudioByAsset.set(asset.id, readAudio)
  return { frameAt: vi.fn(async () => media), readAudio, close: vi.fn() }
})
return { runtime: { ...runtime, open }, context, readAudioByAsset }
```

- [ ] **Step 2: Run export tests and verify RED**

```bash
bun x vitest run apps/web/test/browserExport.test.ts
```

Expected: FAIL because exporter opens one URL and ignores transforms/muted clips.

- [ ] **Step 3: Refactor runtime around distinct resolved assets**

Use:

```ts
type ExportArgs = {
  assets: ResolvedMediaAsset[]
  spec: EditSpecV3
  words: TranscriptWord[]
  title: string
  onProgress?: (progress: number) => void
  allowEmptyVisual?: boolean
}

export interface TimelineExportRuntime {
  open(asset: ResolvedMediaAsset): Promise<ExportAssetSource>
  createOutput(spec: EditSpecV3): Promise<ExportOutput>
  createOfflineAudioContext(channels: number, length: number, sampleRate: number): OfflineAudioContext
  download(buffer: ArrayBuffer, filename: string): void
}
```

Cache one `ExportAssetSource` per asset ID. Image sources return a decoded `ImageBitmap`; video sources return frames by source time; audio/video sources expose audio buffers. Iterate active mapped items per frame and pass transforms to the shared compositor. Mix only visible audio tracks and clips with `muted === false`. Close every decoder/ImageBitmap in `finally`.

- [ ] **Step 4: Run export regression and typecheck**

```bash
bun x vitest run apps/web/test/browserExport.test.ts apps/web/test/EditorWorkspace.test.tsx
bun run typecheck
```

Expected: PASS for legacy candidate-only and new multi-asset cases.

- [ ] **Step 5: Commit multi-asset export**

```bash
git add apps/web/lib/browserExport.ts apps/web/test/browserExport.test.ts apps/web/components/ClipEditor.tsx
git commit -m "feat(export): compose uploaded media assets"
```

---

### Task 13: Run the Core Feature Quality Gate

**Files:**
- Modify only files that fail validation; do not add behavior in this task.

**Interfaces:**
- Consumes: all prior core tasks.
- Produces: verified core upload/canvas feature ready for the preset and transition plans.

- [ ] **Step 1: Run all focused TypeScript tests**

```bash
bun x vitest run packages/db/test/schema.test.ts packages/db/test/rls.test.ts packages/engine/test apps/web/test/mediaAssets.test.ts apps/web/test/mediaAssetRoutes.test.ts apps/web/test/assetUpload.test.ts apps/web/test/MediaLibrary.test.tsx apps/web/test/CanvasSelectionOverlay.test.tsx apps/web/test/TimelineEditor.test.tsx apps/web/test/EditorControls.test.tsx apps/web/test/timelinePlayback.test.ts apps/web/test/EditorWorkspace.test.tsx apps/web/test/browserExport.test.ts
```

Expected: PASS with no unhandled promise rejection or React `act()` warning.

- [ ] **Step 2: Run the worker suite**

```bash
uv run --directory apps/downloader pytest -q
uv run --directory apps/downloader python -m compileall -q app tests
```

Expected: PASS.

- [ ] **Step 3: Run full repository validation**

```bash
bun run test
bun run typecheck
bun run build
```

Expected: PASS.

- [ ] **Step 4: Run browser smoke checks**

Start the fixture editor, then validate desktop and mobile widths:

```bash
bun run dev
playwright-cli open http://localhost:3000/dev/editor-fixture
playwright-cli console
```

Verify upload progress, five-second image insertion, canvas move/resize, caption drag, timeline move, refresh restore, linked muted audio, expiry placeholder, keyboard numeric controls, 44 × 44 touch handles, and export. Expected: no horizontal page overflow, focus trap, leaked blob URL, or console error.

- [ ] **Step 5: Commit validation-only fixes if required**

```bash
git add packages apps
git commit -m "fix: validate uploaded media editor flow"
```

Skip this commit when validation required no changes.
