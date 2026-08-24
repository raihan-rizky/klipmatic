'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { KeyRound, LoaderCircle, LockKeyhole, ServerCog } from 'lucide-react'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { PRESETS, PROVIDERS, type Provider } from '@/lib/apiKeyConfig'
import { applyPreset, applyProvider } from '@/lib/apiKeyForm'

const PROVIDER_LABELS: Record<Provider, string> = {
  gemini: 'Google Gemini (legacy)',
  openai_compat: 'OpenAI-compatible',
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

  const preset = PRESETS.find((item) => item.id === presetId)

  function pilihPreset(id: string) {
    setPresetId(id)
    const chosen = PRESETS.find((item) => item.id === id)
    if (!chosen) return
    setProvider(chosen.provider)
    setForm((current) => applyPreset(current, chosen))
  }

  function pilihProvider(next: Provider) {
    setProvider(next)
    setPresetId(CUSTOM)
    setForm((current) => applyProvider(current, next))
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    const response = await fetch('/api/keys', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider, ...form }),
    })
    const body = await response.json().catch(() => ({}))
    setBusy(false)
    if (!response.ok) {
      setError(body.error?.message ?? 'Gagal menyimpan.')
      return
    }
    setForm({ label: '', baseUrl: form.baseUrl, model: form.model, secret: '' })
    router.refresh()
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Card>
        <CardContent className="pt-5 sm:pt-6">
          <div className="mb-5 flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <ServerCog className="size-5" aria-hidden="true" />
            </span>
            <div>
              <h3 className="font-black tracking-normal">Pilih penyedia</h3>
              <p className="mt-1 text-sm leading-6 text-muted">
                Mulai dari preset atau isi endpoint kompatibel secara manual.
              </p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label htmlFor="preset" className="text-sm font-bold">Penyedia siap pakai</label>
              <Select value={presetId} onValueChange={pilihPreset}>
                <SelectTrigger id="preset"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PRESETS.map((item) => (
                    <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
                  ))}
                  <SelectItem value={CUSTOM}>Lainnya (isi manual)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label htmlFor="provider" className="text-sm font-bold">Jenis API</label>
              <Select value={provider} onValueChange={(value) => pilihProvider(value as Provider)}>
                <SelectTrigger id="provider"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PROVIDERS.map((item) => (
                    <SelectItem key={item} value={item}>{PROVIDER_LABELS[item]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {preset && (
            <Alert className="mt-4">
              {preset.hint}
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-5 sm:pt-6">
          <div className="mb-5 flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <LockKeyhole className="size-5" aria-hidden="true" />
            </span>
            <div>
              <h3 className="font-black tracking-normal">Detail kredensial</h3>
              <p className="mt-1 text-sm leading-6 text-muted">
                Secret dienkripsi sebelum disimpan dan tidak pernah ditampilkan lagi.
              </p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label htmlFor="label" className="text-sm font-bold">Nama pengenal</label>
              <Input
                id="label"
                value={form.label}
                required
                placeholder="Sumopod saya"
                onChange={(event) => setForm({ ...form, label: event.target.value })}
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="model" className="text-sm font-bold">Nama model</label>
              <Input
                id="model"
                value={form.model}
                required
                list="model-suggestions"
                placeholder="gpt-5-nano"
                onChange={(event) => setForm({ ...form, model: event.target.value })}
              />
              <datalist id="model-suggestions">
                {(preset?.models ?? PRESETS.flatMap((item) => item.models)).map((model) => (
                  <option key={model} value={model} />
                ))}
              </datalist>
            </div>

            {provider !== 'gemini' && (
              <div className="space-y-2 sm:col-span-2">
                <label htmlFor="baseUrl" className="text-sm font-bold">
                  Base URL {provider === 'openai_compat' ? '(wajib)' : '(opsional)'}
                </label>
                <Input
                  id="baseUrl"
                  type="url"
                  value={form.baseUrl}
                  required={provider === 'openai_compat'}
                  placeholder="https://ai.sumopod.com/v1"
                  onChange={(event) => setForm({ ...form, baseUrl: event.target.value })}
                />
              </div>
            )}

            <div className="space-y-2 sm:col-span-2">
              <label htmlFor="secret" className="text-sm font-bold">API key</label>
              <Input
                id="secret"
                type="password"
                value={form.secret}
                required
                autoComplete="off"
                placeholder="Masukkan secret key"
                onChange={(event) => setForm({ ...form, secret: event.target.value })}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-end">
        {error && (
          <Alert tone="danger" role="alert" className="sm:mr-auto">
            {error}
          </Alert>
        )}
        <Button type="submit" disabled={busy}>
          {busy ? (
            <>
              <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
              Menyimpan…
            </>
          ) : (
            <>
              <KeyRound className="size-4" aria-hidden="true" />
              Simpan API key
            </>
          )}
        </Button>
      </div>
    </form>
  )
}
