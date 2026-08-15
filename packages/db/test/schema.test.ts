import { afterAll, beforeAll, expect, test } from 'vitest'
import type postgres from 'postgres'
import { freshDb, makeUser } from './helpers'

let sql: postgres.Sql

beforeAll(async () => {
  sql = await freshDb()
})
afterAll(async () => {
  await sql.end()
})

test('sumber publik yang sama tidak boleh terduplikasi', async () => {
  await sql`
    insert into sources (kind, external_id, is_public, url_original, status)
    values ('youtube', 'dQw4w9WgXcQ', true, 'https://youtu.be/dQw4w9WgXcQ', 'pending')
  `
  await expect(sql`
    insert into sources (kind, external_id, is_public, url_original, status)
    values ('youtube', 'dQw4w9WgXcQ', true, 'https://youtube.com/watch?v=dQw4w9WgXcQ', 'pending')
  `).rejects.toThrow(/duplicate key/)
})

test('sumber privat identik boleh ada untuk dua user berbeda', async () => {
  const a = await makeUser(sql, 'a@test.id')
  const b = await makeUser(sql, 'b@test.id')
  const insert = (owner: string) => sql`
    insert into sources (kind, external_id, is_public, owner_user_id, url_original, status)
    values ('gdrive', 'SHARED_FILE_ID_1234567890', false, ${owner}, 'https://drive.google.com/open?id=x', 'pending')
  `
  await insert(a)
  await expect(insert(b)).resolves.toBeDefined()
})

test('satu user tidak boleh punya dua baris privat untuk sumber sama', async () => {
  const c = await makeUser(sql, 'c@test.id')
  const insert = () => sql`
    insert into sources (kind, external_id, is_public, owner_user_id, url_original, status)
    values ('gdrive', 'DUP_FILE_ID_09876543210', false, ${c}, 'https://drive.google.com/open?id=y', 'pending')
  `
  await insert()
  await expect(insert()).rejects.toThrow(/duplicate key/)
})

test('clip_candidates menolak rentang waktu terbalik', async () => {
  const u = await makeUser(sql, 'd@test.id')
  const [src] = await sql`
    insert into sources (kind, external_id, is_public, url_original, status)
    values ('youtube', 'aaaaaaaaaaa', true, 'https://youtu.be/aaaaaaaaaaa', 'ready') returning id
  `
  const [proj] = await sql`
    insert into projects (user_id, source_id, title)
    values (${u}, ${src!.id}, 'tes') returning id
  `
  await expect(sql`
    insert into clip_candidates (project_id, start_sec, end_sec, score, title, hook_text, transcript_slice)
    values (${proj!.id}, 90, 30, 0.5, 't', 'h', 's')
  `).rejects.toThrow(/check constraint/)
})

test('llm_runs unik berdasarkan input_hash', async () => {
  const [src] = await sql`
    insert into sources (kind, external_id, is_public, url_original, status)
    values ('youtube', 'bbbbbbbbbbb', true, 'https://youtu.be/bbbbbbbbbbb', 'ready') returning id
  `
  const insert = () => sql`
    insert into llm_runs (source_id, provider, model, prompt_version, input_hash, output)
    values (${src!.id}, 'gemini', 'gemini-2.5-flash', 'v1', 'HASH_A', '{}'::jsonb)
  `
  await insert()
  await expect(insert()).rejects.toThrow(/duplicate key/)
})

test('jobs menolak tipe yang tidak dikenal', async () => {
  await expect(sql`
    insert into jobs (type, payload) values ('bikin-kopi', '{}'::jsonb)
  `).rejects.toThrow(/check constraint/)
})

test('uploaded media asset requires a storage key and expiry', async () => {
  const userId = await makeUser(sql, 'asset-owner@test.id')
  const [source] = await sql`
    insert into sources (kind, external_id, is_public, url_original, status)
    values ('youtube', 'assetsource1', true, 'https://youtu.be/assetsource1', 'ready')
    returning id
  `
  const [project] = await sql`
    insert into projects (user_id, source_id, title)
    values (${userId}, ${source!.id}, 'Asset project')
    returning id
  `

  await expect(sql`
    insert into media_assets
      (user_id, project_id, source, media_type, status, name, mime_type, bytes)
    values
      (${userId}, ${project!.id}, 'upload', 'image', 'uploading', 'logo.png', 'image/png', 20)
  `).rejects.toThrow(/check constraint/)
})

test('probe_asset is an allowed job type', async () => {
  await expect(sql`
    insert into jobs (type, payload) values ('probe_asset', '{"asset_id":"asset-1"}'::jsonb)
  `).resolves.toBeDefined()
})

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
