import { expect, test, vi } from 'vitest'

const infra = vi.hoisted(() => {
  const cookieStore = {
    getAll: vi.fn(() => []),
    set: vi.fn(() => {
      throw new Error('Cookies can only be modified in a Server Action or Route Handler')
    }),
  }

  const createServerClient = vi.fn((...args: unknown[]) => {
    const config = args[2] as {
      cookies: {
        setAll: (
          cookiesToSet: { name: string; value: string; options: Record<string, unknown> }[],
        ) => void
      }
    }

    config.cookies.setAll([
      { name: 'sb-test-auth-token', value: 'rotated-token', options: { path: '/' } },
    ])
    return { auth: {} }
  })

  return { cookieStore, createServerClient }
})

vi.mock('next/headers', () => ({
  cookies: async () => infra.cookieStore,
}))

vi.mock('@supabase/ssr', () => ({
  createServerClient: infra.createServerClient,
}))

const { supabaseServer } = await import('../lib/supabase/server')

test('does not reject when a Server Component cannot write refreshed cookies', async () => {
  await expect(supabaseServer()).resolves.toBeDefined()
  expect(infra.cookieStore.set).toHaveBeenCalledWith(
    'sb-test-auth-token',
    'rotated-token',
    { path: '/' },
  )
})
