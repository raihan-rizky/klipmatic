'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { ArrowRight, LoaderCircle } from 'lucide-react'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

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
    <Card className="border-primary/20 bg-surface-raised/95 p-2 shadow-2xl shadow-black/30">
      <CardContent className="p-0">
        <form onSubmit={submit} className="flex flex-col gap-3">
          <label htmlFor="url" className="sr-only">
            Link video
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id="url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://youtube.com/watch?v=..."
              required
              className="min-h-14 flex-1 border-transparent bg-background px-5 text-base focus-visible:border-primary"
            />
            <Button type="submit" disabled={busy} className="min-h-14 shrink-0 px-6">
              {busy ? (
                <>
                  <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                  Menganalisis video…
                </>
              ) : (
                <>
                  Cari klip terbaik
                  <ArrowRight className="size-4" aria-hidden="true" />
                </>
              )}
            </Button>
          </div>
          {error && (
            <Alert tone="danger" role="alert" className="text-left">
              {error}
            </Alert>
          )}
        </form>
      </CardContent>
    </Card>
  )
}
