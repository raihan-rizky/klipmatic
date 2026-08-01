import { describe, expect, test } from 'vitest'
import {
  applyTimelineCommand,
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
  specWithTransition,
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

describe('transition commands', () => {
  test('adds cross dissolve only to a valid split joint without changing duration', () => {
    const next = applyTimelineCommand(splitSpec, {
      type: 'addTransition',
      transition: specWithTransition.timeline.transitions[0]!,
    }, context)

    expect(next.timeline.transitions).toEqual(specWithTransition.timeline.transitions)
    expect(next.timeline.duration).toBe(splitSpec.timeline.duration)
    expect(applyTimelineCommand(spec, {
      type: 'addTransition',
      transition: specWithTransition.timeline.transitions[0]!,
    }, context)).toBe(spec)
  })

  test('adding to an occupied target replaces it atomically', () => {
    const next = applyTimelineCommand(specWithTransition, {
      type: 'addTransition',
      transition: {
        ...specWithTransition.timeline.transitions[0]!,
        id: 'replacement',
        type: 'dip-to-black',
        duration: 1,
      },
    }, context)

    expect(next.timeline.transitions).toEqual([
      expect.objectContaining({
        id: 'replacement',
        type: 'dip-to-black',
        duration: 1,
      }),
    ])
  })

  test('updates and deletes a transition with target-aware duration clamping', () => {
    const updated = applyTimelineCommand(specWithTransition, {
      type: 'updateTransition',
      transitionId: 'transition-1',
      patch: { type: 'fade', duration: 20 },
    }, context)
    expect(updated.timeline.transitions[0]).toMatchObject({
      type: 'fade',
      duration: 2,
    })

    const deleted = applyTimelineCommand(updated, {
      type: 'deleteTransition',
      transitionId: 'transition-1',
    }, context)
    expect(deleted.timeline.transitions).toEqual([])
    expect(applyTimelineCommand(deleted, {
      type: 'deleteTransition',
      transitionId: 'transition-1',
    }, context)).toBe(deleted)
  })

  test('moving one joint clip removes its transition in the same command', () => {
    const moved = applyTimelineCommand(specWithTransition, {
      type: 'moveClip',
      trackId: primaryTrack.id,
      clipId: right!.id,
      timelineStart: right!.timelineStart + 1,
    }, context)

    expect(moved.timeline.transitions).toEqual([])
    expect(moved.timeline.tracks[0]!.clips[1]!.timelineStart).toBe(13)
  })
})
