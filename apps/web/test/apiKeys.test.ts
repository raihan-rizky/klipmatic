import { afterAll, beforeAll, expect, test, vi } from 'vitest'
import type postgres from 'postgres'
import { openApiKey } from '../../../packages/db/src/crypto'
import { freshDb, makeUser } from '../../../packages/db/test/helpers'
import {
  PRESETS,
  PROVIDERS,
  deleteApiKey,
  listApiKeys,
  saveApiKey,
} from '../lib/apiKeys'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import RootLayout from '../app/layout'
import { applyPreset, applyProvider, requestDeleteKey } from '../lib/apiKeyForm'
import { describeError } from '../lib/errorLog'
import { formatWaktu } from '../lib/format'

/**
 * Route handler diuji lewat pemanggilan langsung. Dua ketergantungannya —
 * koneksi bersama dan sesi Supabase — diganti stub agar handler berjalan di
 * atas database tes yang sama dengan tes lib di berkas ini.
 */
const stub = vi.hoisted(() => ({
  sql: null as unknown as postgres.Sql,
  userId: null as string | null,
}))

vi.mock('@/lib/db', () => ({
  get sql() {
    return stub.sql
  },
}))

vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: async () => ({
    auth: {
      getUser: async () => ({ data: { user: stub.userId ? { id: stub.userId } : null } }),
    },
  }),
}))

const { GET, POST } = await import('../app/api/keys/route')
const { DELETE } = await import('../app/api/keys/[id]/route')

const MASTER = Buffer.alloc(32, 7).toString('base64')
let sql: postgres.Sql
let alice: string
let bob: string

beforeAll(async () => {
  sql = await freshDb()
  alice = await makeUser(sql, 'alice@test.id')
  bob = await makeUser(sql, 'bob@test.id')
  stub.sql = sql
  stub.userId = alice
  process.env.BYOK_MASTER_KEY = MASTER
})
afterAll(async () => {
  await sql.end()
})

function postKeys(body: unknown) {
  return POST(
    new Request('http://localhost/api/keys', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  )
}

function deleteKey(id: string) {
  return DELETE(new Request(`http://localhost/api/keys/${id}`, { method: 'DELETE' }), {
    params: Promise.resolve({ id }),
  })
}

const INPUT = {
  provider: 'openai_compat' as const,
  label: 'Groq saya',
  baseUrl: 'https://api.groq.com/openai/v1',
  model: 'llama-3.3-70b-versatile',
  secret: 'gsk_rahasia_sekali_123456',
}

test('menyimpan key dalam bentuk terenkripsi, bukan plaintext', async () => {
  const { id } = await saveApiKey(sql, alice, INPUT, MASTER)
  const [row] = await sql`
    select encrypted_key, key_iv, key_tag from api_keys where id = ${id}`
  expect(row!.encrypted_key).not.toContain('gsk_rahasia')
  expect(
    openApiKey(
      { encryptedKey: row!.encrypted_key, keyIv: row!.key_iv, keyTag: row!.key_tag },
      MASTER,
    ),
  ).toBe(INPUT.secret)
})

test('tidak ada kolom mana pun yang menyimpan plaintext', async () => {
  // Pemeriksaan menyeluruh: seluruh baris di-serialisasi, sehingga kolom baru
  // yang tidak sengaja menampung plaintext ikut tertangkap.
  const rows = await sql`select * from api_keys`
  expect(JSON.stringify(rows)).not.toContain(INPUT.secret)
})

test('daftar key tidak pernah memuat medan kredensial', async () => {
  const keys = await listApiKeys(sql, alice)
  expect(keys.length).toBeGreaterThan(0)
  const serialized = JSON.stringify(keys)
  expect(serialized).not.toContain('gsk_rahasia')
  expect(serialized).not.toContain(INPUT.secret)
  for (const k of keys) {
    expect(Object.keys(k)).toEqual(
      expect.arrayContaining(['id', 'provider', 'label', 'model']),
    )
    expect(Object.keys(k)).not.toContain('encryptedKey')
    expect(Object.keys(k)).not.toContain('secret')
    for (const field of Object.keys(k)) {
      expect(field).not.toMatch(/secret|encrypt|credential|iv$|tag$/i)
    }
  }
})

test('user hanya melihat key miliknya', async () => {
  await saveApiKey(sql, bob, { ...INPUT, label: 'punya bob' }, MASTER)
  const aliceKeys = await listApiKeys(sql, alice)
  expect(aliceKeys.every((k) => k.label !== 'punya bob')).toBe(true)

  const bobKeys = await listApiKeys(sql, bob)
  expect(bobKeys.every((k) => k.label !== 'Groq saya')).toBe(true)
})

test('openai_compat tanpa baseUrl ditolak', async () => {
  await expect(saveApiKey(sql, alice, { ...INPUT, baseUrl: '' }, MASTER)).rejects.toThrow(
    /base URL/i,
  )
})

test('openai_compat dengan baseUrl berisi spasi saja ditolak', async () => {
  await expect(saveApiKey(sql, alice, { ...INPUT, baseUrl: '   ' }, MASTER)).rejects.toThrow(
    /base URL/i,
  )
})

test('secret kosong ditolak', async () => {
  await expect(saveApiKey(sql, alice, { ...INPUT, secret: '' }, MASTER)).rejects.toThrow()
})

test('provider tidak dikenal ditolak', async () => {
  await expect(
    saveApiKey(sql, alice, { ...INPUT, provider: 'palsu' as never }, MASTER),
  ).rejects.toThrow(/provider/i)
})

test('pesan galat validasi tidak pernah membocorkan nilai key', async () => {
  const bocor = 'sk_super_rahasia_jangan_bocor'
  await expect(
    saveApiKey(sql, alice, { ...INPUT, secret: bocor, model: '' }, MASTER),
  ).rejects.toThrow(
    expect.objectContaining({ message: expect.not.stringContaining(bocor) }),
  )
})

test('menghapus key milik user lain tidak berpengaruh', async () => {
  const { id } = await saveApiKey(sql, alice, { ...INPUT, label: 'target' }, MASTER)
  expect(await deleteApiKey(sql, bob, id)).toBe(false)

  // Barisnya harus masih utuh setelah percobaan hapus lintas user.
  const stillThere = await sql`select id from api_keys where id = ${id}`
  expect(stillThere).toHaveLength(1)

  expect(await deleteApiKey(sql, alice, id)).toBe(true)
  const gone = await sql`select id from api_keys where id = ${id}`
  expect(gone).toHaveLength(0)
})

test('preset Sumopod memakai gateway OpenAI-compatible dengan model murah', () => {
  const sumopod = PRESETS.find((p) => p.id === 'sumopod')
  expect(sumopod).toBeDefined()
  expect(sumopod!.provider).toBe('openai_compat')
  expect(sumopod!.baseUrl).toBe('https://ai.sumopod.com/v1')
  expect(sumopod!.models).toContain('gpt-5-nano')
  expect(sumopod!.models.length).toBeGreaterThan(1)
})

test('setiap preset menunjuk provider yang dikenal dan bebas kredensial', () => {
  expect(PRESETS.length).toBeGreaterThan(1)
  for (const preset of PRESETS) {
    expect(PROVIDERS).toContain(preset.provider)
    expect(JSON.stringify(preset)).not.toMatch(/secret|apiKey/i)
    // Preset OpenAI-compatible tanpa base URL akan langsung ditolak validasi,
    // jadi presetnya sendiri wajib membawa base URL.
    if (preset.provider === 'openai_compat') {
      expect(preset.baseUrl.trim().length).toBeGreaterThan(0)
    }
  }
})

test('key gemini disimpan tanpa base URL walau permintaannya membawa satu', async () => {
  // Formulir menyembunyikan medan Base URL untuk gemini, jadi nilai yang ikut
  // terkirim selalu sisa preset sebelumnya. Bila tersimpan, worker mengirim
  // key Google plaintext ke host itu (llm.py: base = key.base_url or GEMINI_BASE).
  const { id } = await saveApiKey(
    sql,
    alice,
    {
      provider: 'gemini',
      label: 'Gemini saya',
      baseUrl: 'https://ai.sumopod.com/v1',
      model: 'gemini-2.5-flash',
      secret: 'AIza_rahasia_gemini',
    },
    MASTER,
  )
  const [row] = await sql`select base_url from api_keys where id = ${id}`
  expect(row!.base_url).toBeNull()

  const saved = (await listApiKeys(sql, alice)).find((k) => k.id === id)
  expect(saved!.baseUrl).toBeNull()
})

test('id bukan UUID dijawab seperti key tidak ada, bukan melempar galat driver', async () => {
  await expect(deleteApiKey(sql, alice, 'bukan-uuid')).resolves.toBe(false)
  await expect(deleteApiKey(sql, alice, '')).resolves.toBe(false)
})

test('preset bebas: pengguna boleh mengisi base URL dan model sendiri', async () => {
  const { id } = await saveApiKey(
    sql,
    alice,
    {
      provider: 'openai_compat',
      label: 'Gateway sendiri',
      baseUrl: 'https://gateway.saya.id/v1',
      model: 'model-khusus-saya',
      secret: 'sk_custom_123',
    },
    MASTER,
  )
  const keys = await listApiKeys(sql, alice)
  const saved = keys.find((k) => k.id === id)
  expect(saved).toMatchObject({
    baseUrl: 'https://gateway.saya.id/v1',
    model: 'model-khusus-saya',
  })
})

// --- transisi medan formulir -------------------------------------------------

const FORM_SUMOPOD = {
  label: 'Sumopod AI',
  baseUrl: 'https://ai.sumopod.com/v1',
  model: 'gpt-5-nano',
  secret: 'sk_diketik_pengguna',
}

test('memilih jenis API gemini mengosongkan base URL yang medannya disembunyikan', () => {
  const after = applyProvider(FORM_SUMOPOD, 'gemini')
  expect(after.baseUrl).toBe('')
  // Medan lain tidak boleh ikut hilang: pengguna sudah mengetik key-nya.
  expect(after.secret).toBe('sk_diketik_pengguna')
  expect(after.model).toBe('gpt-5-nano')
})

test('memilih jenis API non-gemini mempertahankan base URL yang terlihat', () => {
  expect(applyProvider(FORM_SUMOPOD, 'anthropic_compat').baseUrl).toBe(
    'https://ai.sumopod.com/v1',
  )
  expect(applyProvider(FORM_SUMOPOD, 'openai_compat').baseUrl).toBe(
    'https://ai.sumopod.com/v1',
  )
})

test('berpindah preset mengganti label bawaan preset sebelumnya', () => {
  const gemini = PRESETS.find((p) => p.id === 'gemini')!
  const after = applyPreset(FORM_SUMOPOD, gemini)
  expect(after.label).toBe('Google Gemini')
  expect(after.baseUrl).toBe(gemini.baseUrl)
  expect(after.model).toBe(gemini.models[0])
})

test('berpindah preset tidak menimpa label yang diketik pengguna', () => {
  const gemini = PRESETS.find((p) => p.id === 'gemini')!
  const after = applyPreset({ ...FORM_SUMOPOD, label: 'Key kantor' }, gemini)
  expect(after.label).toBe('Key kantor')
})

test('penghapusan yang ditolak server memunculkan pesannya, bukan senyap', async () => {
  const fake = (async () =>
    new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Key tidak ditemukan.' } }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch
  await expect(requestDeleteKey('abc', fake)).resolves.toEqual({
    ok: false,
    message: 'Key tidak ditemukan.',
  })
})

test('penghapusan gagal tanpa body JSON tetap memberi pesan', async () => {
  const fake = (async () => new Response('<html>500</html>', { status: 500 })) as unknown as typeof fetch
  const hasil = await requestDeleteKey('abc', fake)
  expect(hasil.ok).toBe(false)
  expect(hasil.message).toMatch(/gagal/i)
})

test('penghapusan sukses tidak memunculkan pesan galat', async () => {
  const fake = (async () =>
    new Response(JSON.stringify({ deleted: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch
  await expect(requestDeleteKey('abc', fake)).resolves.toEqual({ ok: true, message: null })
})

test('tata letak menyediakan tautan ke halaman pengaturan API key', () => {
  // messageFor('BYOK_INVALID') menyuruh pengguna memeriksa halaman Pengaturan;
  // tanpa tautan, satu-satunya jalan ke sana adalah mengetik URL.
  const html = renderToStaticMarkup(
    createElement(RootLayout, { children: createElement('p', null, 'isi') }),
  )
  expect(html).toContain('href="/settings/keys"')
})

// --- tampilan waktu ----------------------------------------------------------

test('waktu pemakaian ditampilkan dalam WIB dan format Indonesia', () => {
  const teks = formatWaktu('2026-07-27T00:16:34.316Z')
  // 00:16 UTC adalah 07.16 WIB; angka jam inilah bukti konversi zona terjadi.
  expect(teks).toMatch(/\b07[.:]16\b/)
  expect(teks).toContain('2026')
  expect(teks).not.toMatch(/\dT\d/)
  expect(teks).not.toContain('Invalid')
})

test('waktu rusak tidak memunculkan Invalid Date di halaman', () => {
  expect(formatWaktu('bukan-tanggal')).not.toContain('Invalid')
})

// --- ringkasan galat untuk log ----------------------------------------------

class GalatDriverPalsu extends Error {
  code = '22P02'
  query = 'insert into api_keys (user_id, provider, label) values ($1,$2,$3)'
  parameters = ['sk_rahasia_jangan_bocor']
}

test('ringkasan galat memuat kelas dan kode, tanpa query maupun parameter', () => {
  const ringkasan = describeError(
    new GalatDriverPalsu('invalid input syntax for type uuid: "bukan-uuid"'),
  )
  expect(ringkasan).toContain('GalatDriverPalsu')
  expect(ringkasan).toContain('22P02')
  expect(ringkasan).not.toContain('insert into')
  expect(ringkasan).not.toContain('sk_rahasia_jangan_bocor')
  expect(ringkasan).not.toContain('invalid input syntax')
})

test('ringkasan galat tanpa kode tetap menyebut kelasnya', () => {
  expect(describeError(new TypeError('x'))).toBe('TypeError')
  expect(describeError('teks polos')).toBe('string')
})

// --- route handler -----------------------------------------------------------

test('POST tanpa sesi dijawab 401 dengan bentuk galat proyek', async () => {
  stub.userId = null
  const res = await postKeys({ provider: 'gemini', model: 'm', secret: 's' })
  stub.userId = alice
  expect(res.status).toBe(401)
  expect(await res.json()).toEqual({
    error: { code: 'UNAUTHORIZED', message: expect.any(String) },
  })
})

test('POST valid menyimpan key dan menjawab 201', async () => {
  const res = await postKeys({
    provider: 'openai_compat',
    label: 'Lewat route',
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'llama-3.3-70b-versatile',
    secret: 'gsk_lewat_route_123',
  })
  expect(res.status).toBe(201)
  const body = (await res.json()) as { id: string }
  const [row] = await sql`select label, encrypted_key from api_keys where id = ${body.id}`
  expect(row!.label).toBe('Lewat route')
  expect(row!.encrypted_key).not.toContain('gsk_lewat_route')
})

test('POST gemini tidak menyimpan base URL sisa preset', async () => {
  const res = await postKeys({
    provider: 'gemini',
    label: 'Gemini lewat route',
    baseUrl: 'https://ai.sumopod.com/v1',
    model: 'gemini-2.5-flash',
    secret: 'AIza_lewat_route',
  })
  expect(res.status).toBe(201)
  const body = (await res.json()) as { id: string }
  const [row] = await sql`select base_url from api_keys where id = ${body.id}`
  expect(row!.base_url).toBeNull()
})

test('POST tidak valid dijawab 400 dengan pesan validasi, bukan 500', async () => {
  const res = await postKeys({
    provider: 'openai_compat',
    label: 'Tanpa base URL',
    baseUrl: '',
    model: 'apa-saja',
    secret: 'sk_apa_saja',
  })
  expect(res.status).toBe(400)
  const body = (await res.json()) as { error: { code: string; message: string } }
  expect(body.error.code).toBe('VALIDATION')
  expect(body.error.message).toMatch(/base URL/i)
  expect(body.error.message).not.toContain('sk_apa_saja')
})

test('POST dengan body bukan JSON dijawab 400, bukan lemparan tak tertangkap', async () => {
  const res = await postKeys('{bukan json')
  expect(res.status).toBe(400)
  expect((await res.json()) as { error: { code: string } }).toMatchObject({
    error: { code: 'VALIDATION' },
  })
})

test('kegagalan database dijawab 500 berbentuk galat proyek dan tercatat tanpa nilai key', async () => {
  const asli = stub.sql
  const meledak = (() => {
    throw new GalatDriverPalsu('relation "api_keys" does not exist')
  }) as unknown as postgres.Sql
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  stub.sql = meledak
  let res: Response
  try {
    res = await postKeys({
      provider: 'openai_compat',
      label: 'Gagal',
      baseUrl: 'https://api.groq.com/openai/v1',
      model: 'm',
      secret: 'sk_tidak_boleh_masuk_log',
    })
  } finally {
    stub.sql = asli
  }
  expect(res.status).toBe(500)
  expect((await res.json()) as { error: { code: string } }).toMatchObject({
    error: { code: 'INTERNAL' },
  })

  const tercatat = log.mock.calls.map((c) => c.map(String).join(' ')).join('\n')
  log.mockRestore()
  // Galat harus meninggalkan jejak yang bisa ditelusuri...
  expect(tercatat).toContain('22P02')
  expect(tercatat).toContain('GalatDriverPalsu')
  // ...tanpa membawa isi query maupun nilai yang dikirim pengguna.
  expect(tercatat).not.toContain('sk_tidak_boleh_masuk_log')
  expect(tercatat).not.toContain('insert into')
})

test('GET hanya mengembalikan key milik pemanggil, tanpa medan kredensial', async () => {
  const res = await GET()
  expect(res.status).toBe(200)
  const body = (await res.json()) as { keys: { label: string }[] }
  expect(body.keys.every((k) => k.label !== 'punya bob')).toBe(true)
  expect(JSON.stringify(body)).not.toMatch(/encrypted|key_iv|secret/i)
})

test('DELETE dengan id bukan UUID menjawab 404 berbentuk galat, bukan 500', async () => {
  const res = await deleteKey('bukan-uuid')
  expect(res.status).toBe(404)
  expect((await res.json()) as { error: { code: string } }).toMatchObject({
    error: { code: 'NOT_FOUND' },
  })
})

test('DELETE key milik user lain dijawab persis seperti key tak dikenal', async () => {
  const { id } = await saveApiKey(sql, bob, { ...INPUT, label: 'milik bob' }, MASTER)
  const asing = await deleteKey(id)
  const tidakAda = await deleteKey('00000000-0000-4000-8000-000000000000')
  expect(asing.status).toBe(404)
  expect(await asing.json()).toEqual(await tidakAda.json())

  const [masih] = await sql`select id from api_keys where id = ${id}`
  expect(masih).toBeDefined()
})

test('kegagalan database saat DELETE dijawab 500 berbentuk galat, bukan lemparan', async () => {
  const asli = stub.sql
  const meledak = (() => {
    throw new GalatDriverPalsu('connection terminated')
  }) as unknown as postgres.Sql
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  stub.sql = meledak
  let res: Response
  try {
    res = await deleteKey('00000000-0000-4000-8000-000000000001')
  } finally {
    stub.sql = asli
  }
  expect(res.status).toBe(500)
  expect((await res.json()) as { error: { code: string } }).toMatchObject({
    error: { code: 'INTERNAL' },
  })
  const tercatat = log.mock.calls.map((c) => c.map(String).join(' ')).join('\n')
  log.mockRestore()
  expect(tercatat).toContain('22P02')
  expect(tercatat).not.toContain('insert into')
})

test('DELETE key sendiri menghapus barisnya', async () => {
  const { id } = await saveApiKey(sql, alice, { ...INPUT, label: 'akan dihapus' }, MASTER)
  const res = await deleteKey(id)
  expect(res.status).toBe(200)
  const sisa = await sql`select id from api_keys where id = ${id}`
  expect(sisa).toHaveLength(0)
})
