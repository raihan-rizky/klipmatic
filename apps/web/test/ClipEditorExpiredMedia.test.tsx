// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { ClipEditor } from '@/components/ClipEditor'
import { makeReadyPayload } from './editorFixtures'

const upload = vi.hoisted(() => vi.fn())

vi.mock('@/components/editor/assetUpload', () => ({ uploadMediaAsset: upload }))

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  upload.mockReset()
})

test('expired-media error hilang setelah replacement siap', async () => {
  const payload = makeReadyPayload()
  const expired = {
    ...payload.assets[0]!,
    id: 'asset-expired',
    name: 'old-logo.png',
    mediaType: 'image' as const,
    status: 'expired' as const,
    url: null,
    duration: null,
    hasAudio: false,
  }
  const uploading = {
    ...expired,
    id: 'asset-replacement',
    name: 'new-logo.png',
    status: 'uploading' as const,
  }
  const ready = {
    ...uploading,
    status: 'ready' as const,
    url: '/api/assets/asset-replacement/content',
  }
  payload.assets.push(expired)
  upload.mockResolvedValue(uploading)

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/segment')) {
      return new Response(new Blob(['media'], { type: 'video/mp4' }))
    }
    if (url.endsWith('/api/clips/clip-1') && init?.method !== 'PATCH') {
      return Response.json(payload)
    }
    if (url.endsWith('/api/projects/project-1/assets')) {
      return Response.json({
        assets: [ready],
        usage: { usedBytes: ready.bytes, limitBytes: 300 * 1024 * 1024 },
      })
    }
    return Response.json({ ok: true })
  })
  vi.stubGlobal('fetch', fetchMock)
  Object.assign(URL, {
    createObjectURL: vi.fn(() => 'blob:clip-1'),
    revokeObjectURL: vi.fn(),
  })
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined)
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined)

  render(<ClipEditor clipId="clip-1" />)

  expect(
    await screen.findAllByText(/Media kedaluwarsa: old-logo\.png/),
  ).toHaveLength(2)
  vi.useFakeTimers()
  const file = new File(['image'], 'new-logo.png', { type: 'image/png' })
  await act(async () => {
    fireEvent.change(screen.getByLabelText('Pilih file pengganti old-logo.png'), {
      target: { files: [file] },
    })
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2_000)
  })

  expect(screen.queryAllByText(/Media kedaluwarsa: old-logo\.png/)).toHaveLength(0)
})
