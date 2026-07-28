import { describe, expect, test } from 'vitest'
import { applyTimelineCommand } from '../src'
import {
  context,
  primaryClip,
  primaryTrack,
  spec,
  withTrack,
} from './timelineFixtures'

describe('applyTimelineCommand', () => {
  test('trims a linked primary range non-destructively', () => {
    const result = applyTimelineCommand(
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

    expect(result.timeline.duration).toBe(26)
    expect(
      result.timeline.tracks.map((track) => track.clips[0]!.sourceIn),
    ).toEqual([4, 4, 4])
    expect(
      result.timeline.tracks.map((track) => track.clips[0]!.timelineStart),
    ).toEqual([0, 0, 0])
  })

  test('splits every linked track at the same output time', () => {
    const result = applyTimelineCommand(
      spec,
      {
        type: 'splitClip',
        trackId: primaryTrack.id,
        clipId: primaryClip.id,
        outputTime: 10,
      },
      context,
    )

    expect(result.timeline.tracks.map((track) => track.clips.length)).toEqual([
      2, 2, 2,
    ])
    expect(result.timeline.tracks[0]!.clips).toMatchObject([
      { timelineStart: 0, sourceIn: 0, sourceOut: 10 },
      { timelineStart: 10, sourceIn: 10, sourceOut: 30 },
    ])
    expect(
      result.timeline.tracks.map((track) =>
        track.clips.map((clip) => clip.linkGroupId),
      ),
    ).toEqual([
      ['candidate-main:left@10000', 'candidate-main:right@10000'],
      ['candidate-main:left@10000', 'candidate-main:right@10000'],
      ['candidate-main:left@10000', 'candidate-main:right@10000'],
    ])
  })

  test('deleting a primary segment ripples linked tracks', () => {
    const splitAtTen = applyTimelineCommand(
      spec,
      {
        type: 'splitClip',
        trackId: primaryTrack.id,
        clipId: primaryClip.id,
        outputTime: 10,
      },
      context,
    )
    const middle = splitAtTen.timeline.tracks[0]!.clips[1]!
    const splitAtTwenty = applyTimelineCommand(
      splitAtTen,
      {
        type: 'splitClip',
        trackId: primaryTrack.id,
        clipId: middle.id,
        outputTime: 20,
      },
      context,
    )
    const result = applyTimelineCommand(
      splitAtTwenty,
      {
        type: 'deleteClip',
        trackId: primaryTrack.id,
        clipId: splitAtTwenty.timeline.tracks[0]!.clips[1]!.id,
      },
      context,
    )

    expect(result.timeline.duration).toBe(20)
    for (const track of result.timeline.tracks) {
      expect(track.clips).toMatchObject([
        { timelineStart: 0, sourceIn: 0, sourceOut: 10 },
        { timelineStart: 10, sourceIn: 20, sourceOut: 30 },
      ])
    }
  })

  test('locked track rejects mutation', () => {
    const locked = withTrack(spec, primaryTrack.id, { locked: true })
    expect(
      applyTimelineCommand(
        locked,
        {
          type: 'trimClip',
          trackId: primaryTrack.id,
          clipId: primaryClip.id,
          edge: 'end',
          sourceTime: 12,
        },
        context,
      ),
    ).toEqual(locked)
  })

  test('cannot delete the final video track', () => {
    expect(
      applyTimelineCommand(
        spec,
        { type: 'deleteTrack', trackId: primaryTrack.id },
        context,
      ),
    ).toEqual(spec)
  })
})
