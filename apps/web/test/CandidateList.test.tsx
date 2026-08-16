// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import type { CandidateView } from '@/lib/candidates'
import { CandidateList } from '@/components/CandidateList'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

const candidate1: CandidateView = {
  id: 'candidate-1',
  rank: 1,
  title: 'Hook yang kuat',
  hookText: 'Kalimat pembuka',
  startSec: 10,
  endSec: 42,
  score: 0.91,
  reason: 'Langsung ke inti',
  transcriptSlice: 'Isi transkrip',
  thumbnailStatus: 'ready',
  thumbnailUrl: '/api/candidates/candidate-1/thumbnail',
  previewStatus: 'pending',
  previewUrl: null,
}

const candidate2: CandidateView = {
  ...candidate1,
  id: 'candidate-2',
  rank: 2,
  title: 'Payoff yang jelas',
  hookText: 'Hook candidate dua',
  score: 0.87,
  thumbnailUrl: '/api/candidates/candidate-2/thumbnail',
}

afterEach(() => cleanup())

test('renders stable poster with server rank, score, duration, and transcript', () => {
  render(<CandidateList candidates={[candidate1]} />)
  expect(screen.getByRole('img', { name: candidate1.title })).toHaveAttribute(
    'src', candidate1.thumbnailUrl,
  )
  expect(screen.getByRole('button', { name: `Preview ${candidate1.title}` })).toBeVisible()
  expect(screen.getByText('#1')).toBeVisible()
  expect(screen.getByText('0:32')).toBeVisible()
  expect(screen.getByText('91')).toBeVisible()
  expect(screen.getByRole('button', { name: /Lihat kutipan/i })).toBeVisible()
  expect(screen.getByRole('button', { name: 'Edit klip' })).toBeVisible()
})

test('card opens modal and Next changes context without preparing video', () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch')
  render(<CandidateList candidates={[candidate1, candidate2]} />)
  fireEvent.click(screen.getByRole('button', { name: `Preview ${candidate1.title}` }))
  expect(screen.getByRole('dialog', { name: candidate1.title })).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: /Candidate berikutnya/i }))
  expect(screen.getByRole('dialog', { name: candidate2.title })).toBeVisible()
  expect(fetchMock).not.toHaveBeenCalled()
  fetchMock.mockRestore()
})

test('broken poster falls back without changing media dimensions', () => {
  render(<CandidateList candidates={[candidate1]} />)
  fireEvent.error(screen.getByRole('img', { name: candidate1.title }))
  expect(screen.getByTestId('candidate-thumbnail-placeholder')).toHaveClass('aspect-video')
})

test('Escape closes modal and restores focus to its preview card', async () => {
  render(<CandidateList candidates={[candidate1, candidate2]} />)
  const opener = screen.getByRole('button', { name: `Preview ${candidate1.title}` })
  opener.focus()
  fireEvent.click(opener)
  expect(screen.getByRole('dialog', { name: candidate1.title })).toBeVisible()
  fireEvent.keyDown(document, { key: 'Escape' })
  await waitFor(() => expect(opener).toHaveFocus())
})

test('rendering badge appears when preview is in progress', () => {
  const rendering: CandidateView = {
    ...candidate1,
    previewStatus: 'rendering',
  }
  render(<CandidateList candidates={[rendering]} />)
  expect(screen.getByTestId('candidate-preview-rendering')).toHaveTextContent(
    'Menyiapkan preview…',
  )
})

test('failed badge appears when preview render failed', () => {
  const failed: CandidateView = {
    ...candidate1,
    previewStatus: 'failed',
  }
  render(<CandidateList candidates={[failed]} />)
  expect(screen.getByTestId('candidate-preview-failed')).toHaveTextContent('Preview gagal')
})
