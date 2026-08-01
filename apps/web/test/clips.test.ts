import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import type postgres from 'postgres'
import { DEFAULT_EDIT_SPEC } from '@cheapclipper/engine'
import { freshDb, makeUser } from '../../../packages/db/test/helpers'

const r2 = vi.hoisted(() => ({
  signed: vi.fn(async (key: string) => `https://media.test/${key}`),
  optionalJson: vi.fn(async (): Promise<unknown | null> => null),
  json: vi.fn(async () => ({
    timing_precision: 'estimated',
    words: [
      { text: 'sebelum', start: 5, end: 6 },
      { text: 'halo', start: 10, end: 11 },
      { text: 'dunia', start: 11, end: 12 },
      { text: 'setelah', start: 81, end: 82 },
    ],
  })),
}))
vi.mock('@/lib/r2', () => ({
  signedR2Get: r2.signed,
  signedR2Put: vi.fn(),
  headR2Object: vi.fn(),
  deleteR2Object: vi.fn(),
  readR2Json: r2.json,
  readR2JsonIfExists: r2.optionalJson,
}))

import {
  ClipNotFoundError,
  createClipFromCandidate,
  loadClipSegment,
  loadClipEditor,
  updateClip,
} from '../lib/clips'

let sql: postgres.Sql
let alice: string
let bob: string
let sourceId: string
let projectId: string
let candidateId: string
let clipId: string

beforeAll(async () => {
  sql = await freshDb()
  alice = await makeUser(sql, 'clip-alice@test.id')
  bob = await makeUser(sql, 'clip-bob@test.id')
  const [source] = await sql`
    insert into sources (kind, external_id, is_public, url_original, status, duration_sec)
    values ('youtube', 'p2-source', true, 'https://youtu.be/x', 'ready', 600)
    returning id`
  sourceId = source!.id as string
  const [project] = await sql`
    insert into projects (user_id, source_id, title)
    values (${alice}, ${sourceId}, 'P2') returning id`
  projectId = project!.id as string
  const [candidate] = await sql`
    insert into clip_candidates (
      project_id, start_sec, end_sec, score, title, hook_text, transcript_slice
    ) values (${projectId}, 10, 80, 0.9, 'Kandidat P2', 'hook', 'halo dunia')
    returning id`
  candidateId = candidate!.id as string
  await sql`
    insert into transcripts (source_id, provider, model, language, r2_key, word_count, cost_usd)
    values (${sourceId}, 'youtube_caption', 'hybrid-v1', 'id', 'transcripts/p2.json', 4, 0)`
})

afterAll(async () => {
  await sql.end()
})

test('membuat clip draft dan enqueue hanya rentang kandidat', async () => {
  const result = await createClipFromCandidate(sql, alice, candidateId)
  clipId = result.clipId
  expect(result.jobId).toBeTruthy()

  const [clip] = await sql`
    select candidate_id, edit_spec, duration_sec from clips where id = ${clipId}`
  expect(clip!.candidate_id).toBe(candidateId)
  expect(clip!.edit_spec).toEqual(DEFAULT_EDIT_SPEC)
  expect(Number(clip!.duration_sec)).toBe(70)

  const [job] = await sql`select payload from jobs where id = ${result.jobId!}`
  expect(job!.payload).toMatchObject({
    source_id: sourceId,
    project_id: projectId,
    clip_id: clipId,
    ranges: [{ start_sec: 10, end_sec: 80 }],
  })
})

test('klik berulang memakai draft dan job aktif yang sama', async () => {
  const again = await createClipFromCandidate(sql, alice, candidateId)
  expect(again.clipId).toBe(clipId)
  expect(await sql`select id from clips where candidate_id = ${candidateId}`).toHaveLength(1)
  expect(
    await sql`select id from jobs where type = 'fetch_segments' and project_id = ${projectId}`,
  ).toHaveLength(1)
})

test('user lain tidak dapat membuat clip dari kandidat Alice', async () => {
  await expect(createClipFromCandidate(sql, bob, candidateId)).rejects.toBeInstanceOf(
    ClipNotFoundError,
  )
})

test('editor pending tidak membuat signed URL', async () => {
  r2.signed.mockClear()
  r2.json.mockClear()
  r2.optionalJson.mockClear()
  const payload = await loadClipEditor(sql, alice, clipId)
  expect(payload.segment.status).toBe('pending')
  expect(payload.segment.url).toBeNull()
  expect(r2.signed).not.toHaveBeenCalled()
  expect(r2.json).not.toHaveBeenCalled()
  expect(r2.optionalJson).not.toHaveBeenCalled()
})

test('editor ready memakai proxy same-origin, V3 candidate asset, dan caption relatif', async () => {
  await sql`
    insert into media_segments (source_id, start_sec, end_sec, r2_key, bytes, expires_at)
    values (${sourceId}, 10, 80, 'segments/p2.mp4', 1234, now() + interval '7 days')`

  const payload = await loadClipEditor(sql, alice, clipId)
  expect(payload.segment).toMatchObject({
    status: 'ready',
    url: `/api/clips/${clipId}/segment`,
  })
  expect(payload.clip.editSpec.version).toBe(3)
  expect(payload.assets).toEqual([
    expect.objectContaining({
      mediaType: 'video',
      status: 'ready',
      url: `/api/clips/${clipId}/segment`,
    }),
  ])
  expect(payload.clip.editSpec.timeline.tracks[0]!.clips[0]).toMatchObject({
    assetId: payload.assets[0]!.id,
  })
  expect(r2.signed).not.toHaveBeenCalled()
  expect(payload.clip.timingPrecision).toBe('estimated')
  expect(payload.words).toEqual([
    { text: 'halo', start: 0, end: 1 },
    { text: 'dunia', start: 1, end: 2 },
  ])
})

test('proxy hanya membuka segment milik user yang login', async () => {
  await expect(loadClipSegment(sql, alice, clipId)).resolves.toEqual({
    key: 'segments/p2.mp4',
    bytes: 1234,
  })
  await expect(loadClipSegment(sql, bob, clipId)).rejects.toBeInstanceOf(
    ClipNotFoundError,
  )
})

test('ownership diperiksa sebelum membaca transcript atau membuat signed URL', async () => {
  r2.signed.mockClear()
  r2.json.mockClear()
  r2.optionalJson.mockClear()
  await expect(loadClipEditor(sql, bob, clipId)).rejects.toBeInstanceOf(ClipNotFoundError)
  expect(r2.signed).not.toHaveBeenCalled()
  expect(r2.json).not.toHaveBeenCalled()
  expect(r2.optionalJson).not.toHaveBeenCalled()
})

test('precision transcript clip mengalahkan timestamp estimasi sumber', async () => {
  r2.optionalJson.mockResolvedValueOnce({
    timing_precision: 'word',
    words: [
      { text: 'presisi', start: 0.2, end: 0.6 },
      { text: 'banget', start: 0.6, end: 1.0 },
    ],
  })
  const payload = await loadClipEditor(sql, alice, clipId)
  expect(payload.clip.timingPrecision).toBe('word')
  expect(payload.words).toEqual([
    { text: 'presisi', start: 0.2, end: 0.6 },
    { text: 'banget', start: 0.6, end: 1 },
  ])
})

describe('update edit spec', () => {
  test('editor migrates stored v1 into normalized v3', async () => {
    await sql`
      update clips
         set edit_spec = ${sql.json(JSON.parse(JSON.stringify(DEFAULT_EDIT_SPEC)))}
       where id = ${clipId}`

    const payload = await loadClipEditor(sql, alice, clipId)
    expect(payload.clip.editSpec.version).toBe(3)
    expect(payload.clip.editSpec.timeline.duration).toBe(70)
    expect(payload.clip.editSpec.timeline.tracks.map((track) => track.type)).toEqual([
      'video',
      'audio',
      'caption',
    ])
  })

  test('menjepit timeline ke dalam candidate sebelum disimpan', async () => {
    const payload = await loadClipEditor(sql, alice, clipId)
    const result = await updateClip(sql, alice, clipId, {
      editSpec: {
        ...payload.clip.editSpec,
        timeline: {
          ...payload.clip.editSpec.timeline,
          duration: 999,
          tracks: payload.clip.editSpec.timeline.tracks.map((track, index) =>
            index === 0
              ? {
                  ...track,
                  clips: track.clips.map((clip) => ({
                    ...clip,
                    sourceOut: 999,
                  })),
                }
              : track,
          ),
        },
      },
    })

    expect(result.editSpec.timeline.duration).toBe(70)
    expect(result.editSpec.timeline.tracks[0]!.clips[0]!.sourceOut).toBe(70)
  })

  test('menormalisasi nilai sebelum disimpan', async () => {
    const result = await updateClip(sql, alice, clipId, {
      editSpec: {
        crop: { focusX: 5, zoom: 0 },
        captions: { fontSize: 500, activeColor: '#ff0000' },
      },
      renderStatus: 'rendering',
    })
    expect(result.editSpec.crop.focusX).toBe(1)
    expect(result.editSpec.crop.zoom).toBe(1)
    expect(result.editSpec.captions.fontSize).toBe(140)
    expect(result.editSpec.captions.activeColor).toBe('#FF0000')
    expect(result.renderStatus).toBe('rendering')
  })

  test('user lain tidak dapat mengubah clip', async () => {
    await expect(
      updateClip(sql, bob, clipId, { editSpec: DEFAULT_EDIT_SPEC }),
    ).rejects.toBeInstanceOf(ClipNotFoundError)
  })

  test('loads and saves an authorized uploaded image asset', async () => {
    const [upload] = await sql`
      insert into media_assets
        (user_id, project_id, source, media_type, status, name, storage_key,
         mime_type, bytes, width, height, expires_at)
      values
        (${alice}, ${projectId}, 'upload', 'image', 'ready', 'logo.png',
         'uploads/alice/logo.png', 'image/png', 1200, 800, 600,
         now() + interval '3 days')
      returning id`
    const payload = await loadClipEditor(sql, alice, clipId)
    const requested = {
      ...payload.clip.editSpec,
      timeline: {
        ...payload.clip.editSpec.timeline,
        tracks: [
          ...payload.clip.editSpec.timeline.tracks,
          {
            id: 'overlay-images',
            type: 'video' as const,
            name: 'Images',
            order: 3,
            hidden: false,
            locked: false,
            clips: [{
              id: 'logo-clip',
              assetId: upload!.id as string,
              timelineStart: 8,
              sourceIn: 0,
              sourceOut: 5,
              muted: false,
              transform: { x: 0.2, y: 0.2, width: 0.6, height: 0.6 },
            }],
          },
        ],
      },
    }

    const saved = await updateClip(sql, alice, clipId, { editSpec: requested })
    expect(saved.editSpec.timeline.tracks.flatMap((track) => track.clips))
      .toContainEqual(expect.objectContaining({ assetId: upload!.id }))

    const loaded = await loadClipEditor(sql, alice, clipId)
    expect(loaded.assets).toContainEqual(expect.objectContaining({
      id: upload!.id,
      url: `/api/assets/${upload!.id}/content`,
      status: 'ready',
    }))
  })

  test('updateClip drops a cross-project asset reference', async () => {
    const [bobProject] = await sql`
      insert into projects (user_id, source_id, title)
      values (${bob}, ${sourceId}, 'Bob project') returning id`
    const [bobAsset] = await sql`
      insert into media_assets
        (user_id, project_id, source, media_type, status, name, storage_key,
         mime_type, bytes, expires_at)
      values
        (${bob}, ${bobProject!.id}, 'upload', 'image', 'ready', 'bob.png',
         'uploads/bob/bob.png', 'image/png', 100,
         now() + interval '3 days') returning id`
    const payload = await loadClipEditor(sql, alice, clipId)
    const result = await updateClip(sql, alice, clipId, {
      editSpec: {
        ...payload.clip.editSpec,
        timeline: {
          ...payload.clip.editSpec.timeline,
          tracks: [
            ...payload.clip.editSpec.timeline.tracks,
            {
              id: 'foreign-overlay',
              type: 'video',
              name: 'Foreign',
              order: 99,
              hidden: false,
              locked: false,
              clips: [{
                id: 'foreign-clip',
                assetId: bobAsset!.id,
                timelineStart: 0,
                sourceIn: 0,
                sourceOut: 5,
                muted: false,
              }],
            },
          ],
        },
      },
    })

    expect(result.editSpec.timeline.tracks.flatMap((track) => track.clips))
      .not.toContainEqual(expect.objectContaining({ assetId: bobAsset!.id }))
  })
})
