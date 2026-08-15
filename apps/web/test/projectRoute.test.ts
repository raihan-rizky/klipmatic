import { beforeEach, expect, test, vi } from 'vitest'

const deps = vi.hoisted(() => ({
  create: vi.fn(),
  user: { id: 'user-1' } as { id: string } | null,
}))

vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: async () => ({
    auth: { getUser: async () => ({ data: { user: deps.user } }) },
  }),
}))
vi.mock('@/lib/createProject', () => ({ createProjectFromUrl: deps.create }))
vi.mock('@/lib/db', () => ({ sql: {} }))

import { POST } from '../app/api/projects/route'

beforeEach(() => {
  deps.user = { id: 'user-1' }
  deps.create.mockReset().mockResolvedValue({
    projectId: '00000000-0000-4000-8000-000000000001',
    jobId: '00000000-0000-4000-8000-000000000002',
  })
})

test('project route echoes a safe request id', async () => {
  const response = await POST(
    new Request('http://localhost/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-request-id': 'req-project-1' },
      body: JSON.stringify({ url: 'https://youtube.com/watch?v=private' }),
    }),
  )

  expect(response.status).toBe(201)
  expect(response.headers.get('x-request-id')).toBe('req-project-1')
})

test('project failure log is correlated without leaking the submitted URL', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  deps.create.mockRejectedValueOnce(
    Object.assign(new Error('download failed for https://private.example/video'), {
      code: 'UPSTREAM_FAILED',
    }),
  )

  const response = await POST(
    new Request('http://localhost/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-request-id': 'req-project-2' },
      body: JSON.stringify({ url: 'https://private.example/video' }),
    }),
  )
  const rendered = log.mock.calls.flat().join('\n')
  log.mockRestore()

  expect(response.status).toBe(500)
  expect(rendered).toContain('req-project-2')
  expect(rendered).toContain('UPSTREAM_FAILED')
  expect(rendered).not.toContain('private.example')
})
