import { expect, test, vi } from 'vitest'

const infra = vi.hoisted(() => {
  const response = {
    cookies: { set: vi.fn() },
  }
  const next = vi.fn(() => response)
  const createServerClient = vi.fn((...args: unknown[]) => {
    const config = args[2] as {
      cookies: {
        setAll: (
          cookiesToSet: { name: string; value: string; options: Record<string, unknown> }[],
        ) => void
      }
    }

    return {
      auth: {
        getUser: vi.fn(async () => {
          config.cookies.setAll([
            {
              name: 'sb-test-auth-token',
              value: 'rotated-token',
              options: { path: '/', httpOnly: true },
            },
          ])
          return { data: { user: null }, error: null }
        }),
      },
    }
  })

  return { response, next, createServerClient }
})

vi.mock('next/server', () => ({
  NextResponse: { next: infra.next },
}))

vi.mock('@supabase/ssr', () => ({
  createServerClient: infra.createServerClient,
}))

const { config, middleware } = await import('../middleware')

test('copies refreshed Supabase cookies to the outgoing middleware response', async () => {
  const requestCookies = {
    getAll: vi.fn(() => [{ name: 'sb-test-auth-token', value: 'old-token' }]),
    set: vi.fn(),
  }

  await middleware({ cookies: requestCookies } as never)

  expect(requestCookies.set).toHaveBeenCalledWith('sb-test-auth-token', 'rotated-token')
  expect(infra.response.cookies.set).toHaveBeenCalledWith(
    'sb-test-auth-token',
    'rotated-token',
    { path: '/', httpOnly: true },
  )
  expect(config.matcher).toEqual([
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ])
})
