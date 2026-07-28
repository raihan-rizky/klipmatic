import { PRESETS, type Provider, type ProviderPreset } from './apiKeyConfig'

/** Medan formulir tambah API key. Sengaja terpisah dari state React agar
 * transisinya bisa diuji tanpa merender komponen. */
export interface ApiKeyFormFields {
  label: string
  baseUrl: string
  model: string
  secret: string
}

/**
 * Label dianggap masih bawaan selama isinya kosong atau persis nama salah satu
 * preset: itu berarti pengguna belum pernah mengetiknya sendiri, sehingga aman
 * ditimpa saat preset berganti.
 */
function labelMasihBawaan(label: string): boolean {
  const bersih = label.trim()
  return bersih === '' || PRESETS.some((p) => p.name === bersih)
}

export function applyPreset(
  fields: ApiKeyFormFields,
  preset: ProviderPreset,
): ApiKeyFormFields {
  return {
    ...fields,
    label: labelMasihBawaan(fields.label) ? preset.name : fields.label,
    baseUrl: preset.baseUrl,
    model: preset.models[0] ?? '',
  }
}

export function applyProvider(
  fields: ApiKeyFormFields,
  provider: Provider,
): ApiKeyFormFields {
  // Medan Base URL tidak ditampilkan untuk gemini, jadi isinya ikut dikosongkan.
  // Kalau tidak, sisa base URL preset sebelumnya tetap terkirim tanpa terlihat
  // dan key Google pengguna berakhir di host penyedia lain.
  if (provider === 'gemini') return { ...fields, baseUrl: '' }
  return fields
}

/**
 * Menghapus satu key lewat API dan menerjemahkan kegagalannya jadi kalimat
 * yang bisa ditampilkan. Response wajib dibaca: tanpa itu 401/404/500 hanya
 * terlihat sebagai baris yang muncul lagi setelah refresh.
 */
export async function requestDeleteKey(
  id: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; message: string | null }> {
  const res = await fetchImpl(`/api/keys/${encodeURIComponent(id)}`, { method: 'DELETE' })
  if (res.ok) return { ok: true, message: null }
  const body = (await res.json().catch(() => null)) as
    | { error?: { message?: unknown } }
    | null
  const pesan = body?.error?.message
  return { ok: false, message: typeof pesan === 'string' ? pesan : 'Gagal menghapus key.' }
}
