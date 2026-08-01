// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import { ClipEditor } from '@/components/ClipEditor'
import { EditorHeader } from '@/components/editor/EditorHeader'
import { TimelinePreview } from '@/components/editor/TimelinePreview'
import {
  EditorWorkspace,
  type EditorWorkspaceProps,
} from '@/components/editor/EditorWorkspace'
import { makeReadyPayload } from './editorFixtures'

const exportMock = vi.hoisted(() => vi.fn(async () => undefined))

vi.mock('@/lib/browserExport', () => ({
  browserExportSupport: () => ({ supported: true, reason: null }),
  exportClipMp4: exportMock,
}))

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  exportMock.mockClear()
})

const workspaceProps: EditorWorkspaceProps = {
  header: <div>Header</div>,
  preview: <div>Preview</div>,
  inspector: <div>Inspector content</div>,
  mediaLibrary: <div>Media library content</div>,
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
  expect(screen.getByRole('complementary', { name: 'Media' })).toBeVisible()
})

test('mobile media library opens as a sheet', async () => {
  render(<EditorWorkspace {...workspaceProps} />)

  await userEvent.click(screen.getByRole('button', { name: 'Buka media' }))

  expect(screen.getByRole('dialog', { name: 'Media' })).toBeVisible()
  expect(screen.getAllByText('Media library content')).toHaveLength(2)
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

test('inserted image starts at playhead and autosaves V3', async () => {
  const payload = makeReadyPayload()
  payload.assets.push({
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
  })
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/segment')) {
      return new Response(new Blob(['media'], { type: 'video/mp4' }))
    }
    if (url.endsWith('/api/clips/clip-1') && init?.method !== 'PATCH') {
      return Response.json(payload)
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
  await screen.findByLabelText('Preview video vertikal')
  fireEvent.change(screen.getByLabelText('Posisi playhead'), {
    target: { value: '8' },
  })
  await userEvent.click(screen.getByRole('button', { name: 'Tambahkan logo.png' }))

  await waitFor(() => {
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH')
    expect(patch).toBeDefined()
    const body = JSON.parse(String(patch![1]!.body))
    expect(body.editSpec.version).toBe(3)
    const clips = body.editSpec.timeline.tracks.flatMap(
      (track: { clips: unknown[] }) => track.clips,
    )
    expect(clips).toContainEqual(expect.objectContaining({
      assetId: 'asset-image',
      timelineStart: 8,
    }))
  }, { timeout: 2500 })
})

test('built-in sticker inserts with its preset transform and autosaves V3', async () => {
  const payload = makeReadyPayload()
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/segment')) {
      return new Response(new Blob(['media'], { type: 'video/mp4' }))
    }
    if (url.endsWith('/api/clips/clip-1') && init?.method !== 'PATCH') {
      return Response.json(payload)
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
  await screen.findByLabelText('Preview video vertikal')
  await userEvent.click(screen.getByRole('tab', { name: 'Stickers' }))
  await userEvent.click(screen.getByRole('button', { name: 'Tambahkan Red arrow' }))

  await waitFor(() => {
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH')
    expect(patch).toBeDefined()
    const body = JSON.parse(String(patch![1]!.body))
    const clips = body.editSpec.timeline.tracks.flatMap(
      (track: { clips: unknown[] }) => track.clips,
    )
    expect(clips).toContainEqual(expect.objectContaining({
      assetId: 'builtin:sticker:red-arrow',
      transform: { x: 0.65, y: 0.08, width: 0.28, height: 0.28 },
    }))
  }, { timeout: 2500 })
})

test('built-in sticker reaches the same asset map used by export', async () => {
  const payload = makeReadyPayload()
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/segment')) {
      return new Response(new Blob(['media'], { type: 'video/mp4' }))
    }
    if (url.endsWith('/api/clips/clip-1') && init?.method !== 'PATCH') {
      return Response.json(payload)
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
  await screen.findByLabelText('Preview video vertikal')
  await userEvent.click(screen.getByRole('tab', { name: 'Stickers' }))
  await userEvent.click(screen.getByRole('button', { name: 'Tambahkan Red arrow' }))
  await waitFor(() => {
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(true)
  }, { timeout: 2500 })

  await userEvent.click(screen.getByRole('button', { name: 'Ekspor MP4' }))

  await waitFor(() => {
    expect(exportMock).toHaveBeenCalledWith(expect.objectContaining({
      assets: expect.arrayContaining([
        expect.objectContaining({
          id: 'builtin:sticker:red-arrow',
          url: '/presets/stickers/red-arrow.svg',
        }),
      ]),
      spec: expect.objectContaining({ version: 3 }),
    }))
  })
})

test('dropping an image on canvas inserts it at normalized position', () => {
  const onAssetDrop = vi.fn()
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined)
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined)
  render(
    <TimelinePreview
      spec={makeReadyPayload().clip.editSpec}
      assets={makeReadyPayload().assets}
      words={[]}
      playhead={4}
      playing={false}
      onPlayheadChange={vi.fn()}
      onPlayingChange={vi.fn()}
      onStall={vi.fn()}
      onAssetDrop={onAssetDrop}
    />,
  )
  const canvas = screen.getByLabelText('Preview video vertikal')
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    width: 450,
    height: 800,
    right: 450,
    bottom: 800,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  })

  const drop = new MouseEvent('drop', {
    bubbles: true,
    clientX: 405,
    clientY: 400,
  })
  Object.defineProperty(drop, 'dataTransfer', {
    value: assetTransfer('asset-image'),
  })
  fireEvent(canvas, drop)

  expect(onAssetDrop).toHaveBeenCalledWith('asset-image', {
    timelineStart: 4,
    transform: { x: 0.4, y: 0.2, width: 0.6, height: 0.6 },
  })
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
    .mockResolvedValueOnce(Response.json(
      { error: { message: 'Jaringan sempat putus.' } },
      { status: 500 },
    ))
    .mockResolvedValueOnce(Response.json(ready))
    .mockResolvedValueOnce(new Response(new Blob(['media'], { type: 'video/mp4' })))
  vi.stubGlobal('fetch', fetchMock)
  Object.assign(URL, {
    createObjectURL: vi.fn(() => 'blob:clip-1'),
    revokeObjectURL: vi.fn(),
  })
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined)
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined)

  render(<ClipEditor clipId="clip-1" />)
  await act(async () => { await vi.advanceTimersByTimeAsync(0) })
  expect(fetchMock).toHaveBeenCalledTimes(1)
  await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
  expect(fetchMock).toHaveBeenCalledTimes(2)
  await act(async () => { await vi.advanceTimersByTimeAsync(2000) })

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

function assetTransfer(assetId: string): DataTransfer {
  const payload = JSON.stringify({ assetId })
  return {
    effectAllowed: 'copy',
    dropEffect: 'copy',
    files: [] as unknown as FileList,
    items: [] as unknown as DataTransferItemList,
    types: ['application/x-cheapclipper-asset'],
    clearData: () => undefined,
    getData: (format: string) =>
      format === 'application/x-cheapclipper-asset' ? payload : '',
    setData: () => undefined,
    setDragImage: () => undefined,
  }
}
