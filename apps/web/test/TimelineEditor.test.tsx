// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import type { EditSpecV3 } from '@cheapclipper/engine'
import { TimelineEditor } from '@/components/editor/TimelineEditor'
import { makeEditorSpec } from './editorFixtures'

afterEach(cleanup)

function propsFor(spec: EditSpecV3) {
  const primary = spec.timeline.tracks[0]!
  return {
    spec,
    candidateDuration: 30,
    playhead: 10,
    selected: { trackId: primary.id, clipId: primary.clips[0]!.id },
    onPlayheadChange: vi.fn(),
    onSelectionChange: vi.fn(),
    onCommand: vi.fn(),
    canUndo: false,
    canRedo: false,
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    playing: false,
    onTogglePlay: vi.fn(),
    onAssetDrop: vi.fn(),
  }
}

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

test('trim handles expose accessible range controls', () => {
  render(<TimelineEditor {...propsFor(makeEditorSpec())} />)

  expect(screen.getByRole('slider', { name: 'Trim awal Video' })).toHaveAttribute(
    'min',
    '0',
  )
  expect(screen.getByRole('slider', { name: 'Trim akhir Video' })).toHaveAttribute(
    'max',
    '30',
  )
})

test('locked track disables destructive timeline actions', () => {
  const source = makeEditorSpec()
  const spec = {
    ...source,
    timeline: {
      ...source.timeline,
      tracks: source.timeline.tracks.map((track) =>
        track.id === source.timeline.primaryTrackId
          ? { ...track, locked: true }
          : track,
      ),
    },
  }
  render(<TimelineEditor {...propsFor(spec)} />)

  expect(screen.getByRole('button', { name: 'Split' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Hapus' })).toBeDisabled()
})

test('split dispatches selected clip at the current playhead', async () => {
  const props = propsFor(makeEditorSpec())
  render(<TimelineEditor {...props} />)

  await userEvent.click(screen.getByRole('button', { name: 'Split' }))

  expect(props.onCommand).toHaveBeenCalledWith({
    type: 'splitClip',
    trackId: props.selected.trackId,
    clipId: props.selected.clipId,
    outputTime: 10,
  })
})

test('keyboard shortcut toggles playback without requiring hover', async () => {
  const props = propsFor(makeEditorSpec())
  render(<TimelineEditor {...props} />)

  const timeline = screen.getByRole('region', { name: 'Timeline editor' })
  timeline.focus()
  await userEvent.keyboard(' ')

  expect(props.onTogglePlay).toHaveBeenCalledOnce()
})

test('all gesture actions have named button or range alternatives', () => {
  render(<TimelineEditor {...propsFor(makeEditorSpec())} />)

  expect(screen.getByRole('button', { name: 'Split' })).toBeVisible()
  expect(screen.getByRole('button', { name: 'Hapus' })).toBeVisible()
  for (const slider of screen.getAllByRole('slider', { name: /Trim awal/ })) {
    expect(slider).toBeVisible()
  }
  for (const slider of screen.getAllByRole('slider', { name: /Trim akhir/ })) {
    expect(slider).toBeVisible()
  }
})

test('timeline pointer drag commits one move command', () => {
  const source = makeEditorSpec()
  const overlayClip = {
    id: 'overlay-clip',
    assetId: 'asset-image',
    timelineStart: 0,
    sourceIn: 0,
    sourceOut: 5,
    muted: false,
    transform: { x: 0.2, y: 0.2, width: 0.6, height: 0.6 },
  }
  const spec: EditSpecV3 = {
    ...source,
    timeline: {
      ...source.timeline,
      tracks: [...source.timeline.tracks, {
        id: 'overlay-track',
        type: 'video',
        name: 'Images',
        order: source.timeline.tracks.length,
        hidden: false,
        locked: false,
        clips: [overlayClip],
      }],
    },
  }
  const props = {
    ...propsFor(spec),
    selected: { trackId: 'overlay-track', clipId: 'overlay-clip' },
    playhead: 20,
  }
  render(<TimelineEditor {...props} />)

  const clip = screen.getByRole('button', { name: /Images, 5.0 detik/ })
  fireEvent.pointerDown(clip, { pointerId: 1, clientX: 100 })
  fireEvent.pointerMove(window, { pointerId: 1, clientX: 172 })
  expect(props.onCommand).not.toHaveBeenCalled()
  fireEvent.pointerUp(window, { pointerId: 1, clientX: 172 })

  expect(props.onCommand).toHaveBeenCalledTimes(1)
  expect(props.onCommand).toHaveBeenCalledWith({
    type: 'moveClip',
    trackId: 'overlay-track',
    clipId: 'overlay-clip',
    timelineStart: 2,
  })
})

test('dropping audio on a timeline track uses pointer time', () => {
  const source = makeEditorSpec()
  const spec: EditSpecV3 = {
    ...source,
    timeline: {
      ...source.timeline,
      tracks: source.timeline.tracks.map((track) =>
        track.type === 'audio' ? { ...track, clips: [] } : track,
      ),
    },
  }
  const props = propsFor(spec)
  render(<TimelineEditor {...props} />)
  const dropArea = screen.getByLabelText('Audio timeline drop area')
  vi.spyOn(dropArea, 'getBoundingClientRect').mockReturnValue({
    left: 192,
    top: 0,
    width: 1080,
    height: 64,
    right: 1272,
    bottom: 64,
    x: 192,
    y: 0,
    toJSON: () => ({}),
  })

  const drop = new MouseEvent('drop', { bubbles: true, clientX: 372 })
  Object.defineProperty(drop, 'dataTransfer', {
    value: assetTransfer('asset-audio'),
  })
  fireEvent(dropArea, drop)

  expect(props.onAssetDrop).toHaveBeenCalledWith('asset-audio', {
    timelineStart: 5,
  })
})
