import { cookies } from 'next/headers'
import { supabaseServer } from '@/lib/supabase/server'

export const GUEST_COOKIE = 'klipmatic_guest_id'
export const GUEST_EMAIL = 'guest@klipmatic.local'

export type AppUser = { id: string; email: string | null; guest: boolean }

/** Returns the Supabase user, or the browser-scoped guest identity for local testing. */
export async function currentAppUser(): Promise<AppUser> {
  const supabase = await supabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (user) return { id: user.id, email: user.email ?? null, guest: false }

  const store = await cookies()
  const guestId = store.get(GUEST_COOKIE)?.value
  if (!guestId) throw new Error('Guest identity is not available')
  return { id: guestId, email: GUEST_EMAIL, guest: true }
}

export async function currentAppUserId() {
  return (await currentAppUser()).id
}
