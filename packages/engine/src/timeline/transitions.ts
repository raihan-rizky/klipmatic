import type {
  EditSpecV3,
  TimelineClip,
  TransitionFrameState,
  TransitionWindow,
  TimelineTransition,
  TimelineTrack,
} from './types'

export const TRANSITION_TYPES = [
  'fade',
  'cross-dissolve',
  'dip-to-black',
] as const

export const DEFAULT_TRANSITION_DURATION = 0.5
export const MAX_TRANSITION_DURATION = 2

export interface TransitionJoint {
  trackId: string
  fromClipId: string
  toClipId: string
  outputTime: number
  maxDuration: number
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function clipDuration(clip: TimelineClip): number {
  return clip.sourceOut - clip.sourceIn
}

function clipEnd(clip: TimelineClip): number {
  return clip.timelineStart + clipDuration(clip)
}

function primaryTrack(spec: EditSpecV3): TimelineTrack | undefined {
  return spec.timeline.tracks.find(
    (track) =>
      track.id === spec.timeline.primaryTrackId && track.type === 'video',
  )
}

export function findTransitionJoints(spec: EditSpecV3): TransitionJoint[] {
  const track = primaryTrack(spec)
  if (!track || track.clips.length < 2) return []
  const frameDuration = 1 / spec.output.frameRate
  const clips = [...track.clips].sort(
    (left, right) =>
      left.timelineStart - right.timelineStart || left.id.localeCompare(right.id),
  )
  const joints: TransitionJoint[] = []

  for (let index = 1; index < clips.length; index += 1) {
    const from = clips[index - 1]!
    const to = clips[index]!
    if (Math.abs(clipEnd(from) - to.timelineStart) > frameDuration + 1e-9) {
      continue
    }
    joints.push({
      trackId: track.id,
      fromClipId: from.id,
      toClipId: to.id,
      outputTime: to.timelineStart,
      maxDuration: Math.min(
        MAX_TRANSITION_DURATION,
        clipDuration(from),
        clipDuration(to),
      ),
    })
  }

  return joints
}

function edgeClip(
  spec: EditSpecV3,
  clipId: string,
): { clip: TimelineClip; track: TimelineTrack; maxDuration: number } | null {
  for (const track of spec.timeline.tracks) {
    if (track.type !== 'video' || track.id === spec.timeline.primaryTrackId) continue
    const clip = track.clips.find((candidate) => candidate.id === clipId)
    if (clip) {
      return {
        clip,
        track,
        maxDuration: Math.min(MAX_TRANSITION_DURATION, clipDuration(clip)),
      }
    }
  }
  return null
}

export function transitionTargetKey(target: TimelineTransition['target']): string {
  return target.kind === 'between-clips'
    ? `between:${target.trackId}:${target.fromClipId}:${target.toClipId}`
    : `edge:${target.clipId}:${target.edge}`
}

export function normalizeTransitions(
  input: unknown,
  specWithoutTransitions: EditSpecV3,
): TimelineTransition[] {
  if (!Array.isArray(input)) return []
  const frameDuration = 1 / specWithoutTransitions.output.frameRate
  const joints = findTransitionJoints(specWithoutTransitions)
  const usedIds = new Set<string>()
  const usedTargets = new Set<string>()
  const output: TimelineTransition[] = []

  for (const value of input.slice(0, 500)) {
    const raw = record(value)
    if (
      typeof raw.id !== 'string' ||
      !raw.id.trim() ||
      usedIds.has(raw.id.trim()) ||
      !TRANSITION_TYPES.includes(raw.type as (typeof TRANSITION_TYPES)[number])
    ) {
      continue
    }
    const rawTarget = record(raw.target)
    let target: TimelineTransition['target']
    let maxDuration: number

    if (rawTarget.kind === 'between-clips') {
      if (
        typeof rawTarget.trackId !== 'string' ||
        typeof rawTarget.fromClipId !== 'string' ||
        typeof rawTarget.toClipId !== 'string'
      ) {
        continue
      }
      const joint = joints.find(
        (candidate) =>
          candidate.trackId === rawTarget.trackId &&
          candidate.fromClipId === rawTarget.fromClipId &&
          candidate.toClipId === rawTarget.toClipId,
      )
      if (!joint) continue
      target = {
        kind: 'between-clips',
        trackId: joint.trackId,
        fromClipId: joint.fromClipId,
        toClipId: joint.toClipId,
      }
      maxDuration = joint.maxDuration
    } else if (
      rawTarget.kind === 'clip-edge' &&
      typeof rawTarget.clipId === 'string' &&
      (rawTarget.edge === 'in' || rawTarget.edge === 'out')
    ) {
      const found = edgeClip(specWithoutTransitions, rawTarget.clipId)
      if (!found) continue
      target = {
        kind: 'clip-edge',
        clipId: found.clip.id,
        edge: rawTarget.edge,
      }
      maxDuration = found.maxDuration
    } else {
      continue
    }

    const key = transitionTargetKey(target)
    const id = raw.id.trim().slice(0, 120)
    if (!id || usedIds.has(id) || usedTargets.has(key)) continue
    const requestedDuration = Number(raw.duration)
    const duration = Math.min(
      Math.max(
        Number.isFinite(requestedDuration)
          ? requestedDuration
          : DEFAULT_TRANSITION_DURATION,
        frameDuration,
      ),
      maxDuration,
    )
    usedIds.add(id)
    usedTargets.add(key)
    output.push({
      id,
      type: raw.type as TimelineTransition['type'],
      duration,
      target,
    })
  }

  return output
}

export function reconcileTransitions(spec: EditSpecV3): EditSpecV3 {
  const transitions = normalizeTransitions(spec.timeline.transitions, spec)
  return JSON.stringify(transitions) === JSON.stringify(spec.timeline.transitions)
    ? spec
    : {
        ...spec,
        timeline: { ...spec.timeline, transitions },
      }
}

function transitionCenter(
  transition: TimelineTransition,
  spec: EditSpecV3,
): { center: number; start: number; end: number } | null {
  if (transition.target.kind === 'between-clips') {
    const target = transition.target
    const joint = findTransitionJoints(spec).find(
      (candidate) =>
        candidate.trackId === target.trackId &&
        candidate.fromClipId === target.fromClipId &&
        candidate.toClipId === target.toClipId,
    )
    if (!joint) return null
    return {
      center: joint.outputTime,
      start: joint.outputTime - transition.duration / 2,
      end: joint.outputTime + transition.duration / 2,
    }
  }

  const found = edgeClip(spec, transition.target.clipId)
  if (!found) return null
  const clipStart = found.clip.timelineStart
  const clipEndTime = clipEnd(found.clip)
  if (transition.target.edge === 'in') {
    return {
      center: clipStart + transition.duration / 2,
      start: clipStart,
      end: clipStart + transition.duration,
    }
  }
  return {
    center: clipEndTime - transition.duration / 2,
    start: clipEndTime - transition.duration,
    end: clipEndTime,
  }
}

export function transitionWindow(
  transition: TimelineTransition,
  spec: EditSpecV3,
  outputTime?: number,
): TransitionWindow | null {
  const range = transitionCenter(transition, spec)
  if (!range) return null
  const time = outputTime ?? range.center
  return {
    ...range,
    progress: Math.min(
      1,
      Math.max(0, (time - range.start) / Math.max(range.end - range.start, 1e-9)),
    ),
  }
}

function applyOpacity(
  output: Record<string, number>,
  clipId: string,
  opacity: number,
): void {
  output[clipId] = (output[clipId] ?? 1) * opacity
}

export function evaluateTransitions(
  spec: EditSpecV3,
  outputTime: number,
): TransitionFrameState {
  const state: TransitionFrameState = {
    opacityByClipId: {},
    blackOpacity: 0,
  }

  for (const transition of spec.timeline.transitions) {
    const window = transitionWindow(transition, spec, outputTime)
    if (
      !window ||
      outputTime < window.start - 1e-9 ||
      outputTime > window.end + 1e-9
    ) {
      continue
    }
    const progress = window.progress
    if (transition.target.kind === 'clip-edge') {
      applyOpacity(
        state.opacityByClipId,
        transition.target.clipId,
        transition.target.edge === 'in' ? progress : 1 - progress,
      )
      continue
    }

    let fromOpacity: number
    let toOpacity: number
    let blackOpacity = 0
    if (transition.type === 'cross-dissolve') {
      fromOpacity = 1 - progress
      toOpacity = progress
    } else if (transition.type === 'fade') {
      fromOpacity = 1 - Math.min(2 * progress, 1)
      toOpacity = Math.max(2 * progress - 1, 0)
    } else {
      fromOpacity = progress < 0.4 ? 1 - progress / 0.4 : 0
      toOpacity = progress > 0.6 ? (progress - 0.6) / 0.4 : 0
      blackOpacity = progress < 0.4
        ? progress / 0.4
        : progress <= 0.6
          ? 1
          : (1 - progress) / 0.4
    }
    applyOpacity(
      state.opacityByClipId,
      transition.target.fromClipId,
      fromOpacity,
    )
    applyOpacity(
      state.opacityByClipId,
      transition.target.toClipId,
      toOpacity,
    )
    state.blackOpacity = Math.max(state.blackOpacity, blackOpacity)
  }

  return state
}
