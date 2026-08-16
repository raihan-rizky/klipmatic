import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'
import { expect } from 'vitest'

// Paket ini ESM, sehingga __dirname tidak tersedia dan harus diturunkan
// dari import.meta.url.
const HERE = dirname(fileURLToPath(import.meta.url))

export const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:55432/klipmatic'

/**
 * Nama database khusus untuk berkas tes yang sedang berjalan.
 *
 * Vitest menjalankan berkas tes secara paralel. Bila semuanya memakai satu
 * database dan masing-masing melakukan `drop schema public cascade`, mereka
 * saling menghapus schema di tengah jalan. Nama yang diturunkan dari path
 * berkas bersifat deterministik, sehingga tiap berkas selalu memakai database
 * yang sama tanpa menumpuk database baru setiap kali dijalankan.
 */
function testDbName(): string {
  const path = String(expect.getState().testPath ?? 'default')
  return `cc_test_${createHash('sha1').update(path).digest('hex').slice(0, 12)}`
}

function withDatabase(url: string, name: string): string {
  const u = new URL(url)
  u.pathname = `/${name}`
  return u.toString()
}

/** Membuat database bersih dari nol untuk satu berkas tes. */
export async function freshDb() {
  const name = testDbName()

  const admin = postgres(TEST_DB_URL, { max: 1, onnotice: () => {} })
  const existing = await admin`select 1 from pg_database where datname = ${name}`
  if (existing.length === 0) {
    await admin.unsafe(`create database "${name}"`)
  }
  await admin.end()

  const sql = postgres(withDatabase(TEST_DB_URL, name), { max: 4, onnotice: () => {} })
  await sql.unsafe('drop schema if exists public cascade; create schema public;')
  await sql.unsafe('drop schema if exists auth cascade;')
  await sql.unsafe(readFileSync(join(HERE, '../sql/000_auth_shim.sql'), 'utf8'))

  // Peran yang dipakai Supabase untuk permintaan dari browser. Peran bersifat
  // cluster-wide, jadi penjaga if-not-exists menangani pemanggilan berulang.
  await sql.unsafe(`
    do $$ begin
      create role authenticated nologin;
    exception when duplicate_object then
      null;
    end $$;
    grant usage on schema public to authenticated;
  `)

  await sql.unsafe(readFileSync(join(HERE, '../migrations/0000_init.sql'), 'utf8'))
  await sql.unsafe(readFileSync(join(HERE, '../migrations/0001_media_assets.sql'), 'utf8'))
  await sql.unsafe(readFileSync(join(HERE, '../migrations/0002_candidate_previews.sql'), 'utf8'))
  await sql.unsafe(readFileSync(join(HERE, '../migrations/0003_candidate_preview_renders.sql'), 'utf8'))

  await sql.unsafe(`
    grant select, insert, update, delete on all tables in schema public to authenticated;
  `)
  await sql.unsafe(readFileSync(join(HERE, '../sql/900_rls.sql'), 'utf8'))

  return sql
}

export async function makeUser(sql: postgres.Sql, email: string): Promise<string> {
  const [row] = await sql`
    insert into auth.users (email) values (${email}) returning id
  `
  const userId = row!.id as string
  await sql`insert into profiles (user_id) values (${userId})`
  return userId
}

/**
 * Menjalankan fn dalam satu transaksi dengan peran `authenticated` dan
 * klaim JWT tersetel, sehingga policy RLS dievaluasi seperti di produksi.
 */
export async function asUser<T>(
  sql: postgres.Sql,
  userId: string,
  fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return sql.begin(async (tx) => {
    await tx.unsafe(
      `set local request.jwt.claims = '${JSON.stringify({ sub: userId, role: 'authenticated' })}'`,
    )
    await tx.unsafe(`set local role authenticated`)
    return fn(tx)
  }) as Promise<T>
}
