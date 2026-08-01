// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
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
