import { describe, expect, test } from 'vitest'
import {
  normalizeEditSpec,
  normalizeEditSpecV2,
  type TimelineContext,
} from '../src'

const context: TimelineContext = {
  candidateDuration: 30,
  sourceId: 'clip-1',
}

describe('normalizeEditSpecV2', () => {
  test('migrates v1 into linked video, audio, and caption tracks', () => {
    const legacy = normalizeEditSpec({
      crop: { focusX: 0.25 },
      captions: { fontSize: 88 },
    })

    const spec = normalizeEditSpecV2(legacy, context)

    expect(spec.version).toBe(2)
    expect(spec.crop.focusX).toBe(0.25)
    expect(spec.captions.fontSize).toBe(88)
    expect(spec.timeline.duration).toBe(30)
    expect(spec.timeline.tracks.map((track) => track.type)).toEqual([
      'video',
      'audio',
      'caption',
    ])
    expect(spec.timeline.tracks.flatMap((track) => track.clips)).toHaveLength(3)
    expect(
      new Set(
        spec.timeline.tracks.flatMap((track) =>
          track.clips.map((clip) => clip.linkGroupId),
        ),
      ),
    ).toEqual(new Set(['candidate-main']))
  })

  test('clamps source range and recomputes derived duration', () => {
    const spec = normalizeEditSpecV2(
      {
        version: 2,
        timeline: {
          primaryTrackId: 'video',
          duration: 999,
          tracks: [
            {
              id: 'video',
              type: 'video',
              name: 'Video',
              order: 0,
              hidden: false,
              locked: false,
              clips: [
                {
                  id: 'clip',
                  sourceId: 'clip-1',
                  linkGroupId: 'candidate-main',
                  timelineStart: -4,
                  sourceIn: -2,
                  sourceOut: 80,
                },
              ],
            },
          ],
        },
      },
      context,
    )

    expect(spec.timeline.duration).toBe(30)
    expect(spec.timeline.tracks[0]!.clips[0]).toMatchObject({
      timelineStart: 0,
      sourceIn: 0,
      sourceOut: 30,
    })
  })

  test('repairs malformed primary track without losing valid styling', () => {
    const spec = normalizeEditSpecV2(
      {
        version: 2,
        crop: { focusX: 0.8, zoom: 1.5 },
        captions: { activeColor: '#ff0000' },
        timeline: {
          primaryTrackId: 'missing',
          tracks: [],
        },
      },
      context,
    )

    expect(spec.timeline.primaryTrackId).toBe('clip-1:video')
    expect(spec.timeline.tracks[0]!.type).toBe('video')
    expect(spec.crop).toMatchObject({ focusX: 0.8, zoom: 1.5 })
    expect(spec.captions.activeColor).toBe('#FF0000')
  })
})
