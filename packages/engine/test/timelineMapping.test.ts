import { describe, expect, test } from 'vitest'
import {
  applyTimelineCommand,
  buildAudioSchedule,
  buildFrameSchedule,
  mapOutputTime,
  mapWordsToTimeline,
} from '../src'
import { context, primaryClip, primaryTrack, spec } from './timelineFixtures'

describe('timeline mapping', () => {
  test('maps output time through a trimmed clip', () => {
    const trimmed = applyTimelineCommand(
      spec,
      {
        type: 'trimClip',
        trackId: primaryTrack.id,
        clipId: primaryClip.id,
        edge: 'start',
        sourceTime: 4,
      },
      context,
    )

    expect(mapOutputTime(trimmed, 7)[0]).toMatchObject({
      sourceTime: 11,
      outputTime: 7,
      trackType: 'video',
    })
  })

  test('builds one frame per configured frame-rate tick', () => {
    const trimmed = applyTimelineCommand(
      spec,
      {
        type: 'trimClip',
        trackId: primaryTrack.id,
        clipId: primaryClip.id,
        edge: 'end',
        sourceTime: 20,
      },
      context,
    )
    const frames = buildFrameSchedule(trimmed)

    expect(frames).toHaveLength(600)
    expect(frames[0]).toEqual({ index: 0, outputTime: 0, duration: 1 / 30 })
    expect(frames.at(-1)!.outputTime).toBeCloseTo(599 / 30)
  })

  test('builds gapless audio ranges after ripple', () => {
    const first = applyTimelineCommand(
      spec,
      {
        type: 'splitClip',
        trackId: primaryTrack.id,
        clipId: primaryClip.id,
        outputTime: 10,
      },
      context,
    )
    const second = applyTimelineCommand(
      first,
      {
        type: 'splitClip',
        trackId: primaryTrack.id,
        clipId: first.timeline.tracks[0]!.clips[1]!.id,
        outputTime: 20,
      },
      context,
    )
    const rippled = applyTimelineCommand(
      second,
      {
        type: 'deleteClip',
        trackId: primaryTrack.id,
        clipId: second.timeline.tracks[0]!.clips[1]!.id,
      },
      context,
    )

    expect(buildAudioSchedule(rippled)).toMatchObject([
      { outputStart: 0, sourceIn: 0, sourceOut: 10 },
      { outputStart: 10, sourceIn: 20, sourceOut: 30 },
    ])
  })

  test('clips and rebases caption words into output time', () => {
    const trimmed = applyTimelineCommand(
      spec,
      {
        type: 'trimClip',
        trackId: primaryTrack.id,
        clipId: primaryClip.id,
        edge: 'start',
        sourceTime: 4,
      },
      context,
    )

    expect(
      mapWordsToTimeline(
        [
          { text: 'before', start: 2, end: 3 },
          { text: 'hello', start: 5, end: 6 },
        ],
        trimmed,
      ),
    ).toEqual([{ text: 'hello', start: 1, end: 2 }])
  })
})
