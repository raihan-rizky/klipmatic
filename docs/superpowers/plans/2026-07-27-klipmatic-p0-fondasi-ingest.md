# Klipmatic P0 — Fondasi & Ingest: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** User menempel URL video, sistem mengunduh audionya ke Cloudflare R2 dengan progress live di layar, dan sumber yang sama dari user berbeda tidak diunduh dua kali.

**Architecture:** Monorepo Turborepo. Next.js 15 menangani auth, UI, dan pembuatan job. Worker FastAPI Python mengambil job dari tabel Postgres memakai `FOR UPDATE SKIP LOCKED`, menjalankan yt-dlp dan ffmpeg, lalu mengunggah audio ke R2. Progress didorong ke browser lewat Supabase Realtime tanpa Redis. Deduplikasi sumber terjadi di handler ingest sebelum yt-dlp dipanggil.

**Tech Stack:** Turborepo, Bun (package manager), Next.js 15 (App Router, runtime Node), TypeScript, Drizzle ORM, Supabase (Postgres + Auth + Realtime), Cloudflare R2, FastAPI, uv, yt-dlp, ffmpeg, Vitest, pytest, Docker Compose (Postgres + MinIO untuk tes).

**Spec:** `docs/superpowers/specs/2026-07-27-klipmatic-p0-p1-design.md`

---

## Global Constraints

Setiap task secara implisit tunduk pada daftar ini.

- **Bun 1.2+** sebagai package manager dan script runner. **Runtime Next.js tetap Node 22 LTS** — Next.js belum berjalan penuh di runtime Bun.
- **Python 3.11+**, dikelola dengan **uv**.
- **Semua teks yang dilihat user berbahasa Indonesia.** Worker hanya memancarkan `error_code`; pemetaan kode ke kalimat Indonesia berada **hanya di `apps/web`**. Worker tidak pernah menghasilkan teks untuk user.
- **Normalisasi URL hanya diimplementasikan sekali, di TypeScript** (`packages/shared`). Worker menerima `(kind, external_id)` yang sudah ternormalisasi dan tidak pernah mem-parsing URL.
- **CI tidak pernah memanggil jaringan.** Semua interaksi dengan yt-dlp, DeepInfra, Groq, dan provider LLM diuji lewat fixture terekam.
- **RLS wajib aktif di setiap tabel.** Tidak ada tabel tanpa policy.
- **Nilai plaintext API key user tidak pernah meninggalkan server**, tidak pernah masuk log, dan tidak pernah muncul di respons termasuk respons error.
- **Amandemen terhadap spec §4:** `packages/ai` dihapus. Adapter LLM berada di worker Python (`apps/downloader/app/providers/llm.py`) karena job `analyze` diproses oleh worker. Alasannya: menghindari worker kedua dan protokol job lintas bahasa.
- Semua tabel memakai `id uuid primary key default gen_random_uuid()`, `created_at timestamptz not null default now()`, `updated_at timestamptz`.
- Commit setiap akhir task. Pesan commit berbahasa Inggris dengan prefix Conventional Commits.

---

## Struktur File

```
klipmatic/
├── package.json                      # workspaces + script turbo
├── turbo.json
├── tsconfig.base.json
├── vitest.workspace.ts
├── .env.example
├── docker-compose.dev.yml            # postgres:16 + minio (khusus tes & dev)
├── packages/
│   ├── shared/
│   │   ├── package.json
│   │   ├── src/url.ts                # normalisasi URL → (kind, externalId)
│   │   ├── src/errorCodes.ts         # daftar kode error (tanpa teks user)
│   │   ├── src/index.ts
│   │   └── test/url.test.ts
│   └── db/
│       ├── package.json
│       ├── src/schema.ts             # seluruh tabel Drizzle
│       ├── src/client.ts             # koneksi postgres-js
│       ├── src/crypto.ts             # AES-256-GCM untuk BYOK
│       ├── drizzle.config.ts
│       ├── migrations/               # SQL hasil drizzle-kit
│       ├── sql/000_auth_shim.sql     # auth.uid() untuk Postgres lokal
│       ├── sql/900_rls.sql           # seluruh policy RLS
│       └── test/
│           ├── schema.test.ts
│           ├── rls.test.ts
│           └── crypto.test.ts
├── apps/
│   ├── web/
│   │   ├── package.json
│   │   ├── next.config.ts
│   │   ├── app/layout.tsx
│   │   ├── app/page.tsx              # form tempel URL
│   │   ├── app/auth/callback/route.ts
│   │   ├── app/projects/[id]/page.tsx
│   │   ├── app/api/projects/route.ts # POST buat project + enqueue ingest
│   │   ├── lib/supabase/server.ts
│   │   ├── lib/supabase/client.ts
│   │   ├── lib/errorMessages.ts      # error_code → kalimat Indonesia
│   │   ├── components/UrlForm.tsx
│   │   ├── components/JobProgress.tsx
│   │   └── test/
│   └── downloader/
│       ├── pyproject.toml
│       ├── app/db.py                 # pool + helper
│       ├── app/queue.py              # claim / complete / fail / heartbeat
│       ├── app/reaper.py
│       ├── app/worker.py             # loop + registry handler
│       ├── app/storage.py            # klien R2 (S3-compatible)
│       ├── app/ytdlp.py              # wrapper + pemetaan error
│       ├── app/ffmpeg.py             # ekstrak audio + sha256
│       ├── app/errors.py             # JobError + kode
│       ├── app/handlers/ingest.py
│       └── tests/
│           ├── conftest.py
│           ├── fixtures/             # output yt-dlp terekam
│           ├── test_queue.py
│           ├── test_reaper.py
│           ├── test_ytdlp.py
│           ├── test_ffmpeg.py
│           └── test_ingest.py
└── docs/
```

**Alasan pembagian:** `packages/shared` berisi logika murni yang dipakai web dan (lewat kontrak data) worker. `packages/db` memiliki skema dan semua yang menyentuh database, termasuk kripto BYOK karena ia hanya bermakna bersama tabel `api_keys`. `apps/downloader` dipecah per tanggung jawab — antrian, penyimpanan, alat eksternal, handler — bukan per lapisan teknis, sehingga file yang berubah bersama berada berdekatan.

---

## Task 1: Scaffold monorepo dan lingkungan tes

**Files:**
- Create: `package.json`, `turbo.json`, `tsconfig.base.json`, `vitest.workspace.ts`, `.gitignore`, `.env.example`, `docker-compose.dev.yml`
- Create: `packages/shared/package.json`, `packages/shared/src/index.ts`, `packages/shared/test/smoke.test.ts`

**Interfaces:**
- Consumes: tidak ada
- Produces: perintah `bun run test` yang menjalankan Vitest di seluruh workspace; layanan Docker `postgres` di `localhost:55432` dan `minio` di `localhost:9000`

- [ ] **Step 1: Buat file konfigurasi root**

`package.json`:
```json
{
  "name": "klipmatic",
  "private": true,
  "packageManager": "bun@1.2.0",
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "build": "turbo build",
    "dev": "turbo dev",
    "typecheck": "turbo typecheck",
    "db:up": "docker compose -f docker-compose.dev.yml up -d",
    "db:down": "docker compose -f docker-compose.dev.yml down -v"
  },
  "devDependencies": {
    "turbo": "^2.3.0",
    "typescript": "^5.7.0",
    "vitest": "^2.1.0"
  }
}
```

`turbo.json`:
```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**", ".next/**"] },
    "typecheck": { "dependsOn": ["^build"] },
    "dev": { "cache": false, "persistent": true }
  }
}
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true
  }
}
```

`vitest.workspace.ts`:
```ts
export default ['packages/*', 'apps/web']
```

`.gitignore`:
```
node_modules/
.next/
dist/
.env
.env.local
__pycache__/
.venv/
.turbo/
*.pyc
```

- [ ] **Step 2: Buat docker-compose untuk tes**

`docker-compose.dev.yml`:
```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: klipmatic
    ports: ["55432:5432"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 2s
      retries: 15
  minio:
    image: minio/minio
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    ports: ["9000:9000", "9001:9001"]
```

- [ ] **Step 3: Buat `.env.example`**

```bash
# Database
DATABASE_URL=postgresql://postgres:postgres@localhost:55432/klipmatic

# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Cloudflare R2 (S3-compatible)
R2_ENDPOINT=http://localhost:9000
R2_ACCESS_KEY_ID=minioadmin
R2_SECRET_ACCESS_KEY=minioadmin
R2_BUCKET=klipmatic

# Enkripsi BYOK — 32 byte, base64. Buat dengan:
#   openssl rand -base64 32
BYOK_MASTER_KEY=

# Worker
WORKER_ID=local-1
WORKER_POLL_INTERVAL_SEC=2
```

- [ ] **Step 4: Buat paket `shared` dengan tes smoke**

`packages/shared/package.json`:
```json
{
  "name": "@klipmatic/shared",
  "version": "0.0.0",
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" }
}
```

`packages/shared/src/index.ts`:
```ts
export const PACKAGE_NAME = '@klipmatic/shared'
```

`packages/shared/test/smoke.test.ts`:
```ts
import { expect, test } from 'vitest'
import { PACKAGE_NAME } from '../src/index'

test('paket shared dapat diimpor', () => {
  expect(PACKAGE_NAME).toBe('@klipmatic/shared')
})
```

- [ ] **Step 5: Instal dan jalankan tes**

Run: `bun install && bun run test`
Expected: PASS, 1 tes lulus.

- [ ] **Step 6: Verifikasi Docker menyala**

Run: `bun run db:up && docker compose -f docker-compose.dev.yml ps`
Expected: kedua service berstatus `running`, postgres `healthy`.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: scaffold turborepo monorepo with bun, vitest, and dev services"
```

---

## Task 2: Normalisasi URL

Mengubah URL apa pun menjadi identitas kanonik. Ini fondasi seluruh strategi cache — jika `youtu.be/abc` dan `youtube.com/watch?v=abc` menghasilkan `external_id` berbeda, dedupe gagal total dan biaya membengkak diam-diam.

**Files:**
- Create: `packages/shared/src/url.ts`, `packages/shared/src/errorCodes.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/test/url.test.ts`

**Interfaces:**
- Consumes: tidak ada
- Produces:
  - `type SourceKind = 'youtube' | 'tiktok' | 'gdrive' | 'other'`
  - `interface NormalizedSource { kind: SourceKind; externalId: string; provisionalPublic: boolean; urlOriginal: string }`
  - `function normalizeSourceUrl(raw: string): NormalizedSource` — melempar `UnsupportedUrlError` bila tidak dikenali
  - `class UnsupportedUrlError extends Error { readonly code: 'SOURCE_UNSUPPORTED' }`
  - `const ERROR_CODES` — union kode error yang dipakai worker dan web

- [ ] **Step 1: Tulis tes yang gagal**

`packages/shared/test/url.test.ts`:
```ts
import { describe, expect, test } from 'vitest'
import { normalizeSourceUrl, UnsupportedUrlError } from '../src/url'

describe('YouTube', () => {
  const ID = 'dQw4w9WgXcQ'
  const variants = [
    `https://www.youtube.com/watch?v=${ID}`,
    `https://youtube.com/watch?v=${ID}&t=42s`,
    `https://m.youtube.com/watch?v=${ID}`,
    `https://youtu.be/${ID}`,
    `https://youtu.be/${ID}?t=42`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://www.youtube.com/live/${ID}`,
    `https://www.youtube.com/embed/${ID}`,
    `youtube.com/watch?v=${ID}`,
  ]

  test.each(variants)('semua varian menghasilkan external_id sama: %s', (url) => {
    const r = normalizeSourceUrl(url)
    expect(r.kind).toBe('youtube')
    expect(r.externalId).toBe(ID)
  })

  test('provisionalPublic true', () => {
    expect(normalizeSourceUrl(variants[0]!).provisionalPublic).toBe(true)
  })

  test('menyimpan URL asli apa adanya', () => {
    const url = `https://youtu.be/${ID}?t=42`
    expect(normalizeSourceUrl(url).urlOriginal).toBe(url)
  })

  test('menolak ID dengan panjang salah', () => {
    expect(() => normalizeSourceUrl('https://youtu.be/tooshort')).toThrow(UnsupportedUrlError)
  })
})

describe('TikTok', () => {
  test('URL lengkap', () => {
    const r = normalizeSourceUrl('https://www.tiktok.com/@user/video/7123456789012345678')
    expect(r.kind).toBe('tiktok')
    expect(r.externalId).toBe('7123456789012345678')
    expect(r.provisionalPublic).toBe(true)
  })

  test('menolak short link karena butuh resolusi jaringan', () => {
    expect(() => normalizeSourceUrl('https://vm.tiktok.com/ZSABCDEF/')).toThrow(UnsupportedUrlError)
  })
})

describe('Google Drive', () => {
  const ID = '1A2b3C4d5E6f7G8h9I0jKlMnOpQrStUv'

  test.each([
    `https://drive.google.com/file/d/${ID}/view?usp=sharing`,
    `https://drive.google.com/open?id=${ID}`,
    `https://drive.google.com/uc?id=${ID}&export=download`,
  ])('varian menghasilkan id sama: %s', (url) => {
    const r = normalizeSourceUrl(url)
    expect(r.kind).toBe('gdrive')
    expect(r.externalId).toBe(ID)
  })

  test('gdrive selalu dianggap privat', () => {
    expect(normalizeSourceUrl(`https://drive.google.com/open?id=${ID}`).provisionalPublic).toBe(false)
  })
})

describe('penolakan', () => {
  test.each(['', '   ', 'bukan-url', 'ftp://x.com/a', 'https://example.com/video.mp4'])(
    'menolak %s',
    (url) => {
      expect(() => normalizeSourceUrl(url)).toThrow(UnsupportedUrlError)
    },
  )

  test('error membawa kode SOURCE_UNSUPPORTED', () => {
    try {
      normalizeSourceUrl('bukan-url')
      expect.unreachable('seharusnya melempar')
    } catch (e) {
      expect((e as UnsupportedUrlError).code).toBe('SOURCE_UNSUPPORTED')
    }
  })
})
```

- [ ] **Step 2: Jalankan tes untuk memastikan gagal**

Run: `bun run test packages/shared`
Expected: FAIL dengan `Cannot find module '../src/url'`.

- [ ] **Step 3: Tulis daftar kode error**

`packages/shared/src/errorCodes.ts`:
```ts
export const ERROR_CODES = [
  'SOURCE_UNSUPPORTED',
  'SOURCE_BLOCKED',
  'SOURCE_UNAVAILABLE',
  'SOURCE_GEOBLOCKED',
  'SOURCE_AGE_RESTRICTED',
  'SOURCE_TOO_LONG',
  'TRANSCRIBE_FAILED',
  'BYOK_INVALID',
  'LLM_BAD_OUTPUT',
  'WORKER_LOST',
  'INTERNAL',
] as const

export type ErrorCode = (typeof ERROR_CODES)[number]

/** Batas durasi sumber yang diterima, dalam detik. Spec §9.1: 4 jam. */
export const MAX_SOURCE_DURATION_SEC = 4 * 60 * 60
```

- [ ] **Step 4: Implementasikan normalisasi**

`packages/shared/src/url.ts`:
```ts
import type { ErrorCode } from './errorCodes'

export type SourceKind = 'youtube' | 'tiktok' | 'gdrive' | 'other'

export interface NormalizedSource {
  kind: SourceKind
  externalId: string
  /**
   * Dugaan awal berdasarkan bentuk URL. Nilai final ditetapkan handler ingest
   * dari metadata yt-dlp (`availability`). Lihat Task 11.
   */
  provisionalPublic: boolean
  urlOriginal: string
}

export class UnsupportedUrlError extends Error {
  readonly code: ErrorCode = 'SOURCE_UNSUPPORTED'
  constructor(raw: string) {
    super(`URL tidak dikenali: ${raw}`)
    this.name = 'UnsupportedUrlError'
  }
}

const YT_ID = /^[A-Za-z0-9_-]{11}$/
const TIKTOK_ID = /^\d{6,25}$/
const GDRIVE_ID = /^[A-Za-z0-9_-]{20,}$/

function parseUrl(raw: string): URL | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    const u = new URL(withScheme)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u : null
  } catch {
    return null
  }
}

function youtubeId(u: URL): string | null {
  const host = u.hostname.replace(/^www\.|^m\./, '')
  if (host === 'youtu.be') {
    return u.pathname.slice(1).split('/')[0] ?? null
  }
  if (host !== 'youtube.com' && host !== 'music.youtube.com') return null
  const v = u.searchParams.get('v')
  if (v) return v
  const segments = u.pathname.split('/').filter(Boolean)
  if (segments.length >= 2 && ['shorts', 'live', 'embed', 'v'].includes(segments[0]!)) {
    return segments[1]!
  }
  return null
}

function tiktokId(u: URL): string | null {
  const host = u.hostname.replace(/^www\./, '')
  // Short link (vm./vt.) memerlukan resolusi HTTP untuk mendapat ID asli.
  // Normalisasi harus murni, jadi bentuk ini ditolak di v1.
  if (host !== 'tiktok.com') return null
  const segments = u.pathname.split('/').filter(Boolean)
  const idx = segments.indexOf('video')
  return idx >= 0 ? (segments[idx + 1] ?? null) : null
}

function gdriveId(u: URL): string | null {
  if (u.hostname.replace(/^www\./, '') !== 'drive.google.com') return null
  const byQuery = u.searchParams.get('id')
  if (byQuery) return byQuery
  const segments = u.pathname.split('/').filter(Boolean)
  const idx = segments.indexOf('d')
  return idx >= 0 ? (segments[idx + 1] ?? null) : null
}

export function normalizeSourceUrl(raw: string): NormalizedSource {
  const u = parseUrl(raw)
  if (!u) throw new UnsupportedUrlError(raw)

  const yt = youtubeId(u)
  if (yt) {
    if (!YT_ID.test(yt)) throw new UnsupportedUrlError(raw)
    return { kind: 'youtube', externalId: yt, provisionalPublic: true, urlOriginal: raw }
  }

  const tt = tiktokId(u)
  if (tt) {
    if (!TIKTOK_ID.test(tt)) throw new UnsupportedUrlError(raw)
    return { kind: 'tiktok', externalId: tt, provisionalPublic: true, urlOriginal: raw }
  }

  const gd = gdriveId(u)
  if (gd) {
    if (!GDRIVE_ID.test(gd)) throw new UnsupportedUrlError(raw)
    return { kind: 'gdrive', externalId: gd, provisionalPublic: false, urlOriginal: raw }
  }

  throw new UnsupportedUrlError(raw)
}
```

- [ ] **Step 5: Ekspor dari index**

`packages/shared/src/index.ts`:
```ts
export const PACKAGE_NAME = '@klipmatic/shared'
export * from './url'
export * from './errorCodes'
```

- [ ] **Step 6: Jalankan tes**

Run: `bun run test packages/shared`
Expected: PASS, seluruh tes lulus.

- [ ] **Step 7: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): canonical source URL normalization for youtube, tiktok, gdrive"
```

---

## Task 3: Skema database dan migrasi

**Files:**
- Create: `packages/db/package.json`, `packages/db/drizzle.config.ts`, `packages/db/src/schema.ts`, `packages/db/src/client.ts`, `packages/db/sql/000_auth_shim.sql`
- Test: `packages/db/test/schema.test.ts`, `packages/db/test/helpers.ts`

**Interfaces:**
- Consumes: `SourceKind` dari `@klipmatic/shared`
- Produces: tabel Drizzle `profiles`, `apiKeys`, `sources`, `transcripts`, `llmRuns`, `projects`, `clipCandidates`, `mediaSegments`, `clips`, `jobs`; `function getDb(url: string)`; helper tes `withTestDb()`

- [ ] **Step 1: Buat paket dan konfigurasi**

`packages/db/package.json`:
```json
{
  "name": "@klipmatic/db",
  "version": "0.0.0",
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts", "./schema": "./src/schema.ts" },
  "scripts": {
    "generate": "drizzle-kit generate",
    "migrate": "drizzle-kit migrate"
  },
  "dependencies": {
    "@klipmatic/shared": "workspace:*",
    "drizzle-orm": "^0.38.0",
    "postgres": "^3.4.5"
  },
  "devDependencies": { "drizzle-kit": "^0.30.0" }
}
```

`packages/db/drizzle.config.ts`:
```ts
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/schema.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL! },
})
```

- [ ] **Step 2: Buat shim `auth.uid()` untuk Postgres lokal**

Supabase menyediakan `auth.uid()` di produksi. Postgres polos tidak. Shim ini membuat policy RLS yang sama berjalan di tes lokal tanpa menjalankan seluruh stack Supabase.

`packages/db/sql/000_auth_shim.sql`:
```sql
create schema if not exists auth;

create or replace function auth.uid() returns uuid
language sql stable
as $$
  select nullif(
    current_setting('request.jwt.claims', true)::json ->> 'sub',
    ''
  )::uuid;
$$;

-- Tiruan minimal auth.users milik Supabase; hanya kolom yang kita rujuk.
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text
);
```

- [ ] **Step 3: Tulis tes yang gagal**

`packages/db/test/helpers.ts`:
```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import postgres from 'postgres'

export const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:55432/klipmatic'

/** Membuat schema bersih dari nol untuk satu berkas tes. */
export async function freshDb() {
  const sql = postgres(TEST_DB_URL, { max: 4, onnotice: () => {} })
  await sql.unsafe('drop schema if exists public cascade; create schema public;')
  await sql.unsafe('drop schema if exists auth cascade;')
  await sql.unsafe(readFileSync(join(__dirname, '../sql/000_auth_shim.sql'), 'utf8'))
  const migrations = readFileSync(join(__dirname, '../migrations/0000_init.sql'), 'utf8')
  await sql.unsafe(migrations)
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
```

`packages/db/test/schema.test.ts`:
```ts
import { afterAll, beforeAll, expect, test } from 'vitest'
import type postgres from 'postgres'
import { freshDb, makeUser } from './helpers'

let sql: postgres.Sql

beforeAll(async () => { sql = await freshDb() })
afterAll(async () => { await sql.end() })

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
```

- [ ] **Step 4: Jalankan tes untuk memastikan gagal**

Run: `bun run db:up && bun run test packages/db`
Expected: FAIL — berkas migrasi belum ada.

- [ ] **Step 5: Tulis skema Drizzle**

`packages/db/src/schema.ts`:
```ts
import {
  bigint, boolean, check, index, integer, jsonb, numeric, pgTable,
  text, timestamp, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

const id = () => uuid('id').primaryKey().default(sql`gen_random_uuid()`)
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
const updatedAt = () => timestamp('updated_at', { withTimezone: true })

export const profiles = pgTable('profiles', {
  userId: uuid('user_id').primaryKey(),
  displayName: text('display_name'),
  locale: text('locale').notNull().default('id'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

export const apiKeys = pgTable('api_keys', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => profiles.userId, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),
  label: text('label').notNull(),
  baseUrl: text('base_url'),
  model: text('model').notNull(),
  encryptedKey: text('encrypted_key').notNull(),
  keyIv: text('key_iv').notNull(),
  keyTag: text('key_tag').notNull(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  check('api_keys_provider_chk',
    sql`${t.provider} in ('gemini','openai_compat','anthropic_compat')`),
  index('api_keys_user_idx').on(t.userId),
])

export const sources = pgTable('sources', {
  id: id(),
  kind: text('kind').notNull(),
  externalId: text('external_id').notNull(),
  isPublic: boolean('is_public').notNull(),
  ownerUserId: uuid('owner_user_id').references(() => profiles.userId, { onDelete: 'cascade' }),
  urlOriginal: text('url_original').notNull(),
  title: text('title'),
  channel: text('channel'),
  durationSec: integer('duration_sec'),
  thumbnailUrl: text('thumbnail_url'),
  audioR2Key: text('audio_r2_key'),
  audioSha256: text('audio_sha256'),
  status: text('status').notNull().default('pending'),
  errorCode: text('error_code'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  check('sources_kind_chk', sql`${t.kind} in ('youtube','tiktok','gdrive','other')`),
  check('sources_status_chk', sql`${t.status} in ('pending','ready','failed')`),
  check('sources_owner_chk',
    sql`(${t.isPublic} = true and ${t.ownerUserId} is null)
        or (${t.isPublic} = false and ${t.ownerUserId} is not null)`),
  uniqueIndex('sources_public_uniq').on(t.kind, t.externalId).where(sql`is_public`),
  uniqueIndex('sources_private_uniq').on(t.kind, t.externalId, t.ownerUserId).where(sql`not is_public`),
  index('sources_sha_idx').on(t.audioSha256),
])

export const transcripts = pgTable('transcripts', {
  id: id(),
  sourceId: uuid('source_id').notNull().references(() => sources.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  language: text('language'),
  r2Key: text('r2_key').notNull(),
  wordCount: integer('word_count'),
  costUsd: numeric('cost_usd', { precision: 10, scale: 6 }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('transcripts_source_model_uniq').on(t.sourceId, t.model)])

export const llmRuns = pgTable('llm_runs', {
  id: id(),
  sourceId: uuid('source_id').notNull().references(() => sources.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  promptVersion: text('prompt_version').notNull(),
  inputHash: text('input_hash').notNull(),
  output: jsonb('output').notNull(),
  costUsd: numeric('cost_usd', { precision: 10, scale: 6 }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('llm_runs_input_hash_uniq').on(t.inputHash)])

export const projects = pgTable('projects', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => profiles.userId, { onDelete: 'cascade' }),
  sourceId: uuid('source_id').notNull().references(() => sources.id),
  title: text('title').notNull(),
  settings: jsonb('settings').notNull().default({}),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index('projects_user_idx').on(t.userId)])

export const clipCandidates = pgTable('clip_candidates', {
  id: id(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  llmRunId: uuid('llm_run_id').references(() => llmRuns.id),
  startSec: numeric('start_sec', { precision: 10, scale: 3 }).notNull(),
  endSec: numeric('end_sec', { precision: 10, scale: 3 }).notNull(),
  score: numeric('score', { precision: 4, scale: 3 }).notNull(),
  title: text('title').notNull(),
  hookText: text('hook_text').notNull(),
  reason: text('reason'),
  transcriptSlice: text('transcript_slice').notNull(),
  createdAt: createdAt(),
}, (t) => [
  check('clip_candidates_range_chk', sql`${t.endSec} > ${t.startSec}`),
  index('clip_candidates_project_idx').on(t.projectId),
])

export const mediaSegments = pgTable('media_segments', {
  id: id(),
  sourceId: uuid('source_id').notNull().references(() => sources.id, { onDelete: 'cascade' }),
  startSec: numeric('start_sec', { precision: 10, scale: 3 }).notNull(),
  endSec: numeric('end_sec', { precision: 10, scale: 3 }).notNull(),
  r2Key: text('r2_key').notNull(),
  bytes: bigint('bytes', { mode: 'number' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('media_segments_uniq').on(t.sourceId, t.startSec, t.endSec)])

export const clips = pgTable('clips', {
  id: id(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  candidateId: uuid('candidate_id').references(() => clipCandidates.id),
  editSpec: jsonb('edit_spec').notNull().default({}),
  renderStatus: text('render_status').notNull().default('draft'),
  outputR2Key: text('output_r2_key'),
  durationSec: numeric('duration_sec', { precision: 10, scale: 3 }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  check('clips_render_status_chk',
    sql`${t.renderStatus} in ('draft','rendering','done','failed')`),
])

export const jobs = pgTable('jobs', {
  id: id(),
  type: text('type').notNull(),
  payload: jsonb('payload').notNull(),
  status: text('status').notNull().default('queued'),
  priority: integer('priority').notNull().default(0),
  attempts: integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(3),
  runAfter: timestamp('run_after', { withTimezone: true }).notNull().defaultNow(),
  lockedAt: timestamp('locked_at', { withTimezone: true }),
  lockedBy: text('locked_by'),
  progress: integer('progress').notNull().default(0),
  errorCode: text('error_code'),
  errorMsg: text('error_msg'),
  userId: uuid('user_id').references(() => profiles.userId, { onDelete: 'cascade' }),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  check('jobs_type_chk',
    sql`${t.type} in ('ingest','transcribe','analyze','fetch_segments')`),
  check('jobs_status_chk',
    sql`${t.status} in ('queued','running','done','failed','dead')`),
  index('jobs_pick_idx').on(t.status, t.runAfter, t.priority),
])
```

- [ ] **Step 6: Buat klien database**

`packages/db/src/client.ts`:
```ts
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

export function getDb(url: string) {
  const client = postgres(url, { max: 10, prepare: false })
  return { db: drizzle(client, { schema }), client }
}
```

`packages/db/src/index.ts`:
```ts
export * from './schema'
export * from './client'
```

- [ ] **Step 7: Buat migrasi dan jalankan tes**

Run:
```bash
cd packages/db && DATABASE_URL=postgresql://postgres:postgres@localhost:55432/klipmatic bun run generate
```
Ganti nama berkas yang dihasilkan menjadi `migrations/0000_init.sql` bila belum bernama demikian, karena `test/helpers.ts` merujuk nama itu.

Run: `bun run test packages/db`
Expected: PASS, enam tes lulus.

- [ ] **Step 8: Commit**

```bash
git add packages/db
git commit -m "feat(db): drizzle schema, migrations, and constraint tests"
```

---

## Task 4: Policy RLS dan tes isolasi antar user

Task paling penting dari sisi keamanan di P0. Spec §6.3 mensyaratkan isolasi ditegakkan di lapisan database, bukan hanya logika aplikasi.

**Files:**
- Create: `packages/db/sql/900_rls.sql`
- Modify: `packages/db/test/helpers.ts` (tambah `asUser`)
- Test: `packages/db/test/rls.test.ts`

**Interfaces:**
- Consumes: seluruh tabel dari Task 3
- Produces: `async function asUser<T>(sql, userId, fn)` — menjalankan `fn` dengan klaim JWT tersetel sehingga `auth.uid()` mengembalikan `userId`

- [ ] **Step 1: Tambah helper impersonasi user**

Tambahkan ke `packages/db/test/helpers.ts`:
```ts
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
    await tx.unsafe(`set local role authenticated`)
    await tx.unsafe(
      `set local request.jwt.claims = '${JSON.stringify({ sub: userId, role: 'authenticated' })}'`,
    )
    return fn(tx)
  })
}
```

Tambahkan juga pembuatan peran ke `freshDb()`, tepat sebelum migrasi dijalankan:
```ts
await sql.unsafe(`
  do $$ begin
    if not exists (select from pg_roles where rolname = 'authenticated') then
      create role authenticated nologin;
    end if;
  end $$;
  grant usage on schema public to authenticated;
`)
```
Dan setelah migrasi:
```ts
await sql.unsafe(`
  grant select, insert, update, delete on all tables in schema public to authenticated;
`)
await sql.unsafe(readFileSync(join(__dirname, '../sql/900_rls.sql'), 'utf8'))
```

- [ ] **Step 2: Tulis tes yang gagal**

`packages/db/test/rls.test.ts`:
```ts
import { afterAll, beforeAll, expect, test } from 'vitest'
import type postgres from 'postgres'
import { asUser, freshDb, makeUser } from './helpers'

let sql: postgres.Sql
let alice: string
let bob: string
let privateSourceId: string
let publicSourceId: string

beforeAll(async () => {
  sql = await freshDb()
  alice = await makeUser(sql, 'alice@test.id')
  bob = await makeUser(sql, 'bob@test.id')

  const [priv] = await sql`
    insert into sources (kind, external_id, is_public, owner_user_id, url_original, status)
    values ('gdrive', 'ALICE_PRIVATE_FILE_1234567', false, ${alice},
            'https://drive.google.com/open?id=x', 'ready')
    returning id`
  privateSourceId = priv!.id

  const [pub] = await sql`
    insert into sources (kind, external_id, is_public, url_original, status)
    values ('youtube', 'dQw4w9WgXcQ', true, 'https://youtu.be/dQw4w9WgXcQ', 'ready')
    returning id`
  publicSourceId = pub!.id

  for (const sid of [privateSourceId, publicSourceId]) {
    await sql`
      insert into transcripts (source_id, provider, model, r2_key)
      values (${sid}, 'deepinfra', 'whisper-large-v3-turbo', ${'transcripts/' + sid + '.json'})`
    await sql`
      insert into llm_runs (source_id, provider, model, prompt_version, input_hash, output)
      values (${sid}, 'gemini', 'gemini-2.5-flash', 'v1', ${'hash-' + sid}, '{"c":[]}'::jsonb)`
  }
})

afterAll(async () => { await sql.end() })

test('bob tidak dapat melihat sumber privat alice', async () => {
  const rows = await asUser(sql, bob, (tx) =>
    tx`select id from sources where id = ${privateSourceId}`)
  expect(rows).toHaveLength(0)
})

test('alice dapat melihat sumber privatnya sendiri', async () => {
  const rows = await asUser(sql, alice, (tx) =>
    tx`select id from sources where id = ${privateSourceId}`)
  expect(rows).toHaveLength(1)
})

test('kedua user dapat melihat sumber publik', async () => {
  for (const u of [alice, bob]) {
    const rows = await asUser(sql, u, (tx) =>
      tx`select id from sources where id = ${publicSourceId}`)
    expect(rows).toHaveLength(1)
  }
})

test('transkrip mewarisi cakupan privasi sumbernya', async () => {
  const hidden = await asUser(sql, bob, (tx) =>
    tx`select id from transcripts where source_id = ${privateSourceId}`)
  expect(hidden).toHaveLength(0)

  const visible = await asUser(sql, bob, (tx) =>
    tx`select id from transcripts where source_id = ${publicSourceId}`)
  expect(visible).toHaveLength(1)
})

test('llm_runs mewarisi cakupan privasi sumbernya', async () => {
  const hidden = await asUser(sql, bob, (tx) =>
    tx`select id from llm_runs where source_id = ${privateSourceId}`)
  expect(hidden).toHaveLength(0)

  const visible = await asUser(sql, bob, (tx) =>
    tx`select id from llm_runs where source_id = ${publicSourceId}`)
  expect(visible).toHaveLength(1)
})

test('bob tidak dapat membaca proyek alice', async () => {
  const [p] = await sql`
    insert into projects (user_id, source_id, title)
    values (${alice}, ${publicSourceId}, 'rahasia alice') returning id`
  const rows = await asUser(sql, bob, (tx) =>
    tx`select id from projects where id = ${p!.id}`)
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
    asUser(sql, bob, (tx) => tx`
      insert into projects (user_id, source_id, title)
      values (${alice}, ${publicSourceId}, 'penyusupan')`),
  ).rejects.toThrow(/row-level security/)
})
```

- [ ] **Step 3: Jalankan tes untuk memastikan gagal**

Run: `bun run test packages/db`
Expected: FAIL — tanpa policy, seluruh baris terlihat, sehingga tes isolasi gagal.

- [ ] **Step 4: Tulis policy RLS**

`packages/db/sql/900_rls.sql`:
```sql
alter table profiles         enable row level security;
alter table api_keys         enable row level security;
alter table sources          enable row level security;
alter table transcripts      enable row level security;
alter table llm_runs         enable row level security;
alter table projects         enable row level security;
alter table clip_candidates  enable row level security;
alter table media_segments   enable row level security;
alter table clips            enable row level security;
alter table jobs             enable row level security;

-- Predikat tunggal untuk keterbacaan sumber. Semua tabel turunan memakainya,
-- sehingga aturan privasi hanya ditulis di satu tempat.
create or replace function public.can_read_source(sid uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from sources s
    where s.id = sid
      and (s.is_public or s.owner_user_id = auth.uid())
  );
$$;

create policy profiles_self on profiles
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy api_keys_self on api_keys
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy sources_read on sources for select
  using (is_public or owner_user_id = auth.uid());
create policy sources_write on sources for insert
  with check (is_public = false and owner_user_id = auth.uid());
create policy sources_update on sources for update
  using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());

create policy transcripts_read on transcripts for select
  using (public.can_read_source(source_id));
create policy llm_runs_read on llm_runs for select
  using (public.can_read_source(source_id));
create policy media_segments_read on media_segments for select
  using (public.can_read_source(source_id));

create policy projects_self on projects
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy clip_candidates_self on clip_candidates
  using (exists (select 1 from projects p
                 where p.id = project_id and p.user_id = auth.uid()))
  with check (exists (select 1 from projects p
                      where p.id = project_id and p.user_id = auth.uid()));

create policy clips_self on clips
  using (exists (select 1 from projects p
                 where p.id = project_id and p.user_id = auth.uid()))
  with check (exists (select 1 from projects p
                      where p.id = project_id and p.user_id = auth.uid()));

create policy jobs_self on jobs for select
  using (user_id = auth.uid());
```

Catatan: worker mengakses database memakai kredensial pemilik tabel, yang melewati RLS. Ini disengaja — worker perlu menulis lintas user. Peran `authenticated` yang dipakai browser tidak pernah punya jalur itu.

- [ ] **Step 5: Jalankan tes**

Run: `bun run test packages/db`
Expected: PASS, seluruh tes RLS lulus.

- [ ] **Step 6: Commit**

```bash
git add packages/db
git commit -m "feat(db): row level security policies with cross-user isolation tests"
```

---

## Task 5: Enkripsi kredensial BYOK

**Files:**
- Create: `packages/db/src/crypto.ts`
- Test: `packages/db/test/crypto.test.ts`

**Interfaces:**
- Consumes: env `BYOK_MASTER_KEY` (32 byte, base64)
- Produces:
  - `interface SealedKey { encryptedKey: string; keyIv: string; keyTag: string }` (semuanya base64)
  - `function sealApiKey(plaintext: string, masterKeyB64: string): SealedKey`
  - `function openApiKey(sealed: SealedKey, masterKeyB64: string): string`

- [ ] **Step 1: Tulis tes yang gagal**

`packages/db/test/crypto.test.ts`:
```ts
import { randomBytes } from 'node:crypto'
import { describe, expect, test } from 'vitest'
import { openApiKey, sealApiKey } from '../src/crypto'

const MASTER = randomBytes(32).toString('base64')
const SECRET = 'sk-proj-rahasia-sekali-1234567890'

describe('sealApiKey / openApiKey', () => {
  test('round trip mengembalikan nilai asli', () => {
    expect(openApiKey(sealApiKey(SECRET, MASTER), MASTER)).toBe(SECRET)
  })

  test('ciphertext tidak mengandung plaintext', () => {
    const sealed = sealApiKey(SECRET, MASTER)
    const blob = sealed.encryptedKey + sealed.keyIv + sealed.keyTag
    expect(Buffer.from(blob, 'base64').toString('utf8')).not.toContain('rahasia')
    expect(blob).not.toContain(SECRET)
  })

  test('dua enkripsi nilai sama menghasilkan ciphertext berbeda', () => {
    const a = sealApiKey(SECRET, MASTER)
    const b = sealApiKey(SECRET, MASTER)
    expect(a.encryptedKey).not.toBe(b.encryptedKey)
    expect(a.keyIv).not.toBe(b.keyIv)
  })

  test('ciphertext yang diubah ditolak', () => {
    const sealed = sealApiKey(SECRET, MASTER)
    const bytes = Buffer.from(sealed.encryptedKey, 'base64')
    bytes[0] = bytes[0]! ^ 0xff
    expect(() =>
      openApiKey({ ...sealed, encryptedKey: bytes.toString('base64') }, MASTER),
    ).toThrow()
  })

  test('master key salah ditolak', () => {
    const sealed = sealApiKey(SECRET, MASTER)
    expect(() => openApiKey(sealed, randomBytes(32).toString('base64'))).toThrow()
  })

  test('master key dengan panjang salah ditolak saat enkripsi', () => {
    expect(() => sealApiKey(SECRET, randomBytes(16).toString('base64'))).toThrow(
      /BYOK_MASTER_KEY/,
    )
  })

  test('plaintext kosong ditolak', () => {
    expect(() => sealApiKey('', MASTER)).toThrow(/kosong/)
  })
})
```

- [ ] **Step 2: Jalankan tes untuk memastikan gagal**

Run: `bun run test packages/db/test/crypto.test.ts`
Expected: FAIL dengan `Cannot find module '../src/crypto'`.

- [ ] **Step 3: Implementasikan**

`packages/db/src/crypto.ts`:
```ts
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const ALGO = 'aes-256-gcm'
const IV_BYTES = 12

export interface SealedKey {
  encryptedKey: string
  keyIv: string
  keyTag: string
}

function masterKey(b64: string): Buffer {
  const key = Buffer.from(b64, 'base64')
  if (key.length !== 32) {
    throw new Error('BYOK_MASTER_KEY harus 32 byte dalam base64')
  }
  return key
}

export function sealApiKey(plaintext: string, masterKeyB64: string): SealedKey {
  if (!plaintext) throw new Error('API key tidak boleh kosong')
  const key = masterKey(masterKeyB64)
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGO, key, iv)
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return {
    encryptedKey: enc.toString('base64'),
    keyIv: iv.toString('base64'),
    keyTag: cipher.getAuthTag().toString('base64'),
  }
}

export function openApiKey(sealed: SealedKey, masterKeyB64: string): string {
  const key = masterKey(masterKeyB64)
  const decipher = createDecipheriv(ALGO, key, Buffer.from(sealed.keyIv, 'base64'))
  decipher.setAuthTag(Buffer.from(sealed.keyTag, 'base64'))
  return Buffer.concat([
    decipher.update(Buffer.from(sealed.encryptedKey, 'base64')),
    decipher.final(),
  ]).toString('utf8')
}
```

- [ ] **Step 4: Ekspor dan jalankan tes**

Tambahkan `export * from './crypto'` ke `packages/db/src/index.ts`.

Run: `bun run test packages/db/test/crypto.test.ts`
Expected: PASS, tujuh tes lulus.

- [ ] **Step 5: Commit**

```bash
git add packages/db
git commit -m "feat(db): AES-256-GCM sealing for BYOK credentials"
```

---

## Task 6: Scaffold worker dan antrian job

Antrian adalah jantung sistem. `FOR UPDATE SKIP LOCKED` mudah dipakai keliru, dan kegagalannya berupa job diproses ganda — yang berarti tagihan ganda. Karena itu tes concurrency wajib ada sebelum handler apa pun ditulis.

**Files:**
- Create: `apps/downloader/pyproject.toml`, `apps/downloader/app/__init__.py`, `apps/downloader/app/db.py`, `apps/downloader/app/errors.py`, `apps/downloader/app/queue.py`
- Test: `apps/downloader/tests/conftest.py`, `apps/downloader/tests/test_queue.py`

**Interfaces:**
- Consumes: tabel `jobs` dari Task 3
- Produces:
  - `class JobError(Exception)` dengan atribut `code: str` dan `terminal: bool`
  - `@dataclass Job` dengan field `id, type, payload, attempts, max_attempts, project_id, user_id`
  - `def claim_job(conn, worker_id: str) -> Job | None`
  - `def complete_job(conn, job_id: str) -> None`
  - `def fail_job(conn, job_id: str, code: str, msg: str, terminal: bool) -> None`
  - `def heartbeat(conn, job_id: str, progress: int) -> None`
  - `def enqueue(conn, type: str, payload: dict, *, user_id=None, project_id=None, priority=0) -> str`

- [ ] **Step 1: Buat paket Python**

`apps/downloader/pyproject.toml`:
```toml
[project]
name = "klipmatic-downloader"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
  "fastapi>=0.115",
  "uvicorn[standard]>=0.32",
  "psycopg[binary,pool]>=3.2",
  "boto3>=1.35",
  "httpx>=0.27",
  "yt-dlp==2026.7.4",
]

[dependency-groups]
dev = ["pytest>=8.3", "pytest-asyncio>=0.24"]

[tool.pytest.ini_options]
testpaths = ["tests"]
```

Versi yt-dlp di-pin sesuai spec §9.2. Pembaruan dilakukan sebagai perubahan tersendiri yang disengaja.

- [ ] **Step 2: Tulis tes yang gagal**

`apps/downloader/tests/conftest.py`:
```python
import os
import subprocess
from pathlib import Path

import psycopg
import pytest

TEST_DB_URL = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql://postgres:postgres@localhost:55432/klipmatic",
)
DB_PKG = Path(__file__).resolve().parents[3] / "packages" / "db"


@pytest.fixture
def conn():
    """Database bersih untuk setiap tes."""
    with psycopg.connect(TEST_DB_URL, autocommit=True) as c:
        c.execute("drop schema if exists public cascade; create schema public;")
        c.execute("drop schema if exists auth cascade;")
        c.execute((DB_PKG / "sql" / "000_auth_shim.sql").read_text())
        c.execute((DB_PKG / "migrations" / "0000_init.sql").read_text())
    with psycopg.connect(TEST_DB_URL) as c:
        yield c


def new_conn():
    return psycopg.connect(TEST_DB_URL)
```

`apps/downloader/tests/test_queue.py`:
```python
import concurrent.futures

from app.queue import claim_job, complete_job, enqueue, fail_job, heartbeat
from tests.conftest import new_conn


def test_claim_mengembalikan_none_saat_antrian_kosong(conn):
    assert claim_job(conn, "w1") is None


def test_claim_mengembalikan_job_dan_menaikkan_attempts(conn):
    job_id = enqueue(conn, "ingest", {"source_id": "x"})
    job = claim_job(conn, "w1")
    assert job is not None
    assert job.id == job_id
    assert job.type == "ingest"
    assert job.payload == {"source_id": "x"}
    assert job.attempts == 1


def test_job_yang_sudah_diklaim_tidak_diambil_lagi(conn):
    enqueue(conn, "ingest", {})
    assert claim_job(conn, "w1") is not None
    assert claim_job(conn, "w2") is None


def test_tidak_ada_job_diproses_dua_kali_saat_concurrent(conn):
    """Lima worker memperebutkan dua puluh job. Tiap job tepat sekali."""
    for i in range(20):
        enqueue(conn, "ingest", {"n": i})

    def drain(worker_id: str) -> list[str]:
        got = []
        with new_conn() as c:
            while True:
                job = claim_job(c, worker_id)
                if job is None:
                    return got
                got.append(job.id)

    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
        results = list(pool.map(drain, [f"w{i}" for i in range(5)]))

    claimed = [jid for r in results for jid in r]
    assert len(claimed) == 20
    assert len(set(claimed)) == 20


def test_prioritas_lebih_tinggi_diambil_lebih_dulu(conn):
    enqueue(conn, "ingest", {"n": "rendah"}, priority=0)
    high = enqueue(conn, "ingest", {"n": "tinggi"}, priority=10)
    assert claim_job(conn, "w1").id == high


def test_run_after_di_masa_depan_tidak_diambil(conn):
    enqueue(conn, "ingest", {})
    conn.execute("update jobs set run_after = now() + interval '1 hour'")
    conn.commit()
    assert claim_job(conn, "w1") is None


def test_complete_menandai_selesai_dan_progress_penuh(conn):
    job_id = enqueue(conn, "ingest", {})
    claim_job(conn, "w1")
    complete_job(conn, job_id)
    row = conn.execute(
        "select status, progress, locked_at from jobs where id = %s", (job_id,)
    ).fetchone()
    assert row == ("done", 100, None)


def test_fail_non_terminal_menjadwalkan_ulang_dengan_backoff(conn):
    job_id = enqueue(conn, "ingest", {})
    claim_job(conn, "w1")
    fail_job(conn, job_id, "SOURCE_BLOCKED", "diblokir", terminal=False)
    row = conn.execute(
        "select status, error_code, run_after > now() from jobs where id = %s", (job_id,)
    ).fetchone()
    assert row == ("queued", "SOURCE_BLOCKED", True)


def test_fail_terminal_tidak_dicoba_ulang(conn):
    job_id = enqueue(conn, "ingest", {})
    claim_job(conn, "w1")
    fail_job(conn, job_id, "SOURCE_UNAVAILABLE", "privat", terminal=True)
    assert conn.execute(
        "select status from jobs where id = %s", (job_id,)
    ).fetchone()[0] == "failed"


def test_melebihi_max_attempts_menjadi_dead(conn):
    job_id = enqueue(conn, "ingest", {})
    for _ in range(3):
        conn.execute("update jobs set run_after = now()")
        conn.commit()
        claim_job(conn, "w1")
        fail_job(conn, job_id, "TRANSCRIBE_FAILED", "gagal", terminal=False)
    assert conn.execute(
        "select status from jobs where id = %s", (job_id,)
    ).fetchone()[0] == "dead"


def test_heartbeat_memperbarui_progress_dan_lock(conn):
    job_id = enqueue(conn, "ingest", {})
    claim_job(conn, "w1")
    conn.execute("update jobs set locked_at = now() - interval '10 minutes'")
    conn.commit()
    heartbeat(conn, job_id, 42)
    row = conn.execute(
        "select progress, locked_at > now() - interval '1 minute' from jobs where id = %s",
        (job_id,),
    ).fetchone()
    assert row == (42, True)
```

- [ ] **Step 3: Jalankan tes untuk memastikan gagal**

Run: `cd apps/downloader && uv sync && uv run pytest tests/test_queue.py -v`
Expected: FAIL dengan `ModuleNotFoundError: No module named 'app.queue'`.

- [ ] **Step 4: Implementasikan errors dan queue**

`apps/downloader/app/errors.py`:
```python
class JobError(Exception):
    """Kegagalan job dengan kode stabil. Worker tidak pernah menghasilkan
    teks untuk user; pemetaan kode ke kalimat Indonesia ada di apps/web."""

    def __init__(self, code: str, message: str = "", terminal: bool = False):
        super().__init__(message or code)
        self.code = code
        self.terminal = terminal
```

`apps/downloader/app/queue.py`:
```python
from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

import psycopg

# Backoff eksponensial: percobaan ke-1 → 1 menit, ke-2 → 5 menit, ke-3 → 25 menit.
BACKOFF_BASE_SEC = 60
BACKOFF_FACTOR = 5


@dataclass(frozen=True)
class Job:
    id: str
    type: str
    payload: dict[str, Any]
    attempts: int
    max_attempts: int
    project_id: str | None
    user_id: str | None


def enqueue(
    conn: psycopg.Connection,
    type: str,
    payload: dict[str, Any],
    *,
    user_id: str | None = None,
    project_id: str | None = None,
    priority: int = 0,
) -> str:
    row = conn.execute(
        """
        insert into jobs (type, payload, user_id, project_id, priority)
        values (%s, %s::jsonb, %s, %s, %s)
        returning id
        """,
        (type, json.dumps(payload), user_id, project_id, priority),
    ).fetchone()
    conn.commit()
    return str(row[0])


def claim_job(conn: psycopg.Connection, worker_id: str) -> Job | None:
    row = conn.execute(
        """
        update jobs
           set status = 'running',
               locked_at = now(),
               locked_by = %s,
               attempts = attempts + 1,
               updated_at = now()
         where id = (
             select id from jobs
              where status = 'queued' and run_after <= now()
              order by priority desc, id
              for update skip locked
              limit 1
         )
        returning id, type, payload, attempts, max_attempts, project_id, user_id
        """,
        (worker_id,),
    ).fetchone()
    conn.commit()
    if row is None:
        return None
    return Job(
        id=str(row[0]),
        type=row[1],
        payload=row[2],
        attempts=row[3],
        max_attempts=row[4],
        project_id=str(row[5]) if row[5] else None,
        user_id=str(row[6]) if row[6] else None,
    )


def complete_job(conn: psycopg.Connection, job_id: str) -> None:
    conn.execute(
        """
        update jobs
           set status = 'done', progress = 100, locked_at = null,
               locked_by = null, updated_at = now()
         where id = %s
        """,
        (job_id,),
    )
    conn.commit()


def fail_job(
    conn: psycopg.Connection, job_id: str, code: str, msg: str, terminal: bool
) -> None:
    """Job terminal langsung gagal. Job non-terminal dijadwalkan ulang dengan
    backoff sampai max_attempts terlampaui, lalu menjadi 'dead'."""
    conn.execute(
        """
        update jobs
           set status = case
                 when %s then 'failed'
                 when attempts >= max_attempts then 'dead'
                 else 'queued'
               end,
               run_after = case
                 when %s or attempts >= max_attempts then run_after
                 else now() + make_interval(
                        secs => %s * power(%s, greatest(attempts - 1, 0)))
               end,
               error_code = %s,
               error_msg = %s,
               locked_at = null,
               locked_by = null,
               updated_at = now()
         where id = %s
        """,
        (terminal, terminal, BACKOFF_BASE_SEC, BACKOFF_FACTOR, code, msg[:2000], job_id),
    )
    conn.commit()


def heartbeat(conn: psycopg.Connection, job_id: str, progress: int) -> None:
    """Memperbarui progress sekaligus memperpanjang lock agar reaper tidak
    menganggap worker mati. Perubahan kolom ini yang didorong Supabase
    Realtime ke browser."""
    conn.execute(
        """
        update jobs
           set progress = greatest(0, least(100, %s)),
               locked_at = now(),
               updated_at = now()
         where id = %s
        """,
        (progress, job_id),
    )
    conn.commit()
```

- [ ] **Step 5: Jalankan tes**

Run: `cd apps/downloader && uv run pytest tests/test_queue.py -v`
Expected: PASS, sebelas tes lulus — termasuk tes concurrency.

- [ ] **Step 6: Commit**

```bash
git add apps/downloader
git commit -m "feat(worker): postgres job queue with SKIP LOCKED and concurrency tests"
```

---

## Task 7: Reaper dan loop worker

**Files:**
- Create: `apps/downloader/app/reaper.py`, `apps/downloader/app/worker.py`
- Test: `apps/downloader/tests/test_reaper.py`, `apps/downloader/tests/test_worker.py`

**Interfaces:**
- Consumes: `claim_job`, `complete_job`, `fail_job` dari Task 6; `JobError`
- Produces:
  - `def reap_stale_jobs(conn, older_than_sec: int = 300) -> int`
  - `HANDLERS: dict[str, Callable[[Connection, Job], None]]`
  - `def run_once(conn, worker_id: str, handlers: dict) -> bool` — mengembalikan True bila ada job diproses

- [ ] **Step 1: Tulis tes yang gagal**

`apps/downloader/tests/test_reaper.py`:
```python
from app.queue import claim_job, enqueue
from app.reaper import reap_stale_jobs


def test_job_dengan_lock_basi_dikembalikan_ke_antrian(conn):
    job_id = enqueue(conn, "ingest", {})
    claim_job(conn, "w1")
    conn.execute("update jobs set locked_at = now() - interval '10 minutes'")
    conn.commit()

    assert reap_stale_jobs(conn, older_than_sec=300) == 1
    row = conn.execute(
        "select status, locked_by, error_code from jobs where id = %s", (job_id,)
    ).fetchone()
    assert row == ("queued", None, "WORKER_LOST")


def test_job_dengan_lock_segar_tidak_disentuh(conn):
    enqueue(conn, "ingest", {})
    claim_job(conn, "w1")
    assert reap_stale_jobs(conn, older_than_sec=300) == 0


def test_job_selesai_tidak_disentuh(conn):
    from app.queue import complete_job

    job_id = enqueue(conn, "ingest", {})
    claim_job(conn, "w1")
    complete_job(conn, job_id)
    assert reap_stale_jobs(conn, older_than_sec=0) == 0


def test_reaper_menghormati_max_attempts(conn):
    job_id = enqueue(conn, "ingest", {})
    conn.execute("update jobs set max_attempts = 1")
    conn.commit()
    claim_job(conn, "w1")
    conn.execute("update jobs set locked_at = now() - interval '10 minutes'")
    conn.commit()

    reap_stale_jobs(conn, older_than_sec=300)
    assert conn.execute(
        "select status from jobs where id = %s", (job_id,)
    ).fetchone()[0] == "dead"
```

`apps/downloader/tests/test_worker.py`:
```python
import pytest

from app.errors import JobError
from app.queue import enqueue
from app.worker import run_once


def test_run_once_mengembalikan_false_saat_antrian_kosong(conn):
    assert run_once(conn, "w1", {}) is False


def test_handler_sukses_menandai_job_selesai(conn):
    seen = []
    job_id = enqueue(conn, "ingest", {"a": 1})

    def handler(c, job):
        seen.append(job.payload)

    assert run_once(conn, "w1", {"ingest": handler}) is True
    assert seen == [{"a": 1}]
    assert conn.execute(
        "select status from jobs where id = %s", (job_id,)
    ).fetchone()[0] == "done"


def test_job_error_terminal_menggagalkan_tanpa_retry(conn):
    job_id = enqueue(conn, "ingest", {})

    def handler(c, job):
        raise JobError("SOURCE_UNAVAILABLE", "video privat", terminal=True)

    run_once(conn, "w1", {"ingest": handler})
    row = conn.execute(
        "select status, error_code from jobs where id = %s", (job_id,)
    ).fetchone()
    assert row == ("failed", "SOURCE_UNAVAILABLE")


def test_exception_tak_terduga_menjadi_INTERNAL_dan_dicoba_ulang(conn):
    job_id = enqueue(conn, "ingest", {})

    def handler(c, job):
        raise ValueError("bug tak terduga")

    run_once(conn, "w1", {"ingest": handler})
    row = conn.execute(
        "select status, error_code from jobs where id = %s", (job_id,)
    ).fetchone()
    assert row == ("queued", "INTERNAL")


def test_tipe_tanpa_handler_gagal_terminal(conn):
    job_id = enqueue(conn, "ingest", {})
    run_once(conn, "w1", {})
    row = conn.execute(
        "select status, error_code from jobs where id = %s", (job_id,)
    ).fetchone()
    assert row == ("failed", "INTERNAL")
```

- [ ] **Step 2: Jalankan tes untuk memastikan gagal**

Run: `cd apps/downloader && uv run pytest tests/test_reaper.py tests/test_worker.py -v`
Expected: FAIL — modul `app.reaper` dan `app.worker` belum ada.

- [ ] **Step 3: Implementasikan reaper**

`apps/downloader/app/reaper.py`:
```python
from __future__ import annotations

import psycopg


def reap_stale_jobs(conn: psycopg.Connection, older_than_sec: int = 300) -> int:
    """Mengembalikan job yang worker-nya mati mendadak ke antrian.

    Deteksinya adalah lock yang tidak diperbarui: heartbeat menyegarkan
    locked_at setiap 30 detik, jadi lock yang lebih tua dari older_than_sec
    berarti worker sudah tidak hidup.
    """
    rows = conn.execute(
        """
        update jobs
           set status = case when attempts >= max_attempts then 'dead' else 'queued' end,
               locked_at = null,
               locked_by = null,
               error_code = 'WORKER_LOST',
               updated_at = now()
         where status = 'running'
           and locked_at < now() - make_interval(secs => %s)
        returning id
        """,
        (older_than_sec,),
    ).fetchall()
    conn.commit()
    return len(rows)
```

- [ ] **Step 4: Implementasikan loop worker**

`apps/downloader/app/worker.py`:
```python
from __future__ import annotations

import logging
import os
import time
from typing import Callable

import psycopg

from app.errors import JobError
from app.queue import Job, claim_job, complete_job, fail_job
from app.reaper import reap_stale_jobs

log = logging.getLogger(__name__)

Handler = Callable[[psycopg.Connection, Job], None]


def run_once(conn: psycopg.Connection, worker_id: str, handlers: dict[str, Handler]) -> bool:
    """Memproses paling banyak satu job. True bila ada job yang diproses."""
    job = claim_job(conn, worker_id)
    if job is None:
        return False

    handler = handlers.get(job.type)
    if handler is None:
        log.error("tidak ada handler untuk tipe job %s", job.type)
        fail_job(conn, job.id, "INTERNAL", f"handler tidak terdaftar: {job.type}", terminal=True)
        return True

    try:
        handler(conn, job)
        complete_job(conn, job.id)
    except JobError as e:
        log.warning("job %s gagal: %s", job.id, e.code)
        fail_job(conn, job.id, e.code, str(e), terminal=e.terminal)
    except Exception as e:  # noqa: BLE001 — jaring pengaman terakhir worker
        log.exception("job %s melempar exception tak terduga", job.id)
        fail_job(conn, job.id, "INTERNAL", str(e), terminal=False)
    return True


def main() -> None:
    from app.handlers.ingest import handle_ingest

    handlers: dict[str, Handler] = {"ingest": handle_ingest}
    worker_id = os.environ.get("WORKER_ID", "worker-1")
    poll = float(os.environ.get("WORKER_POLL_INTERVAL_SEC", "2"))
    reap_every = 60.0
    last_reap = 0.0

    logging.basicConfig(level=logging.INFO)
    log.info("worker %s mulai", worker_id)

    with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
        while True:
            now = time.monotonic()
            if now - last_reap > reap_every:
                reaped = reap_stale_jobs(conn)
                if reaped:
                    log.warning("mengembalikan %d job basi ke antrian", reaped)
                last_reap = now
            if not run_once(conn, worker_id, handlers):
                time.sleep(poll)


if __name__ == "__main__":
    main()
```

- [ ] **Step 5: Jalankan tes**

Run: `cd apps/downloader && uv run pytest tests/test_reaper.py tests/test_worker.py -v`
Expected: PASS, sembilan tes lulus.

- [ ] **Step 6: Commit**

```bash
git add apps/downloader
git commit -m "feat(worker): reaper for dead workers and job dispatch loop"
```

---

## Task 8: Wrapper yt-dlp dan pemetaan error

Setiap mode kegagalan yt-dlp harus dipetakan ke `error_code` yang stabil. Tanpa ini, user melihat stderr mentah dan job yang seharusnya berhenti akan dicoba ulang berkali-kali sia-sia.

**Files:**
- Create: `apps/downloader/app/ytdlp.py`
- Create: `apps/downloader/tests/fixtures/ytdlp_youtube_ok.json`
- Test: `apps/downloader/tests/test_ytdlp.py`

**Interfaces:**
- Consumes: `JobError`
- Produces:
  - `@dataclass SourceMeta` dengan field `title: str`, `channel: str | None`, `duration_sec: int`, `thumbnail_url: str | None`, `availability: str`
  - `def classify_ytdlp_error(stderr: str) -> JobError`
  - `def probe(url: str) -> SourceMeta`
  - `def download_audio(url: str, dest: Path, on_progress: Callable[[int], None]) -> Path`

- [ ] **Step 1: Rekam fixture metadata**

Jalankan sekali di mesin lokal — **bukan di CI** — lalu commit hasilnya:
```bash
cd apps/downloader
uv run yt-dlp -J --no-warnings "https://www.youtube.com/watch?v=dQw4w9WgXcQ" \
  > tests/fixtures/ytdlp_youtube_ok.json
```
Bila jaringan tidak tersedia, buat berkas minimal berisi field yang dipakai:
```json
{
  "title": "Contoh Video",
  "uploader": "Contoh Channel",
  "duration": 213,
  "thumbnail": "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg",
  "availability": "public"
}
```

- [ ] **Step 2: Tulis tes yang gagal**

`apps/downloader/tests/test_ytdlp.py`:
```python
import json
from pathlib import Path

import pytest

from app.errors import JobError
from app.ytdlp import SourceMeta, classify_ytdlp_error, parse_meta

FIXTURES = Path(__file__).parent / "fixtures"


def test_parse_meta_membaca_field_yang_dipakai():
    raw = json.loads((FIXTURES / "ytdlp_youtube_ok.json").read_text())
    meta = parse_meta(raw)
    assert isinstance(meta, SourceMeta)
    assert meta.title
    assert meta.duration_sec > 0
    assert meta.availability == "public"


def test_parse_meta_menolak_durasi_melebihi_batas():
    with pytest.raises(JobError) as e:
        parse_meta({"title": "x", "duration": 5 * 3600, "availability": "public"})
    assert e.value.code == "SOURCE_TOO_LONG"
    assert e.value.terminal is True


def test_parse_meta_menolak_durasi_tidak_diketahui():
    with pytest.raises(JobError) as e:
        parse_meta({"title": "siaran langsung", "availability": "public"})
    assert e.value.code == "SOURCE_UNAVAILABLE"


@pytest.mark.parametrize(
    "stderr,code,terminal",
    [
        ("ERROR: Sign in to confirm you're not a bot", "SOURCE_BLOCKED", False),
        ("ERROR: Video unavailable. This video is private", "SOURCE_UNAVAILABLE", True),
        ("ERROR: This video has been removed by the uploader", "SOURCE_UNAVAILABLE", True),
        ("ERROR: Video unavailable. The uploader has not made this video available in your country",
         "SOURCE_GEOBLOCKED", True),
        ("ERROR: Sign in to confirm your age", "SOURCE_AGE_RESTRICTED", True),
        ("ERROR: Unable to extract player response", "SOURCE_BLOCKED", False),
        ("ERROR: sesuatu yang belum pernah terjadi", "INTERNAL", False),
    ],
)
def test_classify_ytdlp_error(stderr, code, terminal):
    err = classify_ytdlp_error(stderr)
    assert err.code == code
    assert err.terminal is terminal


def test_pesan_error_tidak_membocorkan_stderr_mentah_ke_kode():
    err = classify_ytdlp_error("ERROR: /home/rahasia/path/bocor.txt not found")
    assert err.code == "INTERNAL"
```

- [ ] **Step 3: Jalankan tes untuk memastikan gagal**

Run: `cd apps/downloader && uv run pytest tests/test_ytdlp.py -v`
Expected: FAIL dengan `ModuleNotFoundError: No module named 'app.ytdlp'`.

- [ ] **Step 4: Implementasikan**

`apps/downloader/app/ytdlp.py`:
```python
from __future__ import annotations

import json
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from app.errors import JobError

MAX_DURATION_SEC = 4 * 60 * 60  # Spec §9.1

# Urutan penting: pola paling spesifik lebih dulu.
_ERROR_PATTERNS: list[tuple[str, str, bool]] = [
    (r"not made this video available in your country|geo.?restrict", "SOURCE_GEOBLOCKED", True),
    (r"confirm your age|age.?restrict", "SOURCE_AGE_RESTRICTED", True),
    (r"not a bot|Sign in to confirm|too many requests|HTTP Error 429", "SOURCE_BLOCKED", False),
    (r"unable to extract|player response|nsig extraction", "SOURCE_BLOCKED", False),
    (r"private video|is private|removed by the uploader|Video unavailable|does not exist",
     "SOURCE_UNAVAILABLE", True),
]


@dataclass(frozen=True)
class SourceMeta:
    title: str
    channel: str | None
    duration_sec: int
    thumbnail_url: str | None
    availability: str


def classify_ytdlp_error(stderr: str) -> JobError:
    """Memetakan stderr yt-dlp ke kode stabil. Stderr mentah masuk ke pesan
    exception untuk log operator, tidak pernah ke user."""
    for pattern, code, terminal in _ERROR_PATTERNS:
        if re.search(pattern, stderr, re.IGNORECASE):
            return JobError(code, stderr[:500], terminal=terminal)
    return JobError("INTERNAL", stderr[:500], terminal=False)


def parse_meta(raw: dict[str, Any]) -> SourceMeta:
    duration = raw.get("duration")
    if not duration:
        # Siaran langsung dan sebagian sumber tidak melaporkan durasi.
        # Tanpa durasi kita tidak bisa menghitung biaya maupun memotong segmen.
        raise JobError("SOURCE_UNAVAILABLE", "durasi tidak diketahui", terminal=True)
    duration = int(duration)
    if duration > MAX_DURATION_SEC:
        raise JobError("SOURCE_TOO_LONG", f"durasi {duration}s", terminal=True)
    return SourceMeta(
        title=raw.get("title") or "Tanpa judul",
        channel=raw.get("uploader") or raw.get("channel"),
        duration_sec=duration,
        thumbnail_url=raw.get("thumbnail"),
        availability=raw.get("availability") or "public",
    )


def _run(args: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, capture_output=True, text=True, timeout=1800)


def probe(url: str) -> SourceMeta:
    proc = _run(["yt-dlp", "-J", "--no-warnings", "--no-playlist", url])
    if proc.returncode != 0:
        raise classify_ytdlp_error(proc.stderr)
    return parse_meta(json.loads(proc.stdout))


_PROGRESS_RE = re.compile(r"\[download\]\s+(\d+(?:\.\d+)?)%")


def download_audio(url: str, dest: Path, on_progress: Callable[[int], None]) -> Path:
    """Mengunduh trek audio saja (fase 1 dari download dua fase, spec §3.1)."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    proc = subprocess.Popen(
        [
            "yt-dlp", "-f", "bestaudio/best", "--no-playlist", "--no-warnings",
            "--newline", "-o", str(dest), url,
        ],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
    )
    assert proc.stdout is not None
    for line in proc.stdout:
        m = _PROGRESS_RE.search(line)
        if m:
            on_progress(int(float(m.group(1))))
    proc.wait(timeout=3600)
    if proc.returncode != 0:
        raise classify_ytdlp_error(proc.stderr.read() if proc.stderr else "")
    if not dest.exists():
        raise JobError("INTERNAL", "yt-dlp selesai tanpa menghasilkan berkas")
    return dest
```

- [ ] **Step 5: Jalankan tes**

Run: `cd apps/downloader && uv run pytest tests/test_ytdlp.py -v`
Expected: PASS, sebelas tes lulus.

- [ ] **Step 6: Commit**

```bash
git add apps/downloader
git commit -m "feat(worker): yt-dlp wrapper with stable error classification"
```

---

## Task 9: Ekstraksi audio dan penyimpanan R2

**Files:**
- Create: `apps/downloader/app/ffmpeg.py`, `apps/downloader/app/storage.py`
- Test: `apps/downloader/tests/test_ffmpeg.py`, `apps/downloader/tests/test_storage.py`

**Interfaces:**
- Consumes: `JobError`
- Produces:
  - `def extract_audio(src: Path, dest: Path) -> Path` — Opus 16 kHz mono
  - `def sha256_file(path: Path) -> str`
  - `class Storage` dengan `put_file(key: str, path: Path, content_type: str) -> None`, `exists(key: str) -> bool`, `presigned_get(key: str, expires_sec: int = 3600) -> str`
  - `def storage_from_env() -> Storage`

- [ ] **Step 1: Tulis tes yang gagal**

`apps/downloader/tests/test_ffmpeg.py`:
```python
import subprocess
from pathlib import Path

import pytest

from app.ffmpeg import extract_audio, sha256_file


@pytest.fixture
def tone(tmp_path: Path) -> Path:
    """Membuat berkas WAV 2 detik dengan ffmpeg agar tes tidak butuh aset biner."""
    out = tmp_path / "tone.wav"
    subprocess.run(
        ["ffmpeg", "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
         "-ac", "2", "-ar", "44100", "-y", str(out)],
        check=True, capture_output=True,
    )
    return out


def test_extract_audio_menghasilkan_opus_16k_mono(tone: Path, tmp_path: Path):
    dest = tmp_path / "out.opus"
    extract_audio(tone, dest)
    assert dest.exists() and dest.stat().st_size > 0

    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "a:0",
         "-show_entries", "stream=codec_name,channels,sample_rate",
         "-of", "default=noprint_wrappers=1:nokey=1", str(dest)],
        check=True, capture_output=True, text=True,
    ).stdout.split()
    assert probe[0] == "opus"
    assert probe[1] == "1"        # mono
    assert probe[2] == "16000"    # 16 kHz


def test_extract_audio_jauh_lebih_kecil_dari_sumber(tone: Path, tmp_path: Path):
    dest = tmp_path / "out.opus"
    extract_audio(tone, dest)
    assert dest.stat().st_size < tone.stat().st_size


def test_sha256_stabil_dan_membedakan_isi(tmp_path: Path):
    a, b = tmp_path / "a.bin", tmp_path / "b.bin"
    a.write_bytes(b"halo dunia")
    b.write_bytes(b"halo duniA")
    assert sha256_file(a) == sha256_file(a)
    assert sha256_file(a) != sha256_file(b)
    assert len(sha256_file(a)) == 64
```

`apps/downloader/tests/test_storage.py`:
```python
import os
from pathlib import Path

import pytest

from app.storage import Storage

pytestmark = pytest.mark.skipif(
    not os.environ.get("R2_ENDPOINT"), reason="butuh MinIO berjalan"
)


@pytest.fixture
def storage() -> Storage:
    s = Storage(
        endpoint=os.environ["R2_ENDPOINT"],
        access_key=os.environ["R2_ACCESS_KEY_ID"],
        secret_key=os.environ["R2_SECRET_ACCESS_KEY"],
        bucket=os.environ["R2_BUCKET"],
    )
    s.ensure_bucket()
    return s


def test_put_lalu_exists(storage: Storage, tmp_path: Path):
    f = tmp_path / "x.txt"
    f.write_text("isi")
    assert storage.exists("tes/x.txt") is False
    storage.put_file("tes/x.txt", f, "text/plain")
    assert storage.exists("tes/x.txt") is True


def test_presigned_get_dapat_diunduh(storage: Storage, tmp_path: Path):
    import httpx

    f = tmp_path / "y.txt"
    f.write_text("isi presigned")
    storage.put_file("tes/y.txt", f, "text/plain")
    url = storage.presigned_get("tes/y.txt", expires_sec=60)
    assert httpx.get(url).text == "isi presigned"
```

- [ ] **Step 2: Jalankan tes untuk memastikan gagal**

Run: `cd apps/downloader && uv run pytest tests/test_ffmpeg.py tests/test_storage.py -v`
Expected: FAIL — modul belum ada.

- [ ] **Step 3: Implementasikan ffmpeg**

`apps/downloader/app/ffmpeg.py`:
```python
from __future__ import annotations

import hashlib
import subprocess
from pathlib import Path

from app.errors import JobError

# Whisper mengharapkan 16 kHz mono. Menghasilkannya di sini membuat berkas
# kecil (~40 MB per jam) dan menghemat kerja di sisi penyedia transkripsi.
SAMPLE_RATE = 16000
BITRATE = "24k"


def extract_audio(src: Path, dest: Path) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    proc = subprocess.run(
        [
            "ffmpeg", "-i", str(src), "-vn",
            "-ac", "1", "-ar", str(SAMPLE_RATE),
            "-c:a", "libopus", "-b:a", BITRATE,
            "-y", str(dest),
        ],
        capture_output=True, text=True, timeout=1800,
    )
    if proc.returncode != 0 or not dest.exists():
        raise JobError("INTERNAL", f"ffmpeg gagal: {proc.stderr[-500:]}")
    return dest


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()
```

- [ ] **Step 4: Implementasikan storage**

`apps/downloader/app/storage.py`:
```python
from __future__ import annotations

import os
from pathlib import Path

import boto3
from botocore.client import Config
from botocore.exceptions import ClientError


class Storage:
    """Klien R2. R2 berbicara protokol S3, jadi boto3 dipakai apa adanya;
    MinIO memakai antarmuka yang sama sehingga tes tidak butuh jaringan luar."""

    def __init__(self, endpoint: str, access_key: str, secret_key: str, bucket: str):
        self.bucket = bucket
        self._s3 = boto3.client(
            "s3",
            endpoint_url=endpoint,
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            config=Config(signature_version="s3v4"),
            region_name="auto",
        )

    def ensure_bucket(self) -> None:
        try:
            self._s3.head_bucket(Bucket=self.bucket)
        except ClientError:
            self._s3.create_bucket(Bucket=self.bucket)

    def put_file(self, key: str, path: Path, content_type: str) -> None:
        self._s3.upload_file(
            str(path), self.bucket, key,
            ExtraArgs={
                "ContentType": content_type,
                # Key bersifat content-addressed sehingga aman di-cache selamanya.
                "CacheControl": "public, max-age=31536000, immutable",
            },
        )

    def exists(self, key: str) -> bool:
        try:
            self._s3.head_object(Bucket=self.bucket, Key=key)
            return True
        except ClientError:
            return False

    def presigned_get(self, key: str, expires_sec: int = 3600) -> str:
        return self._s3.generate_presigned_url(
            "get_object",
            Params={"Bucket": self.bucket, "Key": key},
            ExpiresIn=expires_sec,
        )


def storage_from_env() -> Storage:
    return Storage(
        endpoint=os.environ["R2_ENDPOINT"],
        access_key=os.environ["R2_ACCESS_KEY_ID"],
        secret_key=os.environ["R2_SECRET_ACCESS_KEY"],
        bucket=os.environ["R2_BUCKET"],
    )
```

- [ ] **Step 5: Jalankan tes**

Run:
```bash
cd apps/downloader
R2_ENDPOINT=http://localhost:9000 R2_ACCESS_KEY_ID=minioadmin \
R2_SECRET_ACCESS_KEY=minioadmin R2_BUCKET=klipmatic \
uv run pytest tests/test_ffmpeg.py tests/test_storage.py -v
```
Expected: PASS, lima tes lulus.

- [ ] **Step 6: Commit**

```bash
git add apps/downloader
git commit -m "feat(worker): opus audio extraction and R2 storage client"
```

---

## Task 10: Handler ingest dengan deduplikasi sumber

Handler yang menyatukan semuanya. Di sinilah penghematan biaya benar-benar terjadi: pemeriksaan cache berjalan **sebelum** yt-dlp dipanggil.

**Files:**
- Create: `apps/downloader/app/handlers/__init__.py`, `apps/downloader/app/handlers/ingest.py`
- Test: `apps/downloader/tests/test_ingest.py`

**Interfaces:**
- Consumes: `probe`, `download_audio` (Task 8); `extract_audio`, `sha256_file` (Task 9); `Storage` (Task 9); `heartbeat` (Task 6)
- Produces: `def handle_ingest(conn, job) -> None`; payload job berbentuk `{"source_id": str, "project_id": str}`

- [ ] **Step 1: Tulis tes yang gagal**

`apps/downloader/tests/test_ingest.py`:
```python
import json
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from app.errors import JobError
from app.handlers.ingest import handle_ingest
from app.queue import Job
from app.ytdlp import SourceMeta

META = SourceMeta(
    title="Podcast Contoh",
    channel="Channel Contoh",
    duration_sec=3600,
    thumbnail_url="https://example.com/t.jpg",
    availability="public",
)


def _user(conn, email: str) -> str:
    uid = conn.execute(
        "insert into auth.users (email) values (%s) returning id", (email,)
    ).fetchone()[0]
    conn.execute("insert into profiles (user_id) values (%s)", (uid,))
    conn.commit()
    return str(uid)


def _source(conn, owner: str, external_id: str = "dQw4w9WgXcQ") -> str:
    sid = conn.execute(
        """
        insert into sources (kind, external_id, is_public, owner_user_id, url_original, status)
        values ('youtube', %s, false, %s, 'https://youtu.be/x', 'pending')
        returning id
        """,
        (external_id, owner),
    ).fetchone()[0]
    conn.commit()
    return str(sid)


def _project(conn, user: str, source: str) -> str:
    pid = conn.execute(
        "insert into projects (user_id, source_id, title) values (%s, %s, 'p') returning id",
        (user, source),
    ).fetchone()[0]
    conn.commit()
    return str(pid)


@pytest.fixture
def deps(tmp_path: Path):
    storage = MagicMock()
    storage.exists.return_value = False

    def fake_download(url, dest, on_progress):
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(b"audio palsu")
        on_progress(50)
        return dest

    def fake_extract(src, dest):
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(b"opus palsu")
        return dest

    return {
        "storage": storage,
        "probe": lambda url: META,
        "download_audio": fake_download,
        "extract_audio": fake_extract,
        "workdir": tmp_path,
    }


def test_ingest_baru_mengunggah_audio_dan_menandai_ready(conn, deps):
    u = _user(conn, "a@test.id")
    s = _source(conn, u)
    p = _project(conn, u, s)

    handle_ingest(conn, Job("j1", "ingest", {"source_id": s, "project_id": p}, 1, 3, p, u), **deps)

    row = conn.execute(
        "select status, audio_r2_key, audio_sha256, duration_sec, title, is_public "
        "from sources where id = %s", (s,)
    ).fetchone()
    assert row[0] == "ready"
    assert row[1].startswith("audio/")
    assert len(row[2]) == 64
    assert row[3] == 3600
    assert row[4] == "Podcast Contoh"
    assert row[5] is True  # dipromosikan karena availability == 'public'
    deps["storage"].put_file.assert_called_once()


def test_sumber_unlisted_tetap_privat(conn, deps):
    u = _user(conn, "b@test.id")
    s = _source(conn, u)
    p = _project(conn, u, s)
    deps["probe"] = lambda url: SourceMeta(**{**META.__dict__, "availability": "unlisted"})

    handle_ingest(conn, Job("j2", "ingest", {"source_id": s, "project_id": p}, 1, 3, p, u), **deps)

    row = conn.execute(
        "select is_public, owner_user_id from sources where id = %s", (s,)
    ).fetchone()
    assert row[0] is False
    assert str(row[1]) == u


def test_user_kedua_memakai_ulang_sumber_publik_tanpa_mengunduh(conn, deps):
    a = _user(conn, "a2@test.id")
    sa = _source(conn, a)
    pa = _project(conn, a, sa)
    handle_ingest(conn, Job("j3", "ingest", {"source_id": sa, "project_id": pa}, 1, 3, pa, a), **deps)

    b = _user(conn, "b2@test.id")
    sb = _source(conn, b)               # baris privat milik B untuk video yang sama
    pb = _project(conn, b, sb)

    called = []
    deps["probe"] = lambda url: called.append(url) or META

    handle_ingest(conn, Job("j4", "ingest", {"source_id": sb, "project_id": pb}, 1, 3, pb, b), **deps)

    assert called == []  # yt-dlp tidak dipanggil sama sekali
    # Proyek B dialihkan ke sumber publik milik bersama, baris duplikat dihapus.
    assert str(conn.execute(
        "select source_id from projects where id = %s", (pb,)
    ).fetchone()[0]) == sa
    assert conn.execute("select count(*) from sources where id = %s", (sb,)).fetchone()[0] == 0


def test_sumber_privat_tidak_dipakai_ulang_lintas_user(conn, deps):
    deps["probe"] = lambda url: SourceMeta(**{**META.__dict__, "availability": "unlisted"})
    a = _user(conn, "a3@test.id")
    sa = _source(conn, a, "GDRIVE_ID_AAAAAAAAAAAAAAA")
    pa = _project(conn, a, sa)
    handle_ingest(conn, Job("j5", "ingest", {"source_id": sa, "project_id": pa}, 1, 3, pa, a), **deps)

    b = _user(conn, "b3@test.id")
    sb = _source(conn, b, "GDRIVE_ID_AAAAAAAAAAAAAAA")
    pb = _project(conn, b, sb)

    called = []
    deps["probe"] = lambda url: called.append(url) or SourceMeta(
        **{**META.__dict__, "availability": "unlisted"}
    )
    handle_ingest(conn, Job("j6", "ingest", {"source_id": sb, "project_id": pb}, 1, 3, pb, b), **deps)

    assert len(called) == 1  # B mengunduh sendiri, tidak memakai milik A
    assert str(conn.execute(
        "select source_id from projects where id = %s", (pb,)
    ).fetchone()[0]) == sb


def test_error_terminal_menandai_sumber_failed(conn, deps):
    u = _user(conn, "c@test.id")
    s = _source(conn, u)
    p = _project(conn, u, s)

    def boom(url):
        raise JobError("SOURCE_UNAVAILABLE", "privat", terminal=True)

    deps["probe"] = boom

    with pytest.raises(JobError) as e:
        handle_ingest(conn, Job("j7", "ingest", {"source_id": s, "project_id": p}, 1, 3, p, u), **deps)

    assert e.value.code == "SOURCE_UNAVAILABLE"
    row = conn.execute(
        "select status, error_code from sources where id = %s", (s,)
    ).fetchone()
    assert row == ("failed", "SOURCE_UNAVAILABLE")
```

- [ ] **Step 2: Jalankan tes untuk memastikan gagal**

Run: `cd apps/downloader && uv run pytest tests/test_ingest.py -v`
Expected: FAIL — modul `app.handlers.ingest` belum ada.

- [ ] **Step 3: Implementasikan handler**

`apps/downloader/app/handlers/__init__.py`: (berkas kosong)

`apps/downloader/app/handlers/ingest.py`:
```python
from __future__ import annotations

import tempfile
from pathlib import Path
from typing import Any, Callable

import psycopg

from app.errors import JobError
from app.ffmpeg import extract_audio as _extract_audio
from app.ffmpeg import sha256_file
from app.queue import Job, heartbeat
from app.storage import Storage, storage_from_env
from app.ytdlp import SourceMeta
from app.ytdlp import download_audio as _download_audio
from app.ytdlp import probe as _probe


def _find_reusable_source(
    conn: psycopg.Connection, kind: str, external_id: str, user_id: str | None
) -> str | None:
    """Mencari sumber yang sudah siap dan boleh dipakai user ini.

    Aturannya identik dengan RLS (spec §6.3): sumber publik terbuka untuk
    semua, sumber privat hanya untuk pemiliknya. Pemeriksaan ini berjalan
    sebelum yt-dlp sehingga cache hit tidak menimbulkan biaya sama sekali.
    """
    row = conn.execute(
        """
        select id from sources
         where kind = %s and external_id = %s and status = 'ready'
           and (is_public or owner_user_id = %s)
         order by is_public desc
         limit 1
        """,
        (kind, external_id, user_id),
    ).fetchone()
    return str(row[0]) if row else None


def _repoint_and_drop(
    conn: psycopg.Connection, project_id: str, keep_source_id: str, drop_source_id: str
) -> None:
    conn.execute(
        "update projects set source_id = %s, updated_at = now() where id = %s",
        (keep_source_id, project_id),
    )
    conn.execute("delete from sources where id = %s", (drop_source_id,))
    conn.commit()


def _promote_or_keep_private(
    conn: psycopg.Connection, source_id: str, project_id: str, meta: SourceMeta,
    kind: str, external_id: str,
) -> str:
    """Menetapkan is_public final dari metadata yt-dlp (spec §8.1).

    Bila sudah ada baris publik untuk sumber yang sama — akibat balapan antar
    worker — proyek dialihkan ke baris itu dan baris ini dihapus, sehingga
    unique index tidak pernah dilanggar.
    """
    if meta.availability != "public":
        return source_id

    existing = conn.execute(
        "select id from sources where kind = %s and external_id = %s and is_public",
        (kind, external_id),
    ).fetchone()
    if existing and str(existing[0]) != source_id:
        _repoint_and_drop(conn, project_id, str(existing[0]), source_id)
        return str(existing[0])

    conn.execute(
        "update sources set is_public = true, owner_user_id = null, updated_at = now() "
        "where id = %s",
        (source_id,),
    )
    conn.commit()
    return source_id


def handle_ingest(
    conn: psycopg.Connection,
    job: Job,
    *,
    storage: Storage | None = None,
    probe: Callable[[str], SourceMeta] = _probe,
    download_audio: Callable[..., Path] = _download_audio,
    extract_audio: Callable[[Path, Path], Path] = _extract_audio,
    workdir: Path | None = None,
) -> None:
    """Fase 1 dari download dua fase: hanya audio yang diambil.

    Dependensi disuntikkan lewat keyword agar tes tidak menyentuh jaringan.
    """
    storage = storage or storage_from_env()
    source_id: str = job.payload["source_id"]
    project_id: str = job.payload["project_id"]

    row = conn.execute(
        "select kind, external_id, url_original, owner_user_id from sources where id = %s",
        (source_id,),
    ).fetchone()
    if row is None:
        raise JobError("INTERNAL", f"source {source_id} tidak ditemukan", terminal=True)
    kind, external_id, url, owner_user_id = row[0], row[1], row[2], row[3]
    owner = str(owner_user_id) if owner_user_id else None

    reusable = _find_reusable_source(conn, kind, external_id, owner)
    if reusable and reusable != source_id:
        _repoint_and_drop(conn, project_id, reusable, source_id)
        heartbeat(conn, job.id, 100)
        return

    try:
        heartbeat(conn, job.id, 5)
        meta = probe(url)

        tmp_root = workdir or Path(tempfile.mkdtemp(prefix="cc-ingest-"))
        raw = tmp_root / f"{source_id}.raw"
        opus = tmp_root / f"{source_id}.opus"

        download_audio(url, raw, lambda pct: heartbeat(conn, job.id, 5 + pct * 70 // 100))
        heartbeat(conn, job.id, 80)

        extract_audio(raw, opus)
        digest = sha256_file(opus)
        key = f"audio/{digest}.opus"

        if not storage.exists(key):
            storage.put_file(key, opus, "audio/ogg")
        heartbeat(conn, job.id, 95)

        conn.execute(
            """
            update sources
               set title = %s, channel = %s, duration_sec = %s, thumbnail_url = %s,
                   audio_r2_key = %s, audio_sha256 = %s, status = 'ready',
                   error_code = null, updated_at = now()
             where id = %s
            """,
            (meta.title, meta.channel, meta.duration_sec, meta.thumbnail_url,
             key, digest, source_id),
        )
        conn.commit()

        _promote_or_keep_private(conn, source_id, project_id, meta, kind, external_id)

    except JobError as e:
        conn.execute(
            "update sources set status = 'failed', error_code = %s, updated_at = now() "
            "where id = %s",
            (e.code, source_id),
        )
        conn.commit()
        raise
```

- [ ] **Step 4: Jalankan tes**

Run: `cd apps/downloader && uv run pytest tests/ -v`
Expected: PASS, seluruh tes worker lulus termasuk lima tes ingest.

- [ ] **Step 5: Commit**

```bash
git add apps/downloader
git commit -m "feat(worker): ingest handler with cross-user source deduplication"
```

---

## Task 11: Aplikasi web — auth dan pembuatan proyek

**Files:**
- Create: `apps/web/package.json`, `apps/web/next.config.ts`, `apps/web/app/layout.tsx`, `apps/web/app/page.tsx`, `apps/web/app/auth/callback/route.ts`, `apps/web/lib/supabase/server.ts`, `apps/web/lib/supabase/client.ts`, `apps/web/lib/errorMessages.ts`, `apps/web/app/api/projects/route.ts`, `apps/web/components/UrlForm.tsx`
- Test: `apps/web/test/errorMessages.test.ts`, `apps/web/test/createProject.test.ts`

**Interfaces:**
- Consumes: `normalizeSourceUrl`, `UnsupportedUrlError`, `ErrorCode` dari `@klipmatic/shared`; skema dari `@klipmatic/db`
- Produces:
  - `function messageFor(code: ErrorCode): string`
  - `POST /api/projects` menerima `{ url: string }`, mengembalikan `{ projectId: string, jobId: string }` atau `{ error: { code, message } }`
  - `async function createProjectFromUrl(db, userId, rawUrl): Promise<{ projectId, jobId }>`

- [ ] **Step 1: Buat aplikasi Next.js**

`apps/web/package.json`:
```json
{
  "name": "@klipmatic/web",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@klipmatic/db": "workspace:*",
    "@klipmatic/shared": "workspace:*",
    "@supabase/ssr": "^0.5.2",
    "@supabase/supabase-js": "^2.47.0",
    "next": "^15.1.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "typescript": "^5.7.0"
  }
}
```

`apps/web/next.config.ts`:
```ts
import type { NextConfig } from 'next'

const config: NextConfig = {
  transpilePackages: ['@klipmatic/shared', '@klipmatic/db'],
}

export default config
```

- [ ] **Step 2: Tulis tes yang gagal**

`apps/web/test/errorMessages.test.ts`:
```ts
import { expect, test } from 'vitest'
import { ERROR_CODES } from '@klipmatic/shared'
import { messageFor } from '../lib/errorMessages'

test('setiap kode error punya kalimat Indonesia', () => {
  for (const code of ERROR_CODES) {
    const msg = messageFor(code)
    expect(msg.length).toBeGreaterThan(10)
    expect(msg).not.toBe(code)
  }
})

test('kode tak dikenal jatuh ke pesan umum, bukan melempar', () => {
  expect(messageFor('KODE_ASING' as never)).toContain('kesalahan')
})

test('pesan tidak membocorkan detail teknis', () => {
  for (const code of ERROR_CODES) {
    const msg = messageFor(code)
    expect(msg).not.toMatch(/stderr|traceback|yt-dlp|ffmpeg|null|undefined/i)
  }
})
```

`apps/web/test/createProject.test.ts`:
```ts
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
afterAll(async () => { await sql.end() })

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
```

- [ ] **Step 3: Jalankan tes untuk memastikan gagal**

Run: `bun run test apps/web`
Expected: FAIL — `lib/errorMessages` dan `lib/createProject` belum ada.

- [ ] **Step 4: Implementasikan pemetaan pesan error**

`apps/web/lib/errorMessages.ts`:
```ts
import type { ErrorCode } from '@klipmatic/shared'

const MESSAGES: Record<ErrorCode, string> = {
  SOURCE_UNSUPPORTED:
    'Link ini belum didukung. Coba tempel link YouTube, TikTok, atau Google Drive yang lengkap.',
  SOURCE_BLOCKED:
    'Platform sedang memblokir permintaan kami. Coba lagi beberapa menit lagi.',
  SOURCE_UNAVAILABLE:
    'Video tidak dapat diakses. Pastikan videonya masih ada dan tidak disetel privat.',
  SOURCE_GEOBLOCKED:
    'Video ini dibatasi untuk wilayah tertentu sehingga tidak bisa kami proses.',
  SOURCE_AGE_RESTRICTED:
    'Video ini punya batasan usia dan tidak bisa kami proses.',
  SOURCE_TOO_LONG:
    'Durasi video melebihi batas maksimum 4 jam.',
  TRANSCRIBE_FAILED:
    'Transkripsi gagal. Kami sedang mencoba ulang secara otomatis.',
  BYOK_INVALID:
    'API key kamu ditolak provider. Periksa kembali di halaman Pengaturan.',
  LLM_BAD_OUTPUT:
    'AI memberi jawaban yang tidak bisa kami baca. Coba pilih model lain di Pengaturan.',
  WORKER_LOST:
    'Proses sempat terputus dan sedang dijalankan ulang.',
  INTERNAL:
    'Terjadi kesalahan di sistem kami. Tim kami sudah diberi tahu.',
}

const FALLBACK = 'Terjadi kesalahan yang tidak dikenali. Coba lagi beberapa saat lagi.'

export function messageFor(code: ErrorCode): string {
  return MESSAGES[code] ?? FALLBACK
}
```

- [ ] **Step 5: Implementasikan pembuatan proyek**

`apps/web/lib/createProject.ts`:
```ts
import type { Sql } from 'postgres'
import { normalizeSourceUrl } from '@klipmatic/shared'

export interface CreateProjectResult {
  projectId: string
  jobId: string
}

/**
 * Sumber selalu dibuat privat terlebih dahulu. Promosi menjadi publik hanya
 * dilakukan handler ingest setelah yt-dlp memastikan `availability == 'public'`.
 * Urutan ini mencegah video unlisted ikut masuk cache global.
 */
export async function createProjectFromUrl(
  sql: Sql,
  userId: string,
  rawUrl: string,
): Promise<CreateProjectResult> {
  const norm = normalizeSourceUrl(rawUrl) // melempar UnsupportedUrlError

  return sql.begin(async (tx) => {
    const [source] = await tx`
      insert into sources (kind, external_id, is_public, owner_user_id, url_original, status)
      values (${norm.kind}, ${norm.externalId}, false, ${userId}, ${norm.urlOriginal}, 'pending')
      on conflict (kind, external_id, owner_user_id) where not is_public
      do update set updated_at = now()
      returning id
    `
    const sourceId = source!.id as string

    const [project] = await tx`
      insert into projects (user_id, source_id, title)
      values (${userId}, ${sourceId}, ${norm.urlOriginal})
      returning id
    `
    const projectId = project!.id as string

    const [job] = await tx`
      insert into jobs (type, payload, user_id, project_id)
      values ('ingest',
              ${JSON.stringify({ source_id: sourceId, project_id: projectId })}::jsonb,
              ${userId}, ${projectId})
      returning id
    `
    return { projectId, jobId: job!.id as string }
  })
}
```

- [ ] **Step 6: Buat klien Supabase dan route API**

`apps/web/lib/supabase/server.ts`:
```ts
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function supabaseServer() {
  const store = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll: (list) => list.forEach((c) => store.set(c.name, c.value, c.options)),
      },
    },
  )
}
```

`apps/web/lib/supabase/client.ts`:
```ts
import { createBrowserClient } from '@supabase/ssr'

export function supabaseBrowser() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
}
```

`apps/web/app/api/projects/route.ts`:
```ts
import { NextResponse } from 'next/server'
import postgres from 'postgres'
import { UnsupportedUrlError } from '@klipmatic/shared'
import { createProjectFromUrl } from '@/lib/createProject'
import { messageFor } from '@/lib/errorMessages'
import { supabaseServer } from '@/lib/supabase/server'

const sql = postgres(process.env.DATABASE_URL!, { max: 5, prepare: false })

export async function POST(req: Request) {
  const supabase = await supabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Silakan masuk dulu.' } }, { status: 401 })
  }

  let url: unknown
  try {
    ({ url } = await req.json())
  } catch {
    url = null
  }
  if (typeof url !== 'string' || !url.trim()) {
    return NextResponse.json(
      { error: { code: 'SOURCE_UNSUPPORTED', message: messageFor('SOURCE_UNSUPPORTED') } },
      { status: 400 },
    )
  }

  try {
    const result = await createProjectFromUrl(sql, user.id, url)
    return NextResponse.json(result, { status: 201 })
  } catch (e) {
    if (e instanceof UnsupportedUrlError) {
      return NextResponse.json(
        { error: { code: e.code, message: messageFor(e.code) } },
        { status: 400 },
      )
    }
    console.error('gagal membuat proyek', e)
    return NextResponse.json(
      { error: { code: 'INTERNAL', message: messageFor('INTERNAL') } },
      { status: 500 },
    )
  }
}
```

`apps/web/app/auth/callback/route.ts`:
```ts
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  if (code) {
    const supabase = await supabaseServer()
    await supabase.auth.exchangeCodeForSession(code)
  }
  return NextResponse.redirect(new URL('/', url.origin))
}
```

- [ ] **Step 7: Jalankan tes**

Run: `bun run test apps/web`
Expected: PASS, tujuh tes lulus.

- [ ] **Step 8: Commit**

```bash
git add apps/web
git commit -m "feat(web): supabase auth, project creation API, indonesian error messages"
```

---

## Task 12: Progress live dan halaman proyek

Deliverable akhir P0. Setelah task ini, seluruh alur dapat didemokan dari browser.

**Files:**
- Create: `apps/web/components/UrlForm.tsx`, `apps/web/components/JobProgress.tsx`, `apps/web/app/page.tsx`, `apps/web/app/layout.tsx`, `apps/web/app/projects/[id]/page.tsx`
- Create: `packages/db/sql/910_realtime.sql`
- Test: `apps/web/test/jobProgress.test.ts`

**Interfaces:**
- Consumes: `supabaseBrowser()`, `messageFor()`, `POST /api/projects`
- Produces: komponen React `<UrlForm />` dan `<JobProgress jobId={...} />`

- [ ] **Step 1: Aktifkan Realtime untuk tabel jobs**

`packages/db/sql/910_realtime.sql`:
```sql
-- Supabase Realtime hanya menyiarkan tabel yang terdaftar di publikasi ini.
-- Policy jobs_self memastikan tiap user hanya menerima job miliknya sendiri.
alter publication supabase_realtime add table jobs;

-- Diperlukan agar payload UPDATE memuat nilai kolom, bukan hanya primary key.
alter table jobs replica identity full;
```

- [ ] **Step 2: Tulis tes yang gagal**

`apps/web/test/jobProgress.test.ts`:
```ts
import { describe, expect, test } from 'vitest'
import { progressLabel } from '../components/jobProgressLabel'

describe('progressLabel', () => {
  test('antre', () => {
    expect(progressLabel({ status: 'queued', progress: 0, errorCode: null }))
      .toBe('Menunggu giliran...')
  })

  test('berjalan menampilkan persentase', () => {
    expect(progressLabel({ status: 'running', progress: 42, errorCode: null }))
      .toBe('Memproses... 42%')
  })

  test('selesai', () => {
    expect(progressLabel({ status: 'done', progress: 100, errorCode: null }))
      .toBe('Selesai')
  })

  test('gagal menampilkan pesan Indonesia, bukan kode', () => {
    const label = progressLabel({ status: 'failed', progress: 30, errorCode: 'SOURCE_GEOBLOCKED' })
    expect(label).toContain('wilayah tertentu')
    expect(label).not.toContain('SOURCE_GEOBLOCKED')
  })

  test('dead diperlakukan seperti gagal', () => {
    const label = progressLabel({ status: 'dead', progress: 10, errorCode: 'TRANSCRIBE_FAILED' })
    expect(label).not.toContain('TRANSCRIBE_FAILED')
    expect(label.length).toBeGreaterThan(10)
  })

  test('gagal tanpa kode tetap memberi kalimat yang bisa dibaca', () => {
    expect(progressLabel({ status: 'failed', progress: 0, errorCode: null }).length)
      .toBeGreaterThan(10)
  })
})
```

- [ ] **Step 3: Jalankan tes untuk memastikan gagal**

Run: `bun run test apps/web/test/jobProgress.test.ts`
Expected: FAIL — `components/jobProgressLabel` belum ada.

- [ ] **Step 4: Implementasikan label progress**

Logika label dipisahkan dari komponen agar dapat diuji tanpa merender React maupun menyambung Realtime.

`apps/web/components/jobProgressLabel.ts`:
```ts
import type { ErrorCode } from '@klipmatic/shared'
import { messageFor } from '@/lib/errorMessages'

export interface JobState {
  status: 'queued' | 'running' | 'done' | 'failed' | 'dead'
  progress: number
  errorCode: string | null
}

export function progressLabel(job: JobState): string {
  switch (job.status) {
    case 'queued':
      return 'Menunggu giliran...'
    case 'running':
      return `Memproses... ${job.progress}%`
    case 'done':
      return 'Selesai'
    case 'failed':
    case 'dead':
      return messageFor((job.errorCode ?? 'INTERNAL') as ErrorCode)
  }
}
```

- [ ] **Step 5: Implementasikan komponen dan halaman**

`apps/web/components/JobProgress.tsx`:
```tsx
'use client'

import { useEffect, useState } from 'react'
import { supabaseBrowser } from '@/lib/supabase/client'
import { type JobState, progressLabel } from './jobProgressLabel'

export function JobProgress({ jobId }: { jobId: string }) {
  const [job, setJob] = useState<JobState | null>(null)

  useEffect(() => {
    const supabase = supabaseBrowser()

    supabase
      .from('jobs')
      .select('status, progress, error_code')
      .eq('id', jobId)
      .single()
      .then(({ data }) => {
        if (data) {
          setJob({ status: data.status, progress: data.progress, errorCode: data.error_code })
        }
      })

    const channel = supabase
      .channel(`job:${jobId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'jobs', filter: `id=eq.${jobId}` },
        (payload) => {
          const row = payload.new as { status: JobState['status']; progress: number; error_code: string | null }
          setJob({ status: row.status, progress: row.progress, errorCode: row.error_code })
        },
      )
      .subscribe()

    return () => { void supabase.removeChannel(channel) }
  }, [jobId])

  if (!job) return <p>Memuat status...</p>

  const failed = job.status === 'failed' || job.status === 'dead'
  return (
    <div>
      <p role="status">{progressLabel(job)}</p>
      {!failed && (
        <progress value={job.progress} max={100}>
          {job.progress}%
        </progress>
      )}
    </div>
  )
}
```

`apps/web/components/UrlForm.tsx`:
```tsx
'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

export function UrlForm() {
  const router = useRouter()
  const [url, setUrl] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url }),
    })
    const body = await res.json()
    setBusy(false)
    if (!res.ok) {
      setError(body.error?.message ?? 'Terjadi kesalahan.')
      return
    }
    router.push(`/projects/${body.projectId}?job=${body.jobId}`)
  }

  return (
    <form onSubmit={submit}>
      <label htmlFor="url">Tempel link video</label>
      <input
        id="url"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://youtube.com/watch?v=..."
        required
      />
      <button type="submit" disabled={busy}>
        {busy ? 'Memproses...' : 'Mulai'}
      </button>
      {error && <p role="alert">{error}</p>}
    </form>
  )
}
```

`apps/web/app/layout.tsx`:
```tsx
export const metadata = { title: 'Klipmatic' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  )
}
```

`apps/web/app/page.tsx`:
```tsx
import { UrlForm } from '@/components/UrlForm'

export default function Home() {
  return (
    <main>
      <h1>Klipmatic</h1>
      <p>Ubah video panjang jadi klip pendek siap unggah.</p>
      <UrlForm />
    </main>
  )
}
```

`apps/web/app/projects/[id]/page.tsx`:
```tsx
import { JobProgress } from '@/components/JobProgress'

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ job?: string }>
}) {
  const { id } = await params
  const { job } = await searchParams

  return (
    <main>
      <h1>Proyek</h1>
      <p>ID: {id}</p>
      {job ? <JobProgress jobId={job} /> : <p>Tidak ada job aktif.</p>}
    </main>
  )
}
```

- [ ] **Step 6: Jalankan seluruh tes**

Run: `bun run test`
Expected: PASS di seluruh workspace.

Run: `cd apps/downloader && uv run pytest -v`
Expected: PASS.

- [ ] **Step 7: Verifikasi manual end-to-end**

1. Jalankan `bun run db:up`
2. Terapkan migrasi, `000_auth_shim.sql` (hanya lokal), `900_rls.sql`, dan `910_realtime.sql`
3. Jalankan `bun run dev` untuk web dan `cd apps/downloader && uv run python -m app.worker` untuk worker
4. Masuk lewat Google, tempel URL YouTube pendek yang publik
5. Amati progress bergerak dari 5% ke 100% tanpa me-refresh halaman
6. Konfirmasi berkas `audio/<sha256>.opus` muncul di konsol MinIO
7. Tempel URL yang sama dari akun kedua — progress harus langsung 100% dan tidak ada unduhan baru

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(web): live job progress via supabase realtime and project page"
```

---

## Definition of Done — P0

- [ ] `bun run test` lulus di seluruh workspace
- [ ] `cd apps/downloader && uv run pytest` lulus
- [ ] Tes concurrency membuktikan tidak ada job diproses dua kali
- [ ] Tes RLS membuktikan sumber privat user A tidak terbaca user B, sekaligus sumber publik tetap terbaca keduanya
- [ ] Verifikasi manual Task 12 Step 7 berhasil, termasuk cache hit oleh user kedua
- [ ] Tidak ada nilai plaintext API key yang muncul di log mana pun
