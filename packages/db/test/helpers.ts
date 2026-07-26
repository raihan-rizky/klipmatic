import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'

// Paket ini ESM, sehingga __dirname tidak tersedia dan harus diturunkan
// dari import.meta.url.
const HERE = dirname(fileURLToPath(import.meta.url))

export const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:55432/cheapclipper'

/** Membuat schema bersih dari nol untuk satu berkas tes. */
export async function freshDb() {
  const sql = postgres(TEST_DB_URL, { max: 4, onnotice: () => {} })
  await sql.unsafe('drop schema if exists public cascade; create schema public;')
  await sql.unsafe('drop schema if exists auth cascade;')
  await sql.unsafe(readFileSync(join(HERE, '../sql/000_auth_shim.sql'), 'utf8'))
  await sql.unsafe(readFileSync(join(HERE, '../migrations/0000_init.sql'), 'utf8'))
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
