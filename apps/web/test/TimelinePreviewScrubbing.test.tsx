// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { TimelinePreview } from '@/components/editor/TimelinePreview'
import { makeEditorSpec } from './editorFixtures'
import type { ResolvedMediaAsset } from '@/lib/clipTypes'

const seek = vi.hoisted(() => vi.fn(async () => undefined))

vi.mock('@/components/editor/timelinePlayback', () => ({
  createTimelinePlaybackController: () => ({
    play: vi.fn(async () => undefined),
    pause: vi.fn(),
    seek,
    dispose: vi.fn(),
  }),
}))

afterEach(() => {
  cleanup()
  seek.mockClear()
})

test('scrubbing seeks playback controller ke playhead yang dipilih', () => {
  const candidate: ResolvedMediaAsset = {
    id: 'asset-candidate',
    name: 'Candidate.mp4',
    mediaType: 'video',
    status: 'ready',
    url: '/candidate.mp4',
    bytes: 1_000,
    width: 1920,
    height: 1080,
    duration: 30,
    hasAudio: true,
    expiresAt: null,
    expiresSoon: false,
  }
  render(
    <TimelinePreview
      spec={makeEditorSpec()}
      assets={[candidate]}
      words={[]}
      playhead={0}
      playing={false}
      onPlayheadChange={vi.fn()}
      onPlayingChange={vi.fn()}
      onStall={vi.fn()}
    />,
  )
  seek.mockClear()

  fireEvent.change(screen.getByLabelText('Posisi playhead'), {
    target: { value: '8' },
  })

  expect(seek).toHaveBeenCalledWith(8)
})
