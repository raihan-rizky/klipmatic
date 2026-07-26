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
