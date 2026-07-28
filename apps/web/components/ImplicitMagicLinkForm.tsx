'use client'

import { createClient } from '@supabase/supabase-js'
import { FormEvent, useState } from 'react'
import { ArrowRight, LoaderCircle, Mail } from 'lucide-react'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

type Props = {
  initialMessage: string | null
}

function implicitAuthClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        flowType: 'implicit',
        persistSession: false,
      },
    },
  )
}

export function ImplicitMagicLinkForm({ initialMessage }: Props) {
  const [message, setMessage] = useState(initialMessage)
  const [sending, setSending] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSending(true)
    setMessage(null)

    const form = new FormData(event.currentTarget)
    const email = String(form.get('email') ?? '').trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setMessage('Masukkan alamat email yang valid.')
      setSending(false)
      return
    }

    const { error } = await implicitAuthClient().auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/implicit`,
      },
    })

    if (error) {
      console.error('gagal mengirim implicit magic link', error.code ?? 'AUTH_SEND_FAILED')
      setMessage(
        error.status === 429
          ? 'Tunggu sekitar 60 detik sebelum minta link baru.'
          : 'Magic link gagal dikirim. Coba lagi beberapa saat.',
      )
    } else {
      setMessage('Magic link sudah dikirim. Cek inbox dan folder spam kamu.')
    }
    setSending(false)
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-2">
        <label htmlFor="email" className="text-sm font-bold text-foreground">
          Alamat email
        </label>
        <div className="relative">
          <Mail
            className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted"
            aria-hidden="true"
          />
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="nama@email.com"
            className="pl-11"
            required
          />
        </div>
        <p className="text-xs leading-5 text-muted">
          Kami akan mengirim link sekali pakai ke inbox kamu.
        </p>
      </div>
      <Button type="submit" disabled={sending} className="w-full">
        {sending ? (
          <>
            <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
            Mengirim…
          </>
        ) : (
          <>
            Kirim magic link
            <ArrowRight className="size-4" aria-hidden="true" />
          </>
        )}
      </Button>
      {message && (
        <Alert role="status" tone="neutral">
          {message}
        </Alert>
      )}
    </form>
  )
}
