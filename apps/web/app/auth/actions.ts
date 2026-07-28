'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { supabaseServer } from '@/lib/supabase/server'

function loginUrl(code: 'invalid-email' | 'send-failed' | 'sent'): string {
  return `/login?status=${code}`
}

async function appOrigin(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, '')
  if (configured) return configured

  const requestHeaders = await headers()
  const host = requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host')
  const protocol =
    requestHeaders.get('x-forwarded-proto') ??
    (host?.startsWith('localhost') || host?.startsWith('127.0.0.1') ? 'http' : 'https')

  if (!host) throw new Error('Host aplikasi tidak tersedia')
  return `${protocol}://${host}`
}

export async function requestMagicLink(formData: FormData): Promise<void> {
  const email = formData.get('email')
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    redirect(loginUrl('invalid-email'))
  }

  const supabase = await supabaseServer()
  const origin = await appOrigin()
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim(),
    options: { emailRedirectTo: `${origin}/auth/callback` },
  })

  if (error) {
    // Detail provider tidak diteruskan ke query string karena bisa membawa
    // konfigurasi internal. Log server tetap cukup untuk diagnosis operator.
    console.error('gagal mengirim magic link', error.message)
    redirect(loginUrl('send-failed'))
  }
  redirect(loginUrl('sent'))
}

export async function signOut(): Promise<void> {
  const supabase = await supabaseServer()
  await supabase.auth.signOut()
  redirect('/')
}
