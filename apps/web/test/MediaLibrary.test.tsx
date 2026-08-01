// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { MediaLibrary } from '@/components/editor/MediaLibrary'
import { BUILTIN_MEDIA } from '@/lib/builtinMedia'
import type { ResolvedMediaAsset } from '@/lib/clipTypes'

const upload = vi.hoisted(() => vi.fn())

vi.mock('@/components/editor/assetUpload', () => ({ uploadMediaAsset: upload }))

const readyImage: ResolvedMediaAsset = {
  id: 'asset-image',
  name: 'logo.png',
  mediaType: 'image',
  status: 'ready',
  url: '/api/assets/asset-image/content',
  bytes: 1024,
  width: 800,
  height: 600,
  duration: null,
  hasAudio: false,
  expiresAt: '2026-08-04T00:00:00.000Z',
  expiresSoon: false,
}

function props(overrides: Partial<React.ComponentProps<typeof MediaLibrary>> = {}) {
  return {
    projectId: 'project-1',
    assets: [readyImage],
    playhead: 4.5,
    onAssetsChange: vi.fn(),
    onInsert: vi.fn(),
    ...overrides,
  }
}

beforeEach(() => {
  upload.mockReset()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

test('clicking a ready image inserts it at the current playhead', async () => {
  const onInsert = vi.fn()
  render(<MediaLibrary {...props({ onInsert })} />)

  await userEvent.click(screen.getByRole('button', { name: 'Tambahkan logo.png' }))

  expect(onInsert).toHaveBeenCalledWith(readyImage, { timelineStart: 4.5 })
})

test('ready media exposes timeline drag data', () => {
  render(<MediaLibrary {...props()} />)
  const setData = vi.fn()

  fireEvent.dragStart(screen.getByRole('button', { name: 'Tambahkan logo.png' }), {
    dataTransfer: { setData, effectAllowed: '' },
  })

  expect(setData).toHaveBeenCalledWith(
    'application/x-cheapclipper-asset',
    JSON.stringify({ assetId: 'asset-image' }),
  )
})

test('uploading assets poll until the refreshed list is ready', async () => {
  vi.useFakeTimers()
  const uploading = { ...readyImage, status: 'uploading' as const, url: null }
  const onAssetsChange = vi.fn()
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
    assets: [readyImage],
    usage: { usedBytes: 1024, limitBytes: 300 * 1024 * 1024 },
  }), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)

  const { unmount } = render(
    <MediaLibrary {...props({ assets: [uploading], onAssetsChange })} />,
  )
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2_000)
  })

  expect(onAssetsChange).toHaveBeenCalledWith([readyImage])
  expect(fetchMock).toHaveBeenCalledTimes(1)
  unmount()
  await act(async () => {
    await vi.advanceTimersByTimeAsync(4_000)
  })
  expect(fetchMock).toHaveBeenCalledTimes(1)
})

test('retrying a failed asset uploads a fresh record without inserting it', async () => {
  const failed = { ...readyImage, id: 'failed-1', status: 'failed' as const, url: null }
  const retried = { ...readyImage, id: 'asset-2', status: 'uploading' as const, url: null }
  const onAssetsChange = vi.fn()
  const onInsert = vi.fn()
  upload.mockResolvedValue(retried)
  render(<MediaLibrary {...props({ assets: [failed], onAssetsChange, onInsert })} />)

  const file = new File(['image'], 'logo-new.png', { type: 'image/png' })
  await userEvent.upload(screen.getByLabelText('Pilih file untuk retry logo.png'), file)

  await waitFor(() => expect(onAssetsChange).toHaveBeenCalledWith([failed, retried]))
  expect(upload).toHaveBeenCalledWith('project-1', file, expect.any(Function))
  expect(onInsert).not.toHaveBeenCalled()
  expect(screen.getByRole('status')).toHaveTextContent('logo-new.png selesai di-upload')
})

test('expired replacement dispatches only after the new asset is ready', async () => {
  vi.useFakeTimers()
  const expired = { ...readyImage, id: 'expired-1', status: 'expired' as const, url: null }
  const replacement = { ...readyImage, id: 'asset-2', status: 'uploading' as const, url: null }
  const replacementReady = { ...replacement, status: 'ready' as const, url: '/api/assets/asset-2/content' }
  const onReplace = vi.fn()
  upload.mockResolvedValue(replacement)
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
    assets: [expired, replacementReady],
    usage: { usedBytes: 1024, limitBytes: 300 * 1024 * 1024 },
  }), { status: 200 })))
  render(<MediaLibrary {...props({ assets: [expired], onReplace })} />)

  const file = new File(['image'], 'new-logo.png', { type: 'image/png' })
  await act(async () => {
    fireEvent.change(screen.getByLabelText('Pilih file pengganti logo.png'), {
      target: { files: [file] },
    })
  })
  expect(onReplace).not.toHaveBeenCalled()

  await act(async () => {
    await vi.advanceTimersByTimeAsync(2_000)
  })
  expect(onReplace).toHaveBeenCalledWith('expired-1', 'asset-2')
})

test('shows grouped states, quota usage, and expiry warning', () => {
  const assets: ResolvedMediaAsset[] = [
    { ...readyImage, expiresSoon: true },
    { ...readyImage, id: 'expired-1', name: 'old.png', status: 'expired', url: null },
  ]
  render(<MediaLibrary {...props({ assets })} />)

  expect(screen.getByText('1 KB / 300 MB')).toBeVisible()
  expect(screen.getByText('Akan dihapus kurang dari 1 hari')).toBeVisible()
  expect(screen.getByText('Kedaluwarsa')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Ganti old.png' })).toBeVisible()
})

test('preset tabs filter sound effects, stickers, photos, and backgrounds', async () => {
  render(<MediaLibrary {...props()} builtIns={BUILTIN_MEDIA} />)

  await userEvent.click(screen.getByRole('tab', { name: 'Sound effects' }))
  expect(screen.getByRole('button', { name: 'Preview Pop' })).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Tambahkan Red arrow' })).toBeNull()

  await userEvent.click(screen.getByRole('tab', { name: 'Stickers' }))
  expect(screen.getByRole('button', { name: 'Tambahkan Red arrow' })).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Preview Pop' })).toBeNull()
})

test('background insert uses its full-canvas transform at the playhead', async () => {
  const onInsert = vi.fn()
  render(<MediaLibrary {...props({ onInsert })} builtIns={BUILTIN_MEDIA} />)

  await userEvent.click(screen.getByRole('tab', { name: 'Backgrounds' }))
  await userEvent.click(
    screen.getByRole('button', { name: 'Tambahkan Sunset gradient' }),
  )

  expect(onInsert).toHaveBeenCalledWith(
    expect.objectContaining({
      id: 'builtin:background:sunset-gradient',
      defaultTransform: { x: 0, y: 0, width: 1, height: 1 },
    }),
    {
      timelineStart: 4.5,
      transform: { x: 0, y: 0, width: 1, height: 1 },
    },
  )
})

test('sound preview uses one player and stops when the library unmounts', async () => {
  const play = vi
    .spyOn(HTMLMediaElement.prototype, 'play')
    .mockResolvedValue(undefined)
  const pause = vi
    .spyOn(HTMLMediaElement.prototype, 'pause')
    .mockImplementation(() => undefined)
  const { unmount } = render(
    <MediaLibrary {...props()} builtIns={BUILTIN_MEDIA} />,
  )

  await userEvent.click(screen.getByRole('tab', { name: 'Sound effects' }))
  await userEvent.click(screen.getByRole('button', { name: 'Preview Pop' }))
  expect(play).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('button', { name: 'Stop Pop' })).toBeVisible()

  await userEvent.click(screen.getByRole('button', { name: 'Preview Bell' }))
  expect(pause).toHaveBeenCalled()
  expect(play).toHaveBeenCalledTimes(2)

  unmount()
  expect(pause).toHaveBeenCalled()
})

test('preset search filters the active category by name', async () => {
  render(<MediaLibrary {...props()} builtIns={BUILTIN_MEDIA} />)

  await userEvent.click(screen.getByRole('tab', { name: 'Stickers' }))
  await userEvent.type(screen.getByRole('searchbox', { name: 'Cari preset' }), 'subscribe')

  expect(screen.getByRole('button', { name: 'Tambahkan Subscribe badge' })).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Tambahkan Red arrow' })).toBeNull()
})
