import { afterAll, beforeAll, expect, test } from 'vitest'
import type postgres from 'postgres'
import { freshDb, makeUser } from '../../../packages/db/test/helpers'
import { createProjectFromUrl } from '../lib/createProject'

let sql: postgres.Sql
let userId: string

beforeAll(async () => {
  sql = await freshDb()
  userId = await makeUser(sql, 'user@test.id')
})
afterAll(async () => {
  await sql.end()
})

const URL_A = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
const URL_A_ALT = 'https://youtu.be/dQw4w9WgXcQ?t=10'

test('membuat source, project, dan job ingest', async () => {
  const { projectId, jobId } = await createProjectFromUrl(sql, userId, URL_A)

  const [job] = await sql`select type, status, payload, user_id from jobs where id = ${jobId}`
  expect(job!.type).toBe('ingest')
  expect(job!.status).toBe('queued')
  expect(job!.payload).toMatchObject({ project_id: projectId })

  const [src] = await sql`
    select s.kind, s.external_id, s.is_public
      from projects p join sources s on s.id = p.source_id
     where p.id = ${projectId}`
  expect(src).toMatchObject({ kind: 'youtube', external_id: 'dQw4w9WgXcQ', is_public: false })
})

test('payload tersimpan sebagai objek jsonb, bukan string scalar', async () => {
  // Worker Python membaca payload["source_id"]. Bila nilainya ter-encode
  // ganda, yang tersimpan adalah string scalar JSON dan worker menerima str
  // alih-alih dict. Operator ->> mengembalikan null pada string scalar,
  // sehingga asersi ini membedakan keduanya.
  const { projectId, jobId } = await createProjectFromUrl(
    sql,
    userId,
    'https://youtu.be/bbbbbbbbbbb',
  )
  const [row] = await sql`
    select jsonb_typeof(payload) as kind,
           payload->>'source_id' as source_id,
           payload->>'project_id' as project_id
      from jobs where id = ${jobId}`
  expect(row!.kind).toBe('object')
  expect(row!.source_id).toMatch(/^[0-9a-f-]{36}$/)
  expect(row!.project_id).toBe(projectId)
})

test('sumber dibuat privat dulu; promosi ke publik tugas handler ingest', async () => {
  const { projectId } = await createProjectFromUrl(sql, userId, URL_A_ALT)
  const [src] = await sql`
    select s.is_public, s.owner_user_id
      from projects p join sources s on s.id = p.source_id
     where p.id = ${projectId}`
  expect(src!.is_public).toBe(false)
  expect(src!.owner_user_id).toBe(userId)
})

test('URL varian memakai ulang baris sumber privat yang sama', async () => {
  const a = await createProjectFromUrl(sql, userId, URL_A)
  const b = await createProjectFromUrl(sql, userId, URL_A_ALT)
  const rows = await sql`
    select distinct p.source_id from projects p where p.id in (${a.projectId}, ${b.projectId})`
  expect(rows).toHaveLength(1)
})

test('URL tidak didukung ditolak sebelum menyentuh database', async () => {
  const before = await sql`select count(*)::int as n from sources`
  await expect(createProjectFromUrl(sql, userId, 'https://example.com/x.mp4')).rejects.toThrow()
  const after = await sql`select count(*)::int as n from sources`
  expect(after[0]!.n).toBe(before[0]!.n)
})
