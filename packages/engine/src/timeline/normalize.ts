import { normalizeEditSpec } from '../types'
import { createDefaultEditSpecV2, createDefaultEditSpecV3 } from './defaults'
import { normalizeTransitions } from './transitions'
import type {
  EditSpecV2,
  EditSpecV3,
  TimelineAssetContext,
  TimelineClip,
  TimelineClipV2,
  TimelineContext,
  TimelineContextV2,
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
  context: TimelineContextV2,
  usedClipIds: Set<string>,
): TimelineClipV2[] {
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
  context: TimelineContextV2,
): TimelineTrack<TimelineClipV2>[] {
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
  context: TimelineContextV2,
): EditSpecV2 {
  const safeContext: TimelineContextV2 = {
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

function isVersionThree(input: unknown): boolean {
  return record(input).version === 3
}

function normalizeTransform(value: unknown): TimelineClip['transform'] {
  const transform = record(value)
  return {
    x: clamp(finite(transform.x, 0), -1, 1),
    y: clamp(finite(transform.y, 0), -1, 1),
    width: clamp(finite(transform.width, 1), 0.05, 2),
    height: clamp(finite(transform.height, 1), 0.05, 2),
  }
}

function safeV3Context(context: TimelineContext): TimelineContext {
  const sourceId = context.sourceId || 'candidate'
  const candidateDuration = Math.max(
    1 / 30,
    finite(context.candidateDuration, 1 / 30),
  )
  const candidateAssetId = context.candidateAssetId || `${sourceId}:asset`
  const assets = { ...(context.assets ?? {}) }
  if (!assets[candidateAssetId]) {
    assets[candidateAssetId] = {
      id: candidateAssetId,
      mediaType: 'video',
      duration: candidateDuration,
      width: null,
      height: null,
      hasAudio: true,
    }
  }
  return { sourceId, candidateDuration, candidateAssetId, assets }
}

function assetDuration(
  asset: TimelineAssetContext,
  context: TimelineContext,
): number {
  if (asset.mediaType === 'image') return 5
  return Math.max(1 / 30, finite(asset.duration, context.candidateDuration))
}

function assetAllowedOnTrack(
  asset: TimelineAssetContext,
  trackType: TrackType,
): boolean {
  if (trackType === 'video') return asset.mediaType !== 'audio'
  if (trackType === 'audio') {
    return asset.mediaType === 'audio' || (asset.mediaType === 'video' && asset.hasAudio)
  }
  return true
}

function normalizeClipsV3(
  input: unknown,
  trackId: string,
  trackType: TrackType,
  context: TimelineContext,
  usedClipIds: Set<string>,
  migrateV2: boolean,
): TimelineClip[] {
  if (!Array.isArray(input)) return []
  const minimumDuration = 1 / 30
  return input.slice(0, 500).flatMap((value, index) => {
    const clip = record(value)
    const assetId = migrateV2
      ? context.candidateAssetId
      : typeof clip.assetId === 'string'
        ? clip.assetId
        : ''
    const asset = context.assets[assetId]
    if (!asset || !assetAllowedOnTrack(asset, trackType)) return []
    const maximumDuration = assetDuration(asset, context)
    const sourceIn = clamp(finite(clip.sourceIn, 0), 0, maximumDuration)
    const sourceOut = clamp(
      finite(clip.sourceOut, maximumDuration),
      0,
      maximumDuration,
    )
    if (sourceOut - sourceIn < minimumDuration) return []
    const linkGroupId =
      typeof clip.linkGroupId === 'string' && clip.linkGroupId.trim()
        ? clip.linkGroupId.trim().slice(0, 120)
        : undefined
    return [{
      id: safeId(clip.id, `${trackId}:clip-${index + 1}`, usedClipIds),
      assetId,
      ...(linkGroupId ? { linkGroupId } : {}),
      timelineStart: Math.max(0, finite(clip.timelineStart, 0)),
      sourceIn,
      sourceOut,
      muted: clip.muted === true,
      ...(trackType === 'video'
        ? { transform: normalizeTransform(clip.transform) }
        : {}),
    }]
  })
}

function normalizeTracksV3(
  input: unknown,
  context: TimelineContext,
  migrateV2: boolean,
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
      clips: normalizeClipsV3(
        track.clips,
        id,
        type,
        context,
        usedClipIds,
        migrateV2,
      ),
    }]
  }).sort((left, right) => left.order - right.order)
    .map((track, order) => ({ ...track, order }))
}

export function normalizeEditSpecV3(
  input: unknown,
  context: TimelineContext,
): EditSpecV3 {
  const safeContext = safeV3Context(context)
  const migrateV2 = isVersionTwo(input)
  if (!migrateV2 && !isVersionThree(input)) {
    return createDefaultEditSpecV3(safeContext, normalizeEditSpec(input))
  }

  const root = record(input)
  const timeline = record(root.timeline)
  let tracks = normalizeTracksV3(timeline.tracks, safeContext, migrateV2)
  if (!tracks.some((track) => track.type === 'video' && track.clips.length > 0)) {
    tracks = createDefaultEditSpecV3(
      safeContext,
      normalizeEditSpec(input),
    ).timeline.tracks
  }

  const requestedPrimary =
    typeof timeline.primaryTrackId === 'string' ? timeline.primaryTrackId : ''
  const primary =
    tracks.find(
      (track) =>
        track.id === requestedPrimary &&
        track.type === 'video' &&
        track.clips.length > 0,
    ) ?? tracks.find((track) => track.type === 'video' && track.clips.length > 0)!
  const duration = primary.clips.reduce(
    (end, clip) => Math.max(end, clip.timelineStart + clip.sourceOut - clip.sourceIn),
    0,
  )
  const styling = normalizeEditSpec(input)
  const rawCaptions = record(root.captions)

  const normalized: EditSpecV3 = {
    version: 3,
    output: styling.output,
    crop: styling.crop,
    captions: {
      ...styling.captions,
      positionX: clamp(finite(rawCaptions.positionX, 0.5), 0.05, 0.95),
      positionY: clamp(
        finite(rawCaptions.positionY, styling.captions.positionY),
        0.05,
        0.95,
      ),
    },
    timeline: {
      primaryTrackId: primary.id,
      duration,
      tracks,
      transitions: [],
    },
  }
  return {
    ...normalized,
    timeline: {
      ...normalized.timeline,
      transitions: normalizeTransitions(timeline.transitions, normalized),
    },
  }
}
