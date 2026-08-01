import { describe, expect, test } from 'vitest'
import {
  applyTimelineCommand,
  buildAudioSchedule,
  buildFrameSchedule,
  mapOutputTime,
  mapWordsToTimeline,
} from '../src'
import { context, primaryClip, primaryTrack, spec } from './timelineFixtures'
import {
  left,
  right,
  specWithTransition,
} from './timelineFixtures'

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

    expect(mapOutputTime(trimmed, 7, context)[0]).toMatchObject({
      assetId: 'asset-candidate',
      mediaType: 'video',
      muted: false,
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

  test('maps active image metadata and excludes muted audio from schedule', () => {
    const withImage = applyTimelineCommand(spec, {
      type: 'insertAsset',
      assetId: 'asset-image',
      trackId: 'overlay-images',
      trackName: 'Images',
      clipId: 'image-1',
      timelineStart: 4,
    }, context)
    const withAudio = applyTimelineCommand(withImage, {
      type: 'insertAsset',
      assetId: 'asset-audio',
      trackId: 'audio-effects',
      trackName: 'Audio effects',
      clipId: 'audio-1',
      timelineStart: 4,
    }, context)
    const muted = applyTimelineCommand(withAudio, {
      type: 'setClipMuted',
      trackId: 'audio-effects',
      clipId: 'audio-1',
      muted: true,
    }, context)

    expect(mapOutputTime(muted, 5, context)).toContainEqual(
      expect.objectContaining({
        clipId: 'image-1',
        mediaType: 'image',
        transform: { x: 0.2, y: 0.2, width: 0.6, height: 0.6 },
      }),
    )
    expect(buildAudioSchedule(muted)).not.toContainEqual(
      expect.objectContaining({ clipId: 'audio-1' }),
    )
  })

  test('maps both transition participants and uses available source handles', () => {
    const active = mapOutputTime(specWithTransition, 11.8, context)
    const incoming = active.find((item) => item.clipId === right!.id)!

    expect(active.map((item) => item.clipId)).toEqual(expect.arrayContaining([
      left!.id,
      right!.id,
    ]))
    expect(incoming.sourceTime).toBeCloseTo(11.8)
    expect(incoming.transitionParticipant).toBe(true)
  })

  test('missing source handle holds the nearest boundary frame', () => {
    const boundarySpec = {
      ...specWithTransition,
      timeline: {
        ...specWithTransition.timeline,
        tracks: specWithTransition.timeline.tracks.map((track) =>
          track.id === specWithTransition.timeline.primaryTrackId
            ? {
                ...track,
                clips: track.clips.map((clip) =>
                  clip.id === right!.id
                    ? { ...clip, sourceIn: 0, sourceOut: 18 }
                    : clip,
                ),
              }
            : track,
        ),
      },
    }
    const active = mapOutputTime(boundarySpec, 11.8, context)
    const incoming = active.find((item) => item.clipId === right!.id)!

    expect(incoming.sourceTime).toBe(0)
    expect(incoming.transitionParticipant).toBe(true)
  })

  test('one frame outside a transition window keeps normal mapping', () => {
    const active = mapOutputTime(specWithTransition, 11.7, context)
    expect(active.filter((item) => item.trackType === 'video')).toHaveLength(1)
    expect(active[0]!.clipId).toBe(left!.id)
  })
})
