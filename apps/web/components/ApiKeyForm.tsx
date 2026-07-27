'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { PRESETS, PROVIDERS, type Provider } from '@/lib/apiKeys'
import { applyPreset, applyProvider, requestDeleteKey } from '@/lib/apiKeyForm'

const PROVIDER_LABELS: Record<Provider, string> = {
  gemini: 'Google Gemini',
  openai_compat: 'OpenAI-compatible (Sumopod, OpenRouter, Groq, Ollama, ...)',
  anthropic_compat: 'Anthropic-compatible',
}

const CUSTOM = 'custom'

export function ApiKeyForm() {
  const router = useRouter()
  const [presetId, setPresetId] = useState<string>(PRESETS[0]!.id)
  const [provider, setProvider] = useState<Provider>(PRESETS[0]!.provider)
  const [form, setForm] = useState({
    label: PRESETS[0]!.name,
    baseUrl: PRESETS[0]!.baseUrl,
    model: PRESETS[0]!.models[0] ?? '',
    secret: '',
  })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const preset = PRESETS.find((p) => p.id === presetId)

  // Preset hanya mengisi awal formulir. Setiap medan tetap bisa disunting,
  // termasuk model, karena daftar model penyedia berubah lebih cepat daripada
  // rilis aplikasi ini.
  function pilihPreset(id: string) {
    setPresetId(id)
    const chosen = PRESETS.find((p) => p.id === id)
    if (!chosen) return
    setProvider(chosen.provider)
    setForm((f) => applyPreset(f, chosen))
  }

  function pilihProvider(next: Provider) {
    setProvider(next)
    setPresetId(CUSTOM)
    setForm((f) => applyProvider(f, next))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const res = await fetch('/api/keys', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider, ...form }),
    })
    const body = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) {
      setError(body.error?.message ?? 'Gagal menyimpan.')
      return
    }
    setForm({ label: '', baseUrl: form.baseUrl, model: form.model, secret: '' })
    router.refresh()
  }

  return (
    <form onSubmit={submit}>
      <label htmlFor="preset">Penyedia siap pakai</label>
      <select id="preset" value={presetId} onChange={(e) => pilihPreset(e.target.value)}>
        {PRESETS.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
        <option value={CUSTOM}>Lainnya (isi manual)</option>
      </select>
      {preset && <p>{preset.hint}</p>}

      <label htmlFor="provider">Jenis API</label>
      <select
        id="provider"
        value={provider}
        onChange={(e) => pilihProvider(e.target.value as Provider)}
      >
        {PROVIDERS.map((p) => (
          <option key={p} value={p}>
            {PROVIDER_LABELS[p]}
          </option>
        ))}
      </select>

      <label htmlFor="label">Nama pengenal</label>
      <input
        id="label"
        value={form.label}
        required
        placeholder="Sumopod saya"
        onChange={(e) => setForm({ ...form, label: e.target.value })}
      />

      {provider !== 'gemini' && (
        <>
          <label htmlFor="baseUrl">
            Base URL {provider === 'openai_compat' ? '(wajib)' : '(opsional)'}
          </label>
          <input
            id="baseUrl"
            value={form.baseUrl}
            required={provider === 'openai_compat'}
            placeholder="https://ai.sumopod.com/v1"
            onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
          />
        </>
      )}

      <label htmlFor="model">Nama model</label>
      <input
        id="model"
        value={form.model}
        required
        list="model-suggestions"
        placeholder="gpt-5-nano"
        onChange={(e) => setForm({ ...form, model: e.target.value })}
      />
      <datalist id="model-suggestions">
        {(preset?.models ?? PRESETS.flatMap((p) => p.models)).map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>

      <label htmlFor="secret">API key</label>
      <input
        id="secret"
        type="password"
        value={form.secret}
        required
        autoComplete="off"
        onChange={(e) => setForm({ ...form, secret: e.target.value })}
      />
      <p>Key disimpan terenkripsi dan tidak pernah ditampilkan kembali.</p>

      <button type="submit" disabled={busy}>
        {busy ? 'Menyimpan...' : 'Simpan'}
      </button>
      {error && <p role="alert">{error}</p>}
    </form>
  )
}

export function DeleteApiKeyButton({ id, label }: { id: string; label: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function remove() {
    // Key tidak pernah bisa dipulihkan: plaintext-nya tidak disimpan, jadi
    // sekali terhapus pengguna harus membuat key baru di penyedia.
    if (!window.confirm(`Hapus key "${label}"? Key tidak bisa dikembalikan.`)) return
    setBusy(true)
    setError(null)
    const hasil = await requestDeleteKey(id)
    setBusy(false)
    if (!hasil.ok) {
      setError(hasil.message)
      return
    }
    router.refresh()
  }

  return (
    <>
      <button type="button" onClick={remove} disabled={busy} aria-label={`Hapus key ${label}`}>
        {busy ? 'Menghapus...' : 'Hapus'}
      </button>
      {error && <span role="alert">{error}</span>}
    </>
  )
}
