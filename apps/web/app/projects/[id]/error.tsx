'use client'

import { useEffect } from 'react'
import { StatePanel } from '@/components/StatePanel'
import { Button } from '@/components/ui/button'
import { messageFor } from '@/lib/errorMessages'

export default function ProjectError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('gagal memuat halaman proyek', error)
  }, [error])

  return (
    <section className="grid min-h-[calc(100vh-12rem)] place-items-center">
      <StatePanel
        tone="danger"
        title="Project belum bisa dimuat"
        description={messageFor('INTERNAL')}
        action={
          <Button type="button" variant="secondary" onClick={reset}>
            Coba lagi
          </Button>
        }
      />
    </section>
  )
}
