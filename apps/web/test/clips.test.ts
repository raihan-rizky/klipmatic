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

test('editor ready memakai proxy same-origin dan caption relatif terhadap clip', async () => {
  await sql`
    insert into media_segments (source_id, start_sec, end_sec, r2_key, bytes, expires_at)
    values (${sourceId}, 10, 80, 'segments/p2.mp4', 1234, now() + interval '7 days')`

  const payload = await loadClipEditor(sql, alice, clipId)
  expect(payload.segment).toMatchObject({
    status: 'ready',
    url: `/api/clips/${clipId}/segment`,
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
  test('editor migrates stored v1 into normalized v2', async () => {
    await sql`
      update clips
         set edit_spec = ${sql.json(JSON.parse(JSON.stringify(DEFAULT_EDIT_SPEC)))}
       where id = ${clipId}`

    const payload = await loadClipEditor(sql, alice, clipId)
    expect(payload.clip.editSpec.version).toBe(2)
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
})
