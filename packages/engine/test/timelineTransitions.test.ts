import { describe, expect, test } from 'vitest'
import {
  findTransitionJoints,
  normalizeEditSpecV3,
  normalizeTransitions,
} from '../src'
import {
  context,
  left,
  malformedTransitionSpec,
  overlayFadeIn,
  primaryClip,
  primaryFadeIn,
  primaryTrack,
  right,
  spec,
  specWithOverlay,
  splitSpec,
} from './timelineFixtures'

describe('transition target discovery and normalization', () => {
  test('an unsplit primary video has no between-clips transition joint', () => {
    expect(findTransitionJoints(spec)).toEqual([])
  })

  test('split primary video exposes one joint at the cut', () => {
    expect(findTransitionJoints(splitSpec)).toEqual([
      expect.objectContaining({
        trackId: primaryTrack.id,
        fromClipId: primaryClip.id,
        toClipId: `${primaryClip.id}:right@12000`,
        outputTime: 12,
        maxDuration: 2,
      }),
    ])
  })

  test('normalization drops a transition whose clips are no longer adjacent', () => {
    const normalized = normalizeEditSpecV3(malformedTransitionSpec, context)
    expect(normalized.timeline.transitions).toEqual([])
  })

  test('overlay visual clip accepts edge transition while primary clip does not', () => {
    expect(normalizeTransitions([overlayFadeIn], specWithOverlay)).toEqual([
      overlayFadeIn,
    ])
    expect(normalizeTransitions([primaryFadeIn], splitSpec)).toEqual([])
  })

  test('duplicate targets and IDs keep the first valid transition deterministically', () => {
    const first = {
      id: 'first',
      type: 'cross-dissolve' as const,
      duration: 8,
      target: {
        kind: 'between-clips' as const,
        trackId: primaryTrack.id,
        fromClipId: left!.id,
        toClipId: right!.id,
      },
    }
    const normalized = normalizeTransitions([
      first,
      { ...first, id: 'second', type: 'fade' },
      { ...first, target: { ...first.target, toClipId: 'missing' } },
    ], splitSpec)

    expect(normalized).toEqual([{ ...first, duration: 2 }])
  })
})
