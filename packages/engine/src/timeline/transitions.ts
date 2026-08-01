import type {
  EditSpecV3,
  TimelineClip,
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

function targetKey(target: TimelineTransition['target']): string {
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

    const key = targetKey(target)
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
