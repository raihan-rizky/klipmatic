// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import { ClipEditor } from '@/components/ClipEditor'
import { EditorHeader } from '@/components/editor/EditorHeader'
import {
  EditorWorkspace,
  type EditorWorkspaceProps,
} from '@/components/editor/EditorWorkspace'
import { makeReadyPayload } from './editorFixtures'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const workspaceProps: EditorWorkspaceProps = {
  header: <div>Header</div>,
  preview: <div>Preview</div>,
  inspector: <div>Inspector content</div>,
  timeline: <div>Timeline</div>,
}

test('lays out header preview inspector and timeline', () => {
  render(<EditorWorkspace {...workspaceProps} />)

  expect(screen.getByText('Header')).toBeVisible()
  expect(screen.getByText('Preview')).toBeVisible()
  expect(
    screen.getByRole('complementary', { name: 'Inspector' }),
  ).toBeVisible()
  expect(screen.getByText('Timeline')).toBeVisible()
})

test('mobile inspector opens as a sheet', async () => {
  render(<EditorWorkspace {...workspaceProps} />)

  await userEvent.click(
    screen.getByRole('button', { name: 'Buka inspector' }),
  )

  expect(screen.getByRole('dialog', { name: 'Inspector' })).toBeVisible()
  expect(screen.getAllByText('Inspector content')).toHaveLength(2)
})

test('ready clip renders layered timeline and autosaves a split', async () => {
  const payload = makeReadyPayload()
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/segment')) {
      return new Response(new Blob(['media'], { type: 'video/mp4' }))
    }
    if (url.endsWith('/api/clips/clip-1')) {
      return Response.json(payload)
    }
    return Response.json({ ok: true })
  })
  vi.stubGlobal('fetch', fetchMock)
  Object.assign(URL, {
    createObjectURL: vi.fn(() => 'blob:clip-1'),
    revokeObjectURL: vi.fn(),
  })
  vi
    .spyOn(HTMLMediaElement.prototype, 'pause')
    .mockImplementation(() => undefined)
  vi
    .spyOn(HTMLMediaElement.prototype, 'load')
    .mockImplementation(() => undefined)

  render(<ClipEditor clipId="clip-1" />)

  expect(await screen.findByLabelText('Preview video vertikal')).toBeVisible()
  expect(
    screen.getByRole('region', { name: 'Timeline editor' }),
  ).toBeVisible()
  expect(
    screen.getByRole('complementary', { name: 'Inspector' }),
  ).toBeVisible()

  await userEvent.click(screen.getByRole('button', { name: 'Split' }))
  expect(await screen.findByText('Belum tersimpan')).toBeVisible()
  await waitFor(() => expect(screen.getByText('Tersimpan')).toBeVisible(), {
    timeout: 2500,
  })
  expect(
    fetchMock.mock.calls.some(
      ([, init]) => (init as RequestInit | undefined)?.method === 'PATCH',
    ),
  ).toBe(true)
})

test('processing clip recovers from a transient polling error', async () => {
  vi.useFakeTimers()
  const ready = makeReadyPayload()
  const pending = {
    ...ready,
    segment: {
      status: 'pending' as const,
      url: null,
      jobId: 'job-1',
      errorCode: null,
    },
  }
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(Response.json(pending))
    .mockResolvedValueOnce(
      Response.json(
        { error: { message: 'Jaringan sempat putus.' } },
        { status: 500 },
      ),
    )
    .mockResolvedValueOnce(Response.json(ready))
    .mockResolvedValueOnce(
      new Response(new Blob(['media'], { type: 'video/mp4' })),
    )
  vi.stubGlobal('fetch', fetchMock)
  Object.assign(URL, {
    createObjectURL: vi.fn(() => 'blob:clip-1'),
    revokeObjectURL: vi.fn(),
  })
  vi
    .spyOn(HTMLMediaElement.prototype, 'pause')
    .mockImplementation(() => undefined)
  vi
    .spyOn(HTMLMediaElement.prototype, 'load')
    .mockImplementation(() => undefined)

  render(<ClipEditor clipId="clip-1" />)

  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
  expect(fetchMock).toHaveBeenCalledTimes(1)

  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000)
  })
  expect(fetchMock).toHaveBeenCalledTimes(2)

  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000)
  })

  expect(fetchMock).toHaveBeenCalledTimes(4)
  expect(screen.getByLabelText('Preview video vertikal')).toBeVisible()
})

test('save errors are announced without relying on color', () => {
  render(
    <EditorHeader
      title="Klip fixture"
      duration={30}
      timingPrecision="word"
      saveStatus="error"
      onRetry={vi.fn()}
    />,
  )

  expect(screen.getByRole('status')).toHaveTextContent('Gagal menyimpan')
  expect(
    screen.getByRole('button', { name: 'Coba simpan lagi' }),
  ).toBeVisible()
})
