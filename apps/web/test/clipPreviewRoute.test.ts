import { beforeEach, expect, test, vi } from 'vitest'

const deps = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  load: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: async () => ({
    auth: { getUser: async () => ({ data: { user: deps.user } }) },
  }),
}))
vi.mock('@/lib/clips', () => ({
  ClipNotFoundError: class ClipNotFoundError extends Error {},
  loadClipPreview: deps.load,
}))
vi.mock('@/lib/db', () => ({ sql: {} }))

import { ClipNotFoundError } from '@/lib/clips'
import { GET } from '../app/api/clips/[id]/preview/route'

beforeEach(() => {
  deps.user = { id: 'user-1' }
  deps.load.mockReset().mockResolvedValue({
    clipId: 'clip-1',
    status: 'ready',
    url: '/api/clips/clip-1/segment',
    jobId: 'job-1',
    errorCode: null,
    prerendered: false,
  })
})

test('requires authentication', async () => {
  deps.user = null
  const response = await GET(new Request('http://localhost'), {
    params: Promise.resolve({ id: 'clip-1' }),
  })
  expect(response.status).toBe(401)
  expect(deps.load).not.toHaveBeenCalled()
})

test('returns lightweight preview status', async () => {
  const response = await GET(new Request('http://localhost'), {
    params: Promise.resolve({ id: 'clip-1' }),
  })
  expect(response.status).toBe(200)
  expect(response.headers.get('x-request-id')).toMatch(/^[A-Za-z0-9._-]+$/)
  await expect(response.json()).resolves.toEqual({
    clipId: 'clip-1',
    status: 'ready',
    url: '/api/clips/clip-1/segment',
    jobId: 'job-1',
    errorCode: null,
    prerendered: false,
  })
  expect(deps.load).toHaveBeenCalledWith({}, 'user-1', 'clip-1')
})

test('returns prerendered url when preview is already rendered', async () => {
  deps.load.mockResolvedValueOnce({
    clipId: 'clip-1',
    status: 'ready',
    url: '/api/clips/clip-1/preview-file',
    jobId: 'job-render',
    errorCode: null,
    prerendered: true,
  })
  const response = await GET(new Request('http://localhost'), {
    params: Promise.resolve({ id: 'clip-1' }),
  })
  expect(response.status).toBe(200)
  await expect(response.json()).resolves.toMatchObject({
    url: '/api/clips/clip-1/preview-file',
    prerendered: true,
  })
})

test('returns 404 without leaking ownership', async () => {
  deps.load.mockRejectedValueOnce(new ClipNotFoundError())
  const response = await GET(new Request('http://localhost'), {
    params: Promise.resolve({ id: 'missing' }),
  })
  expect(response.status).toBe(404)
})
