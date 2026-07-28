'use client'

import { useState } from 'react'
import { ArrowRight, LoaderCircle } from 'lucide-react'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

export function CreateClipButton({ candidateId }: { candidateId: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function create() {
    setBusy(true)
    setError(null)
    const response = await fetch('/api/clips', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ candidateId }),
    })
    const body = (await response.json().catch(() => ({}))) as {
      clipId?: string
      error?: { message?: string }
    }
    if (!response.ok || !body.clipId) {
      setBusy(false)
      setError(body.error?.message ?? 'Gagal membuka editor.')
      return
    }
    window.location.assign(`/clips/${body.clipId}`)
  }

  return (
    <div className="space-y-3">
      <Button type="button" onClick={create} disabled={busy} className="w-full">
        {busy ? (
          <>
            <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
            Menyiapkan editor…
          </>
        ) : (
          <>
            Edit klip
            <ArrowRight className="size-4" aria-hidden="true" />
          </>
        )}
      </Button>
      {error && (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      )}
    </div>
  )
}
