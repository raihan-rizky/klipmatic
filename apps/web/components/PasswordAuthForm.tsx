'use client'

import { FormEvent, useState } from 'react'
import { ArrowRight, LoaderCircle } from 'lucide-react'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { supabaseBrowser } from '@/lib/supabase/client'

type Props = { initialMessage: string | null }

function authMessage(error: { message?: string; status?: number }) {
  if (error.status === 429) return 'Terlalu banyak percobaan. Tunggu sebentar lalu coba lagi.'
  if (error.message?.toLowerCase().includes('invalid login credentials')) {
    return 'Email atau password salah.'
  }
  if (error.message?.toLowerCase().includes('already registered')) {
    return 'Email ini sudah terdaftar. Coba masuk.'
  }
  return 'Auth gagal diproses. Coba lagi beberapa saat.'
}

export function PasswordAuthForm({ initialMessage }: Props) {
  const [registering, setRegistering] = useState(true)
  const [message, setMessage] = useState(initialMessage)
  const [sending, setSending] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSending(true)
    setMessage(null)

    const form = new FormData(event.currentTarget)
    const email = String(form.get('email') ?? '').trim()
    const password = String(form.get('password') ?? '')
    const confirmation = String(form.get('passwordConfirmation') ?? '')

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setMessage('Masukkan alamat email yang valid.')
      setSending(false)
      return
    }
    if (password.length < 8) {
      setMessage('Password minimal 8 karakter.')
      setSending(false)
      return
    }
    if (registering && password !== confirmation) {
      setMessage('Konfirmasi password belum sama.')
      setSending(false)
      return
    }

    const supabase = supabaseBrowser()
    try {
      const authRequest = registering
        ? supabase.auth.signUp({ email, password })
        : supabase.auth.signInWithPassword({ email, password })
      const timeout = new Promise<never>((_, reject) => {
        window.setTimeout(() => reject(new Error('AUTH_REQUEST_TIMEOUT')), 15_000)
      })
      const result = await Promise.race([authRequest, timeout])

      if (result.error) {
        console.error('auth password gagal', {
          name: result.error.name,
          code: result.error.code,
          status: result.error.status,
          message: result.error.message,
        })
        setMessage(authMessage(result.error))
        setSending(false)
        return
      }

      if (!result.data.session) {
        setMessage('Akun dibuat, tapi verifikasi email masih aktif di Supabase.')
        setSending(false)
        return
      }

      setMessage(registering ? 'Akun berhasil dibuat.' : 'Berhasil masuk.')
      window.location.assign('/')
    } catch (error) {
      console.error('auth password request gagal', error)
      setMessage('Server autentikasi tidak merespons. Coba lagi.')
      setSending(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-2">
        <label htmlFor="email" className="text-sm font-bold text-foreground">Alamat email</label>
        <Input id="email" name="email" type="email" autoComplete="email" placeholder="nama@email.com" required />
      </div>
      <div className="space-y-2">
        <label htmlFor="password" className="text-sm font-bold text-foreground">Password</label>
        <Input id="password" name="password" type="password" autoComplete={registering ? 'new-password' : 'current-password'} required />
      </div>
      {registering && (
        <div className="space-y-2">
          <label htmlFor="passwordConfirmation" className="text-sm font-bold text-foreground">Konfirmasi password</label>
          <Input id="passwordConfirmation" name="passwordConfirmation" type="password" autoComplete="new-password" required />
        </div>
      )}
      <Button type="submit" disabled={sending} className="w-full">
        {sending ? <><LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> Memproses…</> : <>{registering ? 'Daftar' : 'Masuk'} <ArrowRight className="size-4" aria-hidden="true" /></>}
      </Button>
      {message && <Alert role="status" tone="neutral">{message}</Alert>}
      <button type="button" className="w-full text-sm font-bold text-primary" onClick={() => { setRegistering(!registering); setMessage(null) }}>
        {registering ? 'Sudah punya akun? Masuk' : 'Belum punya akun? Daftar'}
      </button>
    </form>
  )
}
