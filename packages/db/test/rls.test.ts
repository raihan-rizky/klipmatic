import { afterAll, beforeAll, expect, test } from 'vitest'
import type postgres from 'postgres'
import { asUser, freshDb, makeUser } from './helpers'

let sql: postgres.Sql
let alice: string
let bob: string
let privateSourceId: string
let publicSourceId: string
let aliceAssetId: string

beforeAll(async () => {
  sql = await freshDb()
  alice = await makeUser(sql, 'alice@test.id')
  bob = await makeUser(sql, 'bob@test.id')

  const [priv] = await sql`
    insert into sources (kind, external_id, is_public, owner_user_id, url_original, status)
    values ('gdrive', 'ALICE_PRIVATE_FILE_1234567', false, ${alice},
            'https://drive.google.com/open?id=x', 'ready')
    returning id`
  privateSourceId = priv!.id as string

  const [pub] = await sql`
    insert into sources (kind, external_id, is_public, url_original, status)
    values ('youtube', 'dQw4w9WgXcQ', true, 'https://youtu.be/dQw4w9WgXcQ', 'ready')
    returning id`
  publicSourceId = pub!.id as string

  for (const sid of [privateSourceId, publicSourceId]) {
    await sql`
      insert into transcripts (source_id, provider, model, r2_key)
      values (${sid}, 'deepinfra', 'whisper-large-v3-turbo', ${'transcripts/' + sid + '.json'})`
    await sql`
      insert into llm_runs (source_id, provider, model, prompt_version, input_hash, output)
      values (${sid}, 'gemini', 'gemini-2.5-flash', 'v1', ${'hash-' + sid}, '{"c":[]}'::jsonb)`
  }

  const [project] = await sql`
    insert into projects (user_id, source_id, title)
    values (${alice}, ${publicSourceId}, 'media alice')
    returning id`
  const [asset] = await sql`
    insert into media_assets
      (user_id, project_id, source, media_type, status, name, storage_key,
       mime_type, bytes, expires_at)
    values
      (${alice}, ${project!.id}, 'upload', 'image', 'ready', 'logo.png',
       'uploads/alice/logo.png', 'image/png', 20, now() + interval '3 days')
    returning id`
  aliceAssetId = asset!.id as string
})

afterAll(async () => {
  await sql.end()
})

test('bob tidak dapat melihat sumber privat alice', async () => {
  const rows = await asUser(sql, bob, (tx) => tx`select id from sources where id = ${privateSourceId}`)
  expect(rows).toHaveLength(0)
})

test('alice dapat melihat sumber privatnya sendiri', async () => {
  const rows = await asUser(
    sql,
    alice,
    (tx) => tx`select id from sources where id = ${privateSourceId}`,
  )
  expect(rows).toHaveLength(1)
})

test('kedua user dapat melihat sumber publik', async () => {
  for (const u of [alice, bob]) {
    const rows = await asUser(sql, u, (tx) => tx`select id from sources where id = ${publicSourceId}`)
    expect(rows).toHaveLength(1)
  }
})

test('transkrip mewarisi cakupan privasi sumbernya', async () => {
  const hidden = await asUser(
    sql,
    bob,
    (tx) => tx`select id from transcripts where source_id = ${privateSourceId}`,
  )
  expect(hidden).toHaveLength(0)

  const visible = await asUser(
    sql,
    bob,
    (tx) => tx`select id from transcripts where source_id = ${publicSourceId}`,
  )
  expect(visible).toHaveLength(1)
})

test('llm_runs mewarisi cakupan privasi sumbernya', async () => {
  const hidden = await asUser(
    sql,
    bob,
    (tx) => tx`select id from llm_runs where source_id = ${privateSourceId}`,
  )
  expect(hidden).toHaveLength(0)

  const visible = await asUser(
    sql,
    bob,
    (tx) => tx`select id from llm_runs where source_id = ${publicSourceId}`,
  )
  expect(visible).toHaveLength(1)
})

test('bob tidak dapat membaca proyek alice', async () => {
  const [p] = await sql`
    insert into projects (user_id, source_id, title)
    values (${alice}, ${publicSourceId}, 'rahasia alice') returning id`
  const rows = await asUser(sql, bob, (tx) => tx`select id from projects where id = ${p!.id}`)
  expect(rows).toHaveLength(0)
})

test('bob tidak dapat membaca api_keys alice', async () => {
  await sql`
    insert into api_keys (user_id, provider, label, model, encrypted_key, key_iv, key_tag)
    values (${alice}, 'gemini', 'utama', 'gemini-2.5-flash', 'x', 'y', 'z')`
  const rows = await asUser(sql, bob, (tx) => tx`select id from api_keys`)
  expect(rows).toHaveLength(0)
})

test('bob tidak dapat menyisipkan proyek atas nama alice', async () => {
  await expect(
    asUser(
      sql,
      bob,
      (tx) => tx`
        insert into projects (user_id, source_id, title)
        values (${alice}, ${publicSourceId}, 'penyusupan')`,
    ),
  ).rejects.toThrow(/row-level security/)
})

test("bob cannot read alice's uploaded media asset", async () => {
  const rows = await asUser(
    sql,
    bob,
    (tx) => tx`select id from media_assets where id = ${aliceAssetId}`,
  )
  expect(rows).toHaveLength(0)
})
