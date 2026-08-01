import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import type postgres from 'postgres'
import { freshDb, makeUser } from '../../../packages/db/test/helpers'
import {
  createMediaUpload,
  deleteProjectUpload,
  finalizeMediaUpload,
  listProjectUploads,
  loadAssetObject,
  MediaAssetError,
  PROJECT_MEDIA_QUOTA_BYTES,
  touchClipAssets,
  type MediaAssetStorage,
} from '../lib/mediaAssets'

let sql: postgres.Sql
let alice: string
let bob: string
let projectId: string
let clipId: string

const storage: MediaAssetStorage = {
  signedPut: vi.fn(async (key) => `https://upload.test/${key}`),
  head: vi.fn(async () => ({ bytes: 1_200, contentType: 'image/png' })),
  delete: vi.fn(async () => undefined),
}

const imageInput = {
  name: 'logo.png',
  mediaType: 'image' as const,
  mimeType: 'image/png',
  bytes: 1_200,
}

beforeAll(async () => {
  sql = await freshDb()
  alice = await makeUser(sql, 'media-alice@test.id')
  bob = await makeUser(sql, 'media-bob@test.id')
  const [source] = await sql`
    insert into sources (kind, external_id, is_public, url_original, status)
    values ('youtube', 'media-domain', true, 'https://youtu.be/media-domain', 'ready')
    returning id`
  const [project] = await sql`
    insert into projects (user_id, source_id, title)
    values (${alice}, ${source!.id}, 'Media domain') returning id`
  projectId = project!.id as string
  const [clip] = await sql`
    insert into clips (project_id, edit_spec, duration_sec)
    values (${projectId}, '{}'::jsonb, 30) returning id`
  clipId = clip!.id as string
})

beforeEach(() => {
  vi.mocked(storage.signedPut).mockClear()
  vi.mocked(storage.head).mockReset()
  vi.mocked(storage.head).mockResolvedValue({ bytes: 1_200, contentType: 'image/png' })
  vi.mocked(storage.delete).mockClear()
})

afterAll(async () => {
  await sql.end()
})

test('createMediaUpload enforces per-type limit before touching storage', async () => {
  await expect(
    createMediaUpload(sql, alice, projectId, {
      name: 'huge.mp4',
      mediaType: 'video',
      mimeType: 'video/mp4',
      bytes: 100 * 1024 * 1024 + 1,
    }, storage),
  ).rejects.toMatchObject({ code: 'ASSET_TOO_LARGE' })
  expect(storage.signedPut).not.toHaveBeenCalled()
})

test('createMediaUpload rejects MIME that does not match its media type', async () => {
  await expect(
    createMediaUpload(sql, alice, projectId, {
      ...imageInput,
      mimeType: 'application/octet-stream',
    }, storage),
  ).rejects.toMatchObject({ code: 'ASSET_INVALID' })
})

test('createMediaUpload enforces a 300 MB active project quota', async () => {
  for (let index = 0; index < 3; index += 1) {
    await sql`
      insert into media_assets
        (user_id, project_id, source, media_type, status, name, storage_key,
         mime_type, bytes, expires_at)
      values
        (${alice}, ${projectId}, 'upload', 'video', 'ready', ${`existing-${index}.mp4`},
         ${`uploads/existing-${index}.mp4`}, 'video/mp4', ${100 * 1024 * 1024},
         now() + interval '3 days')`
  }

  await expect(
    createMediaUpload(sql, alice, projectId, imageInput, storage),
  ).rejects.toMatchObject({ code: 'ASSET_QUOTA_EXCEEDED' })
  const listed = await listProjectUploads(sql, alice, projectId)
  expect(listed.usage).toEqual({
    usedBytes: PROJECT_MEDIA_QUOTA_BYTES,
    limitBytes: PROJECT_MEDIA_QUOTA_BYTES,
  })
})

test('createMediaUpload checks project ownership and returns a private PUT contract', async () => {
  await sql`delete from media_assets where project_id = ${projectId}`

  await expect(
    createMediaUpload(sql, bob, projectId, imageInput, storage),
  ).rejects.toBeInstanceOf(MediaAssetError)

  const created = await createMediaUpload(sql, alice, projectId, imageInput, storage)
  expect(created.asset).toMatchObject({
    name: 'logo.png',
    mediaType: 'image',
    status: 'uploading',
  })
  expect(created.upload).toEqual({
    url: expect.stringContaining('/uploads/'),
    method: 'PUT',
    headers: { 'content-type': 'image/png' },
  })
  expect(created.asset).not.toHaveProperty('storageKey')
})

test('finalize verifies object metadata before enqueueing one probe job', async () => {
  const created = await createMediaUpload(sql, alice, projectId, imageInput, storage)
  vi.mocked(storage.head).mockResolvedValue({ bytes: imageInput.bytes, contentType: 'image/png' })

  const first = await finalizeMediaUpload(sql, alice, projectId, created.asset.id, storage)
  const second = await finalizeMediaUpload(sql, alice, projectId, created.asset.id, storage)

  expect(second.jobId).toBe(first.jobId)
  const jobs = await sql`
    select type, payload from jobs
     where type = 'probe_asset' and payload->>'asset_id' = ${created.asset.id}`
  expect(jobs).toHaveLength(1)
  expect(jobs[0]).toMatchObject({ type: 'probe_asset', payload: { asset_id: created.asset.id } })
})

test('finalize rejects mismatched R2 bytes without enqueueing a job', async () => {
  const created = await createMediaUpload(sql, alice, projectId, imageInput, storage)
  vi.mocked(storage.head).mockResolvedValue({ bytes: 99, contentType: 'image/png' })

  await expect(
    finalizeMediaUpload(sql, alice, projectId, created.asset.id, storage),
  ).rejects.toMatchObject({ code: 'ASSET_INVALID' })
  expect(await sql`
    select id from jobs where payload->>'asset_id' = ${created.asset.id}`
  ).toHaveLength(0)
})

test('opening a referenced upload refreshes three-day retention', async () => {
  const created = await createMediaUpload(sql, alice, projectId, imageInput, storage)
  await sql`
    update media_assets
       set status = 'ready', expires_at = now() + interval '12 hours'
     where id = ${created.asset.id}`
  await sql`
    update clips
       set edit_spec = ${sql.json({
         version: 3,
         timeline: { tracks: [{ clips: [{ assetId: created.asset.id }] }] },
       })}
     where id = ${clipId}`

  await touchClipAssets(sql, alice, clipId)

  const [asset] = await sql`
    select expires_at > now() + interval '71 hours' as refreshed,
           last_used_at is not null as touched
      from media_assets where id = ${created.asset.id}`
  expect(asset).toMatchObject({ refreshed: true, touched: true })
})

test('asset object lookup and deletion are owner scoped', async () => {
  const created = await createMediaUpload(sql, alice, projectId, imageInput, storage)
  await expect(loadAssetObject(sql, bob, created.asset.id)).rejects.toMatchObject({
    code: 'ASSET_NOT_FOUND',
  })
  await expect(loadAssetObject(sql, alice, created.asset.id)).resolves.toMatchObject({
    mimeType: 'image/png',
    bytes: imageInput.bytes,
  })

  await deleteProjectUpload(sql, alice, projectId, created.asset.id, storage)
  expect(storage.delete).toHaveBeenCalledOnce()
  const [deleted] = await sql`select status from media_assets where id = ${created.asset.id}`
  expect(deleted!.status).toBe('expired')
})
