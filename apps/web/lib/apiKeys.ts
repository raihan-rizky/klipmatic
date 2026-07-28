import type { Sql } from 'postgres'
import { sealApiKey } from '@cheapclipper/db'
import {
  PROVIDERS,
  type Provider,
} from './apiKeyConfig'

export { PRESETS, PROVIDERS, type Provider, type ProviderPreset } from './apiKeyConfig'

export interface ApiKeyInput {
  provider: Provider
  label: string
  baseUrl: string | null
  model: string
  secret: string
}

/** Bentuk yang aman dikirim ke browser. Sengaja tanpa medan kredensial. */
export interface PublicApiKey {
  id: string
  provider: Provider
  label: string
  baseUrl: string | null
  model: string
  lastUsedAt: string | null
}

/**
 * Galat validasi yang pesannya aman ditampilkan ke pengguna.
 *
 * Route handler hanya meneruskan pesan dari kelas ini. Galat lain — misalnya
 * dari driver postgres — dijawab dengan pesan umum, karena isinya bisa memuat
 * potongan query beserta parameternya.
 */
export class ApiKeyValidationError extends Error {}

export async function saveApiKey(
  sql: Sql,
  userId: string,
  input: ApiKeyInput,
  masterKey = process.env.BYOK_MASTER_KEY ?? '',
): Promise<{ id: string }> {
  if (!PROVIDERS.includes(input.provider)) {
    throw new ApiKeyValidationError(`Provider tidak dikenal: ${input.provider}`)
  }
  if (!input.secret) throw new ApiKeyValidationError('API key tidak boleh kosong')
  if (!input.model.trim()) throw new ApiKeyValidationError('Nama model wajib diisi')

  // Gemini selalu disimpan tanpa base URL (lihat spec §skema: "null untuk
  // 'gemini'"). Formulir menyembunyikan medannya untuk provider ini, sehingga
  // nilai yang ikut terkirim pasti sisa dari preset sebelumnya. Bila sisa itu
  // tersimpan, worker mengirim key Google milik pengguna ke host pihak ketiga.
  const baseUrl = input.provider === 'gemini' ? '' : (input.baseUrl?.trim() ?? '')
  if (input.provider === 'openai_compat' && !baseUrl) {
    throw new ApiKeyValidationError('Base URL wajib diisi untuk provider OpenAI-compatible')
  }
  if (baseUrl && !/^https?:\/\//i.test(baseUrl)) {
    throw new ApiKeyValidationError('Base URL harus diawali http:// atau https://')
  }
  // Dijaga di sini, bukan dibiarkan sampai ke sealApiKey: galat dari lapisan
  // kripto menyebut nama variabel lingkungan dan tidak jelas bagi pemanggil.
  if (!masterKey) throw new Error('Server belum dikonfigurasi untuk menyimpan API key')

  const sealed = sealApiKey(input.secret, masterKey)
  const [row] = await sql`
    insert into api_keys (user_id, provider, label, base_url, model,
                          encrypted_key, key_iv, key_tag)
    values (${userId}, ${input.provider}, ${input.label.trim() || 'Tanpa nama'},
            ${baseUrl || null}, ${input.model.trim()},
            ${sealed.encryptedKey}, ${sealed.keyIv}, ${sealed.keyTag})
    returning id
  `
  return { id: row!.id as string }
}

/**
 * Kolom dipilih satu per satu, bukan `select *`. Bentuk hasilnya ikut dikirim
 * ke browser, sehingga kolom kredensial tidak boleh sampai terbawa hanya
 * karena skema tabelnya bertambah.
 */
export async function listApiKeys(sql: Sql, userId: string): Promise<PublicApiKey[]> {
  const rows = await sql`
    select id, provider, label, base_url, model, last_used_at
      from api_keys where user_id = ${userId}
     order by created_at desc
  `
  return rows.map((r) => ({
    id: r.id as string,
    provider: r.provider as Provider,
    label: r.label as string,
    baseUrl: (r.base_url as string | null) ?? null,
    model: r.model as string,
    lastUsedAt: r.last_used_at ? new Date(r.last_used_at as string).toISOString() : null,
  }))
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function deleteApiKey(sql: Sql, userId: string, id: string): Promise<boolean> {
  // Id yang bukan UUID dijawab sama seperti key yang tidak ada. Tanpa ini
  // postgres melempar 22P02, dan galat itu membawa teks query beserta
  // parameternya ke log sekaligus mengubah 404 menjadi 500.
  if (!UUID_RE.test(id)) return false
  // Penyaringan user_id ikut di klausa delete, bukan dicek terpisah, agar
  // tidak ada celah antara pemeriksaan kepemilikan dan penghapusan.
  const rows = await sql`
    delete from api_keys where id = ${id} and user_id = ${userId} returning id`
  return rows.length > 0
}
