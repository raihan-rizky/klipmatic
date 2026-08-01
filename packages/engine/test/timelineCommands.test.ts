import { describe, expect, test } from 'vitest'
import { applyTimelineCommand, type EditSpecV3 } from '../src'
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

  const findClip = (input: EditSpecV3, clipId: string) =>
    input.timeline.tracks.flatMap((track) => track.clips)
      .find((clip) => clip.id === clipId)

  test('inserts a five-second image at playhead with a centered transform', () => {
    const next = applyTimelineCommand(spec, {
      type: 'insertAsset',
      assetId: 'asset-image',
      trackId: 'overlay-images',
      trackName: 'Images',
      clipId: 'image-1',
      timelineStart: 8,
    }, context)

    expect(findClip(next, 'image-1')).toMatchObject({
      assetId: 'asset-image',
      timelineStart: 8,
      sourceIn: 0,
      sourceOut: 5,
      muted: false,
      transform: { x: 0.2, y: 0.2, width: 0.6, height: 0.6 },
    })
  })

  test('uploaded video inserts linked muted audio', () => {
    const next = applyTimelineCommand(spec, {
      type: 'insertAsset',
      assetId: 'asset-video',
      trackId: 'overlay-videos',
      trackName: 'Videos',
      clipId: 'video-1',
      timelineStart: 4,
      linkGroupId: 'upload-video-1',
      linkedAudio: {
        trackId: 'uploaded-audio',
        trackName: 'Uploaded audio',
        clipId: 'video-audio',
      },
    }, context)
    const linked = next.timeline.tracks.flatMap((track) => track.clips)
      .filter((clip) => clip.linkGroupId === 'upload-video-1')

    expect(linked).toHaveLength(2)
    expect(findClip(next, 'video-audio')).toMatchObject({
      assetId: 'asset-video',
      muted: true,
      timelineStart: 4,
      sourceOut: 9,
    })
  })

  test('updates visual transform and clip mute without mutating input', () => {
    const inserted = applyTimelineCommand(spec, {
      type: 'insertAsset',
      assetId: 'asset-image',
      trackId: 'overlay-images',
      trackName: 'Images',
      clipId: 'image-1',
      timelineStart: 3,
    }, context)
    const transformed = applyTimelineCommand(inserted, {
      type: 'updateVisualTransform',
      trackId: 'overlay-images',
      clipId: 'image-1',
      transform: { x: 0.1, y: 0.3, width: 0.4, height: 0.4 },
    }, context)
    const muted = applyTimelineCommand(transformed, {
      type: 'setClipMuted',
      trackId: 'overlay-images',
      clipId: 'image-1',
      muted: true,
    }, context)

    expect(findClip(inserted, 'image-1')!.transform).toEqual({
      x: 0.2, y: 0.2, width: 0.6, height: 0.6,
    })
    expect(findClip(muted, 'image-1')).toMatchObject({
      muted: true,
      transform: { x: 0.1, y: 0.3, width: 0.4, height: 0.4 },
    })
  })

  test('replaces an image without losing timing or transform', () => {
    const inserted = applyTimelineCommand(spec, {
      type: 'insertAsset',
      assetId: 'asset-image',
      trackId: 'overlay-images',
      trackName: 'Images',
      clipId: 'image-1',
      timelineStart: 8,
    }, context)
    const next = applyTimelineCommand(inserted, {
      type: 'replaceAsset',
      fromAssetId: 'asset-image',
      toAssetId: 'asset-image-replacement',
    }, context)

    expect(findClip(next, 'image-1')).toMatchObject({
      assetId: 'asset-image-replacement',
      timelineStart: 8,
      transform: { x: 0.2, y: 0.2, width: 0.6, height: 0.6 },
    })
  })

  test('moves non-primary clip and clamps it inside output duration', () => {
    const inserted = applyTimelineCommand(spec, {
      type: 'insertAsset',
      assetId: 'asset-audio',
      trackId: 'audio-effects',
      trackName: 'Audio effects',
      clipId: 'audio-1',
      timelineStart: 2,
    }, context)
    const next = applyTimelineCommand(inserted, {
      type: 'moveClip',
      trackId: 'audio-effects',
      clipId: 'audio-1',
      timelineStart: 99,
    }, context)

    expect(findClip(next, 'audio-1')!.timelineStart).toBe(18)
  })
})
