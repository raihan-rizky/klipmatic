import { NextResponse } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'
import { supabaseServer } from '@/lib/supabase/server'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const tokenHash = url.searchParams.get('token_hash')
  const type = url.searchParams.get('type') as EmailOtpType | null
  const supabase = await supabaseServer()

  let error: { message: string; code?: string; status?: number } | null = null
  if (tokenHash && type) {
    ;({ error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type }))
  } else if (code) {
    ;({ error } = await supabase.auth.exchangeCodeForSession(code))
  } else {
    error = { message: 'callback tidak membawa token autentikasi' }
  }

  if (error) {
    // Jangan log code/token_hash atau email. Kelas galat cukup untuk diagnosis
    // tanpa menyalin credential sekali-pakai ke log development.
    console.error(
      'gagal membuat session magic link',
      error.code ?? 'AUTH_CALLBACK_FAILED',
      error.status ?? '',
      error.message,
    )
    return NextResponse.redirect(new URL('/login?status=callback-failed', url.origin))
  }

  return NextResponse.redirect(new URL('/', url.origin))
}
