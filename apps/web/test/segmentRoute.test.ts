import { afterEach, expect, test, vi } from 'vitest'

const deps = vi.hoisted(() => ({
  fetch: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: 'user-1' } } }),
    },
  }),
}))

vi.mock('@/lib/clips', () => ({
  ClipNotFoundError: class ClipNotFoundError extends Error {},
  loadClipSegment: async () => ({ key: 'segments/clip.mp4', bytes: 3 }),
}))

vi.mock('@/lib/db', () => ({ sql: {} }))
vi.mock('@/lib/r2', () => ({
  signedR2Get: async () => 'https://r2.test/signed',
}))

import { GET } from '../app/api/clips/[id]/segment/route'

afterEach(() => {
  vi.unstubAllGlobals()
})

test('streams segment bytes through the same-origin route', async () => {
  deps.fetch.mockResolvedValueOnce(
    new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { 'content-type': 'video/mp4' },
    }),
  )
  vi.stubGlobal('fetch', deps.fetch)

  const response = await GET(new Request('http://localhost/api/clips/clip-1/segment'), {
    params: Promise.resolve({ id: 'clip-1' }),
  })

  expect(response.status).toBe(200)
  expect(response.headers.get('content-type')).toBe('video/mp4')
  expect(response.headers.get('content-length')).toBe('3')
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(
    new Uint8Array([1, 2, 3]),
  )
})
