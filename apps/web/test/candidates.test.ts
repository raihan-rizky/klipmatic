import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import type postgres from 'postgres'
import { freshDb, makeUser } from '../../../packages/db/test/helpers'

// Halaman proyek adalah server component: dua ketergantungan infrastrukturnya
// diganti supaya yang diuji tinggal perakitan tampilannya. `sql` diambil lewat
// getter karena factory mock dievaluasi sebelum beforeAll sempat berjalan.
const infra = vi.hoisted(() => ({
  user: null as { id: string } | null,
  sql: null as unknown as postgres.Sql,
}))
vi.mock('@/lib/db', () => ({
  get sql() {
    return infra.sql
  },
}))
vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: async () => ({
    auth: { getUser: async () => ({ data: { user: infra.user } }) },
  }),
}))

import ProjectError from '../app/projects/[id]/error'
import ProjectPage from '../app/projects/[id]/page'
import { CandidateList } from '../components/CandidateList'
import * as candidateLib from '../lib/candidates'
import {
  CandidateNotFoundError,
  formatRange,
  listCandidates,
  loadCandidateThumbnail,
  projectViewState,
} from '../lib/candidates'

let sql: postgres.Sql
let alice: string
let bob: string
let projectId: string
let projectKosongId: string
let projectTopId: string

async function renderPage(id: string, job?: string): Promise<string> {
  const element = await ProjectPage({
    params: Promise.resolve({ id }),
    searchParams: Promise.resolve(job === undefined ? {} : { job }),
  })
  return renderToStaticMarkup(element)
}

beforeAll(async () => {
  sql = await freshDb()
  alice = await makeUser(sql, 'alice@test.id')
  bob = await makeUser(sql, 'bob@test.id')

  const [src] = await sql`
    insert into sources (kind, external_id, is_public, url_original, status, duration_sec, thumbnail_url)
    values ('youtube', 'kandidat001', true, 'https://youtu.be/x', 'ready', 600,
            'https://img.test/source.webp')
    returning id`
  const [proj] = await sql`
    insert into projects (user_id, source_id, title)
    values (${alice}, ${src!.id}, 'p') returning id`
  projectId = proj!.id as string

  const [kosong] = await sql`
    insert into projects (user_id, source_id, title)
    values (${alice}, ${src!.id}, 'belum dianalisis') returning id`
  projectKosongId = kosong!.id as string

  const [top] = await sql`
    insert into projects (user_id, source_id, title)
    values (${alice}, ${src!.id}, 'top candidates') returning id`
  projectTopId = top!.id as string

  infra.sql = sql

  // Tiap kolom teks diberi awalan berbeda supaya pemetaan kolom -> field bisa
  // dibedakan; nilai yang seragam membuat kolom tertukar tetap lolos tes.
  for (const [score, title, reason] of [
    [0.5, 'Sedang', 'alasan Sedang'],
    [0.9, 'Tinggi', 'alasan Tinggi'],
    [0.2, 'Rendah', null],
  ] as const) {
    await sql`
      insert into clip_candidates (project_id, start_sec, end_sec, score, title,
                                   hook_text, reason, transcript_slice)
      values (${projectId}, 10, 80, ${score}, ${title}, ${'hook ' + title},
              ${reason}, ${'transkrip ' + title})`
  }

  for (let index = 0; index < 12; index += 1) {
    await sql`
      insert into clip_candidates (project_id, start_sec, end_sec, score, title,
                                   hook_text, reason, transcript_slice)
      values (${projectTopId}, ${index * 20}, ${index * 20 + 15},
              ${0.99 - index * 0.01}, ${`Top ${index + 1}`},
              ${`hook top ${index + 1}`}, 'reason', 'transcript')`
  }
  const [highest] = await sql`
    select id from clip_candidates where project_id = ${projectTopId}
    order by score desc, start_sec asc limit 1`
  await sql`
    update clip_candidates set thumbnail_status = 'ready',
      thumbnail_r2_key = 'candidate-thumbnails/top.webp'
    where id = ${highest!.id}`
})
afterAll(async () => {
  await sql.end()
})

test('mengembalikan kandidat terurut dari skor tertinggi', async () => {
  const rows = await listCandidates(sql, alice, projectId)
  expect(rows.map((r) => r.title)).toEqual(['Tinggi', 'Sedang', 'Rendah'])
})

test('returns only ranked Top 10 with candidate and source fallbacks', async () => {
  const rows = await listCandidates(sql, alice, projectTopId)
  expect(rows).toHaveLength(10)
  expect(rows.map((row) => row.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  expect(rows[0]!.thumbnailUrl).toBe(`/api/candidates/${rows[0]!.id}/thumbnail`)
  expect(rows[1]!.thumbnailUrl).toBe('https://img.test/source.webp')
})

test('latest thumbnail job status is ownership checked', async () => {
  await sql`
    insert into jobs (type, payload, user_id, project_id, status)
    values ('prepare_thumbnails', '{}'::jsonb, ${alice}, ${projectTopId}, 'running')`
  await expect(
    candidateLib.latestThumbnailJobStatus(sql, alice, projectTopId),
  ).resolves.toBe('running')
  await expect(
    candidateLib.latestThumbnailJobStatus(sql, bob, projectTopId),
  ).resolves.toBeNull()
})

test('candidate thumbnail key is returned only for its owner when ready', async () => {
  const [candidate] = await listCandidates(sql, alice, projectTopId)
  await expect(loadCandidateThumbnail(sql, alice, candidate!.id)).resolves.toEqual({
    key: 'candidate-thumbnails/top.webp',
  })
  await expect(loadCandidateThumbnail(sql, bob, candidate!.id)).rejects.toBeInstanceOf(
    CandidateNotFoundError,
  )
})

test('candidate thumbnail rejects invalid, missing, and pending candidates', async () => {
  const candidates = await listCandidates(sql, alice, projectTopId)
  await expect(loadCandidateThumbnail(sql, alice, 'not-a-uuid')).rejects.toBeInstanceOf(
    CandidateNotFoundError,
  )
  await expect(
    loadCandidateThumbnail(sql, alice, '00000000-0000-0000-0000-000000000000'),
  ).rejects.toBeInstanceOf(CandidateNotFoundError)
  await expect(loadCandidateThumbnail(sql, alice, candidates[1]!.id)).rejects.toBeInstanceOf(
    CandidateNotFoundError,
  )
})

test('queued thumbnail job keeps candidate rows behind progress', () => {
  expect(projectViewState({
    hasActiveJob: false,
    candidateCount: 10,
    thumbnailJobStatus: 'queued',
  })).toBe('progress')
})

test('terminal or legacy thumbnail state reveals results', () => {
  for (const thumbnailJobStatus of ['done', 'failed', 'dead', null] as const) {
    expect(projectViewState({
      hasActiveJob: false,
      candidateCount: 10,
      thumbnailJobStatus,
    })).toBe('results')
  }
})

test('angka dikembalikan sebagai number, bukan string', async () => {
  const [first] = await listCandidates(sql, alice, projectId)
  expect(typeof first!.score).toBe('number')
  expect(typeof first!.startSec).toBe('number')
  expect(typeof first!.endSec).toBe('number')
  expect(first!.score).toBeCloseTo(0.9)
})

test('hook, alasan, dan potongan transkrip diambil dari kolomnya masing-masing', async () => {
  const [first] = await listCandidates(sql, alice, projectId)
  expect(first!.title).toBe('Tinggi')
  expect(first!.hookText).toBe('hook Tinggi')
  expect(first!.reason).toBe('alasan Tinggi')
  expect(first!.transcriptSlice).toBe('transkrip Tinggi')
})

test('alasan yang kosong di database tetap null, bukan string', async () => {
  const rows = await listCandidates(sql, alice, projectId)
  const rendah = rows.find((r) => r.title === 'Rendah')
  expect(rendah!.reason).toBeNull()
  expect(rendah!.hookText).toBe('hook Rendah')
})

test('user lain tidak mendapat kandidat apa pun', async () => {
  expect(await listCandidates(sql, bob, projectId)).toEqual([])
})

test('proyek tidak dikenal menghasilkan daftar kosong, bukan error', async () => {
  const rows = await listCandidates(sql, alice, '00000000-0000-0000-0000-000000000000')
  expect(rows).toEqual([])
})

// /projects/<apa pun> cocok dengan rute dinamis, jadi id ngawur sampai ke sini.
test.each(['bukan-uuid', '', 'abc def', "'; drop table clip_candidates; --"])(
  'id proyek tidak berbentuk uuid (%j) menghasilkan daftar kosong, bukan error',
  async (bad) => {
    await expect(listCandidates(sql, alice, bad)).resolves.toEqual([])
  },
)

test.each([
  [0, 65, '0:00 – 1:05 (65 detik)'],
  [10, 80, '0:10 – 1:20 (70 detik)'],
  [3600, 3665, '60:00 – 61:05 (65 detik)'],
])('formatRange(%i, %i)', (start, end, expected) => {
  expect(formatRange(start, end)).toBe(expected)
})

// start_sec/end_sec bertipe numeric(10,3): rentang dan durasi harus konsisten.
test.each([
  [0, 65.6, '0:00 – 1:05 (65 detik)'],
  [10.4, 80.9, '0:10 – 1:20 (70 detik)'],
  [59.9, 120.1, '0:59 – 2:00 (61 detik)'],
])('formatRange(%f, %f) tetap konsisten untuk detik pecahan', (start, end, expected) => {
  expect(formatRange(start, end)).toBe(expected)
})

describe('projectViewState', () => {
  test('kandidat sudah ada: progress tidak ditampilkan lagi', () => {
    expect(projectViewState({ hasActiveJob: true, candidateCount: 3 })).toBe('results')
    expect(projectViewState({ hasActiveJob: false, candidateCount: 3 })).toBe('results')
  })

  test('belum ada kandidat tapi ada job: tampilkan progress', () => {
    expect(projectViewState({ hasActiveJob: true, candidateCount: 0 })).toBe('progress')
  })

  test('belum ada kandidat dan tanpa job: bukan progress', () => {
    expect(projectViewState({ hasActiveJob: false, candidateCount: 0 })).toBe('no-job')
  })
})

describe('CandidateList', () => {
  test('menampilkan hook, rentang, skor persen, dan kutipan transkrip', async () => {
    const rows = await listCandidates(sql, alice, projectId)
    const html = renderToStaticMarkup(createElement(CandidateList, { candidates: rows }))

    expect(html).toContain('hook Tinggi')
    expect(html).toContain('transkrip Tinggi')
    expect(html).toContain('0:10 – 1:20 (70 detik)')
    expect(html).toContain('skor 90')
    expect(html).not.toContain('skor 0.9')
    // Dua dari tiga kandidat punya alasan; yang null tidak boleh menyisakan
    // blok kosong di halaman.
    expect(html).toContain('<em>alasan Tinggi</em>')
    expect(html.match(/<em>/g)?.length).toBe(2)
  })

  test('daftar kosong tidak mengklaim analisis masih berjalan', () => {
    const html = renderToStaticMarkup(createElement(CandidateList, { candidates: [] }))
    expect(html).toContain('Belum ada kandidat klip.')
    expect(html).not.toContain('masih berjalan')
  })
})

describe('halaman proyek', () => {
  test('tanpa sesi hanya meminta login, tidak menyentuh data', async () => {
    infra.user = null
    const html = await renderPage(projectId)
    expect(html).toContain('Silakan masuk dulu.')
    expect(html).not.toContain('hook Tinggi')
  })

  test('ada kandidat: hasil ditampilkan tanpa bilah progress', async () => {
    infra.user = { id: alice }
    const html = await renderPage(projectId, 'job-123')
    expect(html).toContain('hook Tinggi')
    expect(html).not.toContain('Memuat status')
    expect(html).not.toContain('Belum ada analisis yang berjalan')
  })

  test('belum ada kandidat dengan job aktif: progress, bukan klaim tanpa job', async () => {
    infra.user = { id: alice }
    const html = await renderPage(projectKosongId, 'job-123')
    expect(html).toContain('Memuat status')
    expect(html).not.toContain('Belum ada analisis yang berjalan')
  })

  test('belum ada kandidat tanpa job aktif: kalimat jujur, bukan bilah progress', async () => {
    infra.user = { id: alice }
    const html = await renderPage(projectKosongId)
    expect(html).toContain('Belum ada analisis yang berjalan untuk proyek ini.')
    expect(html).not.toContain('Memuat status')
  })

  test('id proyek ngawur tetap merender halaman kosong, bukan melempar', async () => {
    infra.user = { id: alice }
    const html = await renderPage('bukan-uuid')
    expect(html).toContain('Belum ada kandidat klip.')
  })
})

describe('batas error halaman proyek', () => {
  test('menampilkan pesan Indonesia tanpa membocorkan detail driver', () => {
    const boom = new Error('invalid input syntax for type uuid: "bukan-uuid"')
    const html = renderToStaticMarkup(
      createElement(ProjectError, { error: boom, reset: () => {} }),
    )

    expect(html).toContain('Terjadi kesalahan di sistem kami')
    expect(html).not.toContain('uuid')
    expect(html).not.toContain('invalid input syntax')
  })
})
