// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { CandidateView } from '@/lib/candidates'
import { CandidatePreviewModal } from '@/components/CandidatePreviewModal'

const navigation = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => navigation }))

const candidate3: CandidateView = {
  id: 'candidate-3',
  rank: 3,
  startSec: 20,
  endSec: 80,
  score: 0.91,
  title: 'Candidate tiga',
  hookText: 'Hook candidate tiga',
  reason: 'Strong payoff',
  transcriptSlice: 'Transcript tiga',
  thumbnailStatus: 'ready',
  thumbnailUrl: '/api/candidates/candidate-3/thumbnail',
}

const fetchMock = vi.fn<typeof fetch>()
const pause = vi.fn()
const play = vi.fn()
const load = vi.fn()

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  )
}

function props(overrides: Partial<React.ComponentProps<typeof CandidatePreviewModal>> = {}) {
  return {
    candidate: candidate3,
    open: true,
    hasPrevious: true,
    hasNext: true,
    onOpenChange: vi.fn(),
    onPrevious: vi.fn(),
    onNext: vi.fn(),
    initialClipId: null,
    onClipResolved: vi.fn(),
    ...overrides,
  }
}

beforeEach(() => {
  fetchMock.mockReset()
  navigation.push.mockReset()
  pause.mockReset()
  play.mockReset()
  load.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(pause)
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(play)
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(load)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

test('opening shows exact context but does not create a clip until Play', () => {
  render(<CandidatePreviewModal {...props()} />)
  expect(screen.getByRole('dialog', { name: candidate3.title })).toBeVisible()
  expect(screen.getByText('#3')).toBeVisible()
  expect(screen.getByText(candidate3.hookText)).toBeVisible()
  expect(screen.getByLabelText('skor 91')).toBeVisible()
  expect(screen.getByText('Strong payoff')).toBeVisible()
  expect(screen.getByText('1:00')).toBeVisible()
  expect(fetchMock).not.toHaveBeenCalled()
})

test('Play creates clip, polls ready, and never autoplays', async () => {
  const onClipResolved = vi.fn()
  fetchMock
    .mockImplementationOnce(() => jsonResponse({ clipId: 'clip-3', jobId: 'job-3' }, 201))
    .mockImplementationOnce(() => jsonResponse({
      clipId: 'clip-3',
      status: 'ready',
      url: '/api/clips/clip-3/segment',
      jobId: 'job-3',
      errorCode: null,
    }))
  render(<CandidatePreviewModal {...props({ onClipResolved })} />)
  fireEvent.click(screen.getByRole('button', { name: /Putar preview/i }))

  await waitFor(() => expect(screen.getByTestId('candidate-preview-video')).toHaveAttribute(
    'src',
    '/api/clips/clip-3/segment',
  ))
  expect(onClipResolved).toHaveBeenCalledWith(candidate3.id, 'clip-3')
  expect(play).not.toHaveBeenCalled()
})

test('transient status error retries with bounded delay', async () => {
  vi.useFakeTimers()
  fetchMock
    .mockImplementationOnce(() => jsonResponse({ clipId: 'clip-3', jobId: 'job-3' }, 201))
    .mockRejectedValueOnce(new Error('temporary network error'))
    .mockImplementationOnce(() => jsonResponse({
      clipId: 'clip-3', status: 'ready', url: '/api/clips/clip-3/segment',
      jobId: 'job-3', errorCode: null,
    }))
  render(<CandidatePreviewModal {...props()} />)
  fireEvent.click(screen.getByRole('button', { name: /Putar preview/i }))
  await act(async () => Promise.resolve())
  await act(async () => vi.advanceTimersByTimeAsync(1000))
  expect(screen.getByTestId('candidate-preview-video')).toHaveAttribute(
    'src', '/api/clips/clip-3/segment',
  )
})

test('terminal failure shows Retry and retry starts a fresh create request', async () => {
  fetchMock
    .mockImplementationOnce(() => jsonResponse({ clipId: 'clip-3', jobId: 'job-3' }, 201))
    .mockImplementationOnce(() => jsonResponse({
      clipId: 'clip-3', status: 'failed', url: null,
      jobId: 'job-3', errorCode: 'SEGMENT_FETCH_FAILED',
    }))
    .mockImplementationOnce(() => jsonResponse({ clipId: 'clip-3', jobId: 'job-4' }, 201))
    .mockImplementationOnce(() => jsonResponse({
      clipId: 'clip-3', status: 'ready', url: '/api/clips/clip-3/segment',
      jobId: 'job-4', errorCode: null,
    }))
  render(<CandidatePreviewModal {...props()} />)
  fireEvent.click(screen.getByRole('button', { name: /Putar preview/i }))
  const retry = await screen.findByRole('button', { name: 'Coba lagi' })
  fireEvent.click(retry)
  await screen.findByTestId('candidate-preview-video')
  expect(fetchMock.mock.calls.filter(([url]) => url === '/api/clips')).toHaveLength(2)
})

test('Next pauses video and does not fetch the destination candidate', async () => {
  const onNext = vi.fn()
  fetchMock
    .mockImplementationOnce(() => jsonResponse({ clipId: 'clip-3', jobId: null }, 201))
    .mockImplementationOnce(() => jsonResponse({
      clipId: 'clip-3', status: 'ready', url: '/api/clips/clip-3/segment',
      jobId: null, errorCode: null,
    }))
  render(<CandidatePreviewModal {...props({ onNext })} />)
  fireEvent.click(screen.getByRole('button', { name: /Putar preview/i }))
  await screen.findByTestId('candidate-preview-video')
  fetchMock.mockClear()
  fireEvent.click(screen.getByRole('button', { name: /Candidate berikutnya/i }))
  expect(pause).toHaveBeenCalled()
  expect(onNext).toHaveBeenCalledOnce()
  expect(fetchMock).not.toHaveBeenCalled()
})

test('known clip can open editor directly and arrow keys respect boundaries', () => {
  const onPrevious = vi.fn()
  render(
    <CandidatePreviewModal
      {...props({ initialClipId: 'clip-3', hasNext: false, onPrevious })}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Edit klip' }))
  expect(navigation.push).toHaveBeenCalledWith('/clips/clip-3')
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'ArrowLeft' })
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'ArrowRight' })
  expect(onPrevious).toHaveBeenCalledOnce()
})
