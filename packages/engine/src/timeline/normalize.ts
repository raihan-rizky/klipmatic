import { normalizeEditSpec } from '../types'
import { createDefaultEditSpecV2 } from './defaults'
import type {
  EditSpecV2,
  TimelineClip,
  TimelineContext,
  TimelineTrack,
  TrackType,
} from './types'

const TRACK_TYPES = new Set<TrackType>(['video', 'audio', 'caption'])
const TRACK_NAMES: Record<TrackType, string> = {
  video: 'Video',
  audio: 'Audio',
  caption: 'Caption',
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function finite(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function safeId(value: unknown, fallback: string, used: Set<string>): string {
  const candidate =
    typeof value === 'string' && value.trim() ? value.trim().slice(0, 120) : fallback
  let result = candidate
  let suffix = 2
  while (used.has(result)) {
    result = `${candidate}-${suffix}`
    suffix += 1
  }
  used.add(result)
  return result
}

function normalizeClips(
  input: unknown,
  trackId: string,
  context: TimelineContext,
  usedClipIds: Set<string>,
): TimelineClip[] {
  if (!Array.isArray(input)) return []
  const minimumDuration = 1 / 30
  return input.slice(0, 500).flatMap((value, index) => {
    const clip = record(value)
    const sourceIn = clamp(finite(clip.sourceIn, 0), 0, context.candidateDuration)
    const sourceOut = clamp(
      finite(clip.sourceOut, context.candidateDuration),
      0,
      context.candidateDuration,
    )
    if (sourceOut - sourceIn < minimumDuration) return []
    const linkGroupId =
      typeof clip.linkGroupId === 'string' && clip.linkGroupId.trim()
        ? clip.linkGroupId.trim().slice(0, 120)
        : undefined
    return [{
      id: safeId(clip.id, `${trackId}:clip-${index + 1}`, usedClipIds),
      sourceId: context.sourceId,
      ...(linkGroupId ? { linkGroupId } : {}),
      timelineStart: Math.max(0, finite(clip.timelineStart, 0)),
      sourceIn,
      sourceOut,
    }]
  })
}

function normalizeTracks(
  input: unknown,
  context: TimelineContext,
): TimelineTrack[] {
  if (!Array.isArray(input)) return []
  const usedTrackIds = new Set<string>()
  const usedClipIds = new Set<string>()
  return input.slice(0, 50).flatMap((value, index) => {
    const track = record(value)
    if (!TRACK_TYPES.has(track.type as TrackType)) return []
    const type = track.type as TrackType
    const id = safeId(track.id, `${context.sourceId}:${type}-${index + 1}`, usedTrackIds)
    const name =
      typeof track.name === 'string' && track.name.trim()
        ? track.name.trim().slice(0, 80)
        : TRACK_NAMES[type]
    return [{
      id,
      type,
      name,
      order: Math.max(0, Math.round(finite(track.order, index))),
      hidden: track.hidden === true,
      locked: track.locked === true,
      clips: normalizeClips(track.clips, id, context, usedClipIds),
    }]
  }).sort((left, right) => left.order - right.order)
    .map((track, order) => ({ ...track, order }))
}

function isVersionTwo(input: unknown): boolean {
  return record(input).version === 2
}

export function normalizeEditSpecV2(
  input: unknown,
  context: TimelineContext,
): EditSpecV2 {
  const safeContext: TimelineContext = {
    sourceId: context.sourceId || 'candidate',
    candidateDuration: Math.max(1 / 30, finite(context.candidateDuration, 1 / 30)),
  }
  if (!isVersionTwo(input)) {
    return createDefaultEditSpecV2(safeContext, normalizeEditSpec(input))
  }

  const root = record(input)
  const timeline = record(root.timeline)
  let tracks = normalizeTracks(timeline.tracks, safeContext)
  if (!tracks.some((track) => track.type === 'video')) {
    const fallback = createDefaultEditSpecV2(safeContext, normalizeEditSpec(input))
    tracks = [...fallback.timeline.tracks]
  }

  const requestedPrimary =
    typeof timeline.primaryTrackId === 'string' ? timeline.primaryTrackId : ''
  const primary =
    tracks.find((track) => track.id === requestedPrimary && track.type === 'video') ??
    tracks.find((track) => track.type === 'video')!
  const styling = normalizeEditSpec(input)
  const duration = primary.clips.reduce(
    (end, clip) =>
      Math.max(end, clip.timelineStart + clip.sourceOut - clip.sourceIn),
    0,
  )

  return {
    version: 2,
    output: styling.output,
    crop: styling.crop,
    captions: styling.captions,
    timeline: {
      primaryTrackId: primary.id,
      duration,
      tracks,
    },
  }
}
