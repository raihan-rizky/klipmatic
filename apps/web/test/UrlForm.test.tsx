// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import { UrlForm } from '@/components/UrlForm'

const push = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}))

beforeEach(() => {
  push.mockReset()
  vi.unstubAllGlobals()
})

test('submits the source URL and opens the created project', async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ projectId: 'project-1', jobId: 'job-1' }),
  })
  vi.stubGlobal('fetch', fetchMock)
  render(<UrlForm />)
  fireEvent.change(screen.getByLabelText('Link video'), {
    target: { value: 'https://youtu.be/dQw4w9WgXcQ' },
  })
  expect(screen.getByRole('button', { name: 'Cari klip terbaik' })).toHaveClass('motion-cta')
  expect(screen.getByRole('button', { name: 'Cari klip terbaik' }).querySelector('svg')).toHaveClass(
    'motion-cta-arrow',
  )
  fireEvent.click(screen.getByRole('button', { name: 'Cari klip terbaik' }))

  expect(fetchMock).toHaveBeenCalledWith(
    '/api/projects',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ url: 'https://youtu.be/dQw4w9WgXcQ' }),
    }),
  )
  await waitFor(() => {
    expect(push).toHaveBeenCalledWith('/projects/project-1?job=job-1')
  })
})
