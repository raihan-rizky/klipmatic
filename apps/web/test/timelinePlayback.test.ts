import { expect, test, vi } from 'vitest'
import type { EditSpecV3 } from '@cheapclipper/engine'
import {
  createTimelinePlaybackController,
  type PlaybackMedia,
} from '@/components/editor/timelinePlayback'
import { editorContext, makeEditorSpec } from './editorFixtures'

function makeCutSpec(): EditSpecV3 {
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

function makeTransitionSpec(): EditSpecV3 {
  const source = makeCutSpec()
  return {
    ...source,
    timeline: {
      ...source.timeline,
      transitions: [{
        id: 'transition-1',
        type: 'cross-dissolve',
        duration: 0.5,
        target: {
          kind: 'between-clips',
          trackId: source.timeline.primaryTrackId,
          fromClipId: 'left',
          toClipId: 'right',
        },
      }],
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

test('playback keeps a muted linked audio clip silent', async () => {
  const source = makeEditorSpec()
  const spec: EditSpecV3 = {
    ...source,
    timeline: {
      ...source.timeline,
      tracks: source.timeline.tracks.map((track) =>
        track.type === 'audio'
          ? {
              ...track,
              clips: track.clips.map((clip) => ({ ...clip, muted: true })),
            }
          : track,
      ),
    },
  }
  const visual = fakeMediaElement()
  const linkedAudio = fakeMediaElement()
  const controller = createTimelinePlaybackController({
    spec,
    mediaForClip: (item) => item.trackType === 'audio' ? linkedAudio : visual,
    onTime: vi.fn(),
    onFrame: vi.fn(),
    onStall: vi.fn(),
  })

  await controller.play()

  expect(linkedAudio.muted).toBe(true)
  expect(linkedAudio.pause).toHaveBeenCalled()
  expect(linkedAudio.play).not.toHaveBeenCalled()
  expect(visual.play).toHaveBeenCalled()
})

test('preview requests both split clips at transition midpoint', async () => {
  const media = new Map<string, PlaybackMedia>()
  const mediaForClip = vi.fn((item: { clipId: string }) => {
    const existing = media.get(item.clipId)
    if (existing) return existing
    const created = fakeMediaElement()
    media.set(item.clipId, created)
    return created
  })
  const controller = createTimelinePlaybackController({
    spec: makeTransitionSpec(),
    context: editorContext,
    mediaForClip,
    onTime: vi.fn(),
    onFrame: vi.fn(),
    onStall: vi.fn(),
  })

  await controller.seek(10)

  expect(mediaForClip).toHaveBeenCalledWith(expect.objectContaining({ clipId: 'left' }))
  expect(mediaForClip).toHaveBeenCalledWith(expect.objectContaining({ clipId: 'right' }))
})
