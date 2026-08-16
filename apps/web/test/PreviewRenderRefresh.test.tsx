// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { PreviewRenderRefresh } from '@/components/PreviewRenderRefresh'

const deps = vi.hoisted(() => {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
  }
  query.select.mockReturnValue(query)
  query.eq.mockReturnValue(query)
  query.order.mockReturnValue(query)
  const channel = {
    on: vi.fn(),
    subscribe: vi.fn(),
  }
  channel.on.mockReturnValue(channel)
  channel.subscribe.mockReturnValue(channel)

  return {
    jobs: [] as Array<{ status: string }>,
    router: { refresh: vi.fn() },
    query,
    supabase: {
      from: vi.fn(() => query),
      channel: vi.fn(() => channel),
      removeChannel: vi.fn(),
    },
  }
})

vi.mock('next/navigation', () => ({ useRouter: () => deps.router }))
vi.mock('@/lib/supabase/client', () => ({ supabaseBrowser: () => deps.supabase }))

beforeEach(() => {
  deps.jobs = []
  deps.router.refresh.mockReset()
  deps.query.limit.mockReset()
  deps.query.limit.mockImplementation(async () => ({ data: deps.jobs }))
})

afterEach(() => cleanup())

test('refreshes candidates while the render job is active', async () => {
  deps.jobs = [{ status: 'running' }]

  render(<PreviewRenderRefresh projectId="project-1" hasIncompletePreviews />)

  await waitFor(() => expect(deps.router.refresh).toHaveBeenCalledOnce())
})

test('refreshes candidates once when the render job becomes terminal', async () => {
  deps.jobs = [{ status: 'done' }]

  render(<PreviewRenderRefresh projectId="project-1" hasIncompletePreviews />)

  await waitFor(() => expect(deps.query.limit).toHaveBeenCalledOnce())
  expect(deps.router.refresh).toHaveBeenCalledOnce()
})
