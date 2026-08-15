import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const deps = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  load: vi.fn(),
  signed: vi.fn(),
  fetch: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: async () => ({
    auth: { getUser: async () => ({ data: { user: deps.user } }) },
  }),
}))

vi.mock('@/lib/candidates', () => ({
  CandidateNotFoundError: class CandidateNotFoundError extends Error {},
  loadCandidateThumbnail: deps.load,
}))

vi.mock('@/lib/db', () => ({ sql: {} }))
vi.mock('@/lib/r2', () => ({ signedR2Get: deps.signed }))

import { CandidateNotFoundError } from '@/lib/candidates'
import { GET } from '../app/api/candidates/[id]/thumbnail/route'

beforeEach(() => {
  deps.user = { id: 'user-1' }
  deps.load.mockReset().mockResolvedValue({ key: 'candidate-thumbnails/a.webp' })
  deps.signed.mockReset().mockResolvedValue('https://r2.test/signed')
  deps.fetch.mockReset().mockResolvedValue(
    new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { 'content-type': 'image/webp', 'content-length': '3' },
    }),
  )
  vi.stubGlobal('fetch', deps.fetch)
})

afterEach(() => vi.unstubAllGlobals())

test('requires authentication', async () => {
  deps.user = null
  const response = await GET(new Request('http://localhost'), {
    params: Promise.resolve({ id: 'candidate-1' }),
  })
  expect(response.status).toBe(401)
  expect(deps.load).not.toHaveBeenCalled()
})

test('streams an owned WebP thumbnail through a private cache', async () => {
  const response = await GET(new Request('http://localhost'), {
    params: Promise.resolve({ id: 'candidate-1' }),
  })
  expect(response.status).toBe(200)
  expect(response.headers.get('content-type')).toBe('image/webp')
  expect(response.headers.get('content-length')).toBe('3')
  expect(response.headers.get('cache-control')).toBe('private, max-age=3600')
  expect(deps.load).toHaveBeenCalledWith({}, 'user-1', 'candidate-1')
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
})

test('returns 404 when candidate thumbnail is unavailable', async () => {
  deps.load.mockRejectedValueOnce(new CandidateNotFoundError())
  const response = await GET(new Request('http://localhost'), {
    params: Promise.resolve({ id: 'missing' }),
  })
  expect(response.status).toBe(404)
})
