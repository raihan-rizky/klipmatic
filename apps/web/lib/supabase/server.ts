import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function supabaseServer() {
  const store = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // Parameter setAll dianotasi eksplisit: opsi `cookies` bertipe union
      // dengan bentuk deprecated, sehingga TypeScript tidak dapat memilih
      // anggota union untuk pengetikan kontekstual dan parameternya jatuh
      // ke implicit any.
      cookies: {
        getAll() {
          return store.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value, options }) => store.set(name, value, options))
        },
      },
    },
  )
}
