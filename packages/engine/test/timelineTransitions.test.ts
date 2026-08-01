import { describe, expect, test } from 'vitest'
import {
  applyTimelineCommand,
  evaluateTransitions,
  findTransitionJoints,
  normalizeEditSpecV3,
  normalizeTransitions,
  transitionWindow,
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

describe('transition frame evaluation', () => {
  const joint = 12

  test('cross dissolve blends both clips across a centered window', () => {
    expect(evaluateTransitions(specWithTransition, joint - 0.25)).toMatchObject({
      opacityByClipId: { [left!.id]: 1, [right!.id]: 0 },
      blackOpacity: 0,
    })
    expect(evaluateTransitions(specWithTransition, joint)).toMatchObject({
      opacityByClipId: { [left!.id]: 0.5, [right!.id]: 0.5 },
      blackOpacity: 0,
    })
    expect(evaluateTransitions(specWithTransition, joint + 0.25)).toMatchObject({
      opacityByClipId: { [left!.id]: 0, [right!.id]: 1 },
      blackOpacity: 0,
    })
    expect(transitionWindow(
      specWithTransition.timeline.transitions[0]!,
      specWithTransition,
      joint,
    )).toMatchObject({ start: 11.75, center: 12, end: 12.25, progress: 0.5 })
  })

  test.each([
    ['fade', 0.5, 0, 0, 0],
    ['dip-to-black', 0.5, 0, 0, 1],
  ] as const)('%s uses the approved midpoint envelope', (
    type,
    progress,
    fromOpacity,
    toOpacity,
    blackOpacity,
  ) => {
    const transitionSpec = {
      ...specWithTransition,
      timeline: {
        ...specWithTransition.timeline,
        transitions: [{
          ...specWithTransition.timeline.transitions[0]!,
          type,
        }],
      },
    }
    const time = joint - 0.25 + progress * 0.5
    expect(evaluateTransitions(transitionSpec, time)).toMatchObject({
      opacityByClipId: {
        [left!.id]: fromOpacity,
        [right!.id]: toOpacity,
      },
      blackOpacity,
    })
  })

  test('overlay edge transition changes only that clip opacity', () => {
    const edgeSpec = {
      ...specWithOverlay,
      timeline: {
        ...specWithOverlay.timeline,
        transitions: [overlayFadeIn],
      },
    }
    expect(evaluateTransitions(edgeSpec, 3)).toEqual({
      opacityByClipId: { 'overlay-clip': 0 },
      blackOpacity: 0,
    })
    expect(evaluateTransitions(edgeSpec, 3.25)).toEqual({
      opacityByClipId: { 'overlay-clip': 0.5 },
      blackOpacity: 0,
    })
    expect(evaluateTransitions(edgeSpec, 3.5)).toEqual({
      opacityByClipId: { 'overlay-clip': 1 },
      blackOpacity: 0,
    })
  })
})
