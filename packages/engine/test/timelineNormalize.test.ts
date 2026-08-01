import { describe, expect, test } from 'vitest'
import {
  createDefaultEditSpecV2,
  normalizeEditSpec,
  normalizeEditSpecV2,
  normalizeEditSpecV3,
  type TimelineContextV2,
} from '../src'
import { context as v3Context, malformedTransitionSpec } from './timelineFixtures'

const context: TimelineContextV2 = {
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

const assetContext = {
  candidateDuration: 30,
  sourceId: 'clip-1',
  candidateAssetId: 'asset-candidate',
  assets: {
    'asset-candidate': {
      id: 'asset-candidate',
      mediaType: 'video' as const,
      duration: 30,
      width: 1920,
      height: 1080,
      hasAudio: true,
    },
    'asset-image': {
      id: 'asset-image',
      mediaType: 'image' as const,
      duration: null,
      width: 800,
      height: 600,
      hasAudio: false,
    },
  },
}

describe('normalizeEditSpecV3', () => {
  test('migrates V2 sourceId to the authorized candidate asset', () => {
    const migrated = normalizeEditSpecV3(
      createDefaultEditSpecV2(context),
      assetContext,
    )

    expect(migrated.version).toBe(3)
    expect(migrated.timeline.tracks[0]!.clips[0]).toMatchObject({
      assetId: 'asset-candidate',
      muted: false,
      transform: { x: 0, y: 0, width: 1, height: 1 },
    })
    expect(migrated.captions.positionX).toBe(0.5)
    expect(migrated.timeline.transitions).toEqual([])
  })

  test('drops clips that reference assets outside the normalization context', () => {
    const normalized = normalizeEditSpecV3(
      {
        version: 3,
        timeline: {
          primaryTrackId: 'video',
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
                  id: 'foreign',
                  assetId: 'asset-bob',
                  timelineStart: 0,
                  sourceIn: 0,
                  sourceOut: 10,
                  muted: false,
                },
              ],
            },
          ],
        },
      },
      assetContext,
    )

    expect(normalized.timeline.tracks.flatMap((track) => track.clips))
      .not.toContainEqual(expect.objectContaining({ assetId: 'asset-bob' }))
    expect(normalized.timeline.tracks[0]!.clips[0]!.assetId).toBe('asset-candidate')
  })

  test('clamps global caption position and visual transforms idempotently', () => {
    const once = normalizeEditSpecV3(
      {
        version: 3,
        captions: { positionX: 9, positionY: -2 },
        timeline: {
          primaryTrackId: 'video',
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
                  id: 'image',
                  assetId: 'asset-image',
                  timelineStart: 0,
                  sourceIn: 0,
                  sourceOut: 5,
                  muted: false,
                  transform: { x: 9, y: -4, width: 0, height: 20 },
                },
              ],
            },
          ],
        },
      },
      assetContext,
    )
    const twice = normalizeEditSpecV3(once, assetContext)

    expect(once.captions).toMatchObject({ positionX: 0.95, positionY: 0.05 })
    expect(once.timeline.tracks[0]!.clips[0]!.transform).toEqual({
      x: 1,
      y: -1,
      width: 0.05,
      height: 2,
    })
    expect(twice).toEqual(once)
  })

  test('drops malformed transition targets idempotently', () => {
    const once = normalizeEditSpecV3(malformedTransitionSpec, v3Context)
    const twice = normalizeEditSpecV3(once, v3Context)

    expect(once.timeline.transitions).toEqual([])
    expect(twice).toEqual(once)
  })
})
