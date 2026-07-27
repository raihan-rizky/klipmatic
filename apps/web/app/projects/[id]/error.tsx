'use client'

import { useEffect } from 'react'
import { messageFor } from '@/lib/errorMessages'

/**
 * Tanpa batas error di segmen ini, kegagalan apa pun saat memuat kandidat
 * (misalnya database tak terjangkau) muncul sebagai halaman error bawaan
 * framework: berbahasa Inggris, dan di mode dev ikut menampilkan teks SQL
 * beserta parameter yang terikat. Pesannya diseragamkan dengan route API.
 */
export default function ProjectError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Detail teknis hanya untuk log server/console, tidak pernah untuk layar.
    console.error('gagal memuat halaman proyek', error)
  }, [error])

  return (
    <main>
      <p role="alert">{messageFor('INTERNAL')}</p>
      <button type="button" onClick={reset}>
        Coba lagi
      </button>
    </main>
  )
}
