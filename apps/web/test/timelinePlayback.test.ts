import { expect, test, vi } from 'vitest'
import type { EditSpecV2 } from '@cheapclipper/engine'
import {
  createTimelinePlaybackController,
  type PlaybackMedia,
} from '@/components/editor/timelinePlayback'
import { makeEditorSpec } from './editorFixtures'

function makeCutSpec(): EditSpecV2 {
  const spec = makeEditorSpec()
  return {
    ...spec,
    timeline: {
      ...spec.timeline,
      tracks: spec.timeline.tracks.map((track) =>
        track.id === spec.timeline.primaryTrackId
          ? {
              ...track,
              clips: [
                { ...track.clips[0]!, id: 'left', sourceOut: 10 },
                {
                  ...track.clips[0]!,
                  id: 'right',
                  timelineStart: 10,
                  sourceIn: 20,
                  sourceOut: 30,
                },
              ],
            }
          : track,
      ),
    },
  }
}

function fakeMediaElement(fails = false): PlaybackMedia {
  return {
    currentTime: 0,
    paused: true,
    muted: false,
    play: vi.fn(async () => {
      if (fails) throw new Error('stalled')
    }),
    pause: vi.fn(),
  }
}

test('seeks to the next source range when playhead crosses a cut', async () => {
  const media = fakeMediaElement()
  const controller = createTimelinePlaybackController({
    spec: makeCutSpec(),
    mediaForClip: (item) =>
      item.trackType === 'video' ? media : fakeMediaElement(),
    onTime: vi.fn(),
    onFrame: vi.fn(),
    onStall: vi.fn(),
  })

  await controller.seek(9.9)
  await controller.seek(10)

  expect(media.currentTime).toBe(20)
})

test('stalls pause transport without mutating the spec', async () => {
  const spec = makeEditorSpec()
  const original = structuredClone(spec)
  const onStall = vi.fn()
  const media = fakeMediaElement(true)
  const controller = createTimelinePlaybackController({
    spec,
    mediaForClip: () => media,
    onTime: vi.fn(),
    onFrame: vi.fn(),
    onStall,
  })

  await expect(controller.play()).rejects.toThrow('stalled')

  expect(media.pause).toHaveBeenCalled()
  expect(onStall).toHaveBeenCalledWith('Video berhenti merespons.')
  expect(spec).toEqual(original)
})
