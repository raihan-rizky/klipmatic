'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { StatePanel } from '@/components/StatePanel'
import { Button } from '@/components/ui/button'
import { supabaseBrowser } from '@/lib/supabase/client'

type CallbackState = 'loading' | 'failed'

export default function ImplicitAuthPage() {
  const [state, setState] = useState<CallbackState>('loading')

  useEffect(() => {
    let active = true

    async function finishLogin() {
      const hash = new URLSearchParams(window.location.hash.slice(1))
      const accessToken = hash.get('access_token')
      const refreshToken = hash.get('refresh_token')

      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)

      if (!accessToken || !refreshToken) {
        if (active) setState('failed')
        return
      }

      const { error } = await supabaseBrowser().auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      })

      if (error) {
        console.error('gagal menyimpan implicit session', error.code ?? 'AUTH_SESSION_FAILED')
        if (active) setState('failed')
        return
      }

      window.location.replace('/')
    }

    void finishLogin()
    return () => {
      active = false
    }
  }, [])

  return (
    <section className="grid min-h-[calc(100vh-12rem)] place-items-center">
      <StatePanel
        busy={state === 'loading'}
        tone={state === 'failed' ? 'danger' : 'neutral'}
        title={state === 'loading' ? 'Menyiapkan workspace kamu' : 'Link tidak bisa dipakai'}
        description={
          state === 'loading'
            ? 'Session sedang diamankan di browser ini.'
            : 'Link mungkin sudah dipakai atau kedaluwarsa. Minta link baru untuk melanjutkan.'
        }
        action={
          state === 'failed' ? (
            <Button asChild variant="secondary">
              <Link href="/login">Minta link baru</Link>
            </Button>
          ) : undefined
        }
      />
    </section>
  )
}
