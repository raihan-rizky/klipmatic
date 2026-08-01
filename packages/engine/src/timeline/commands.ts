import { normalizeEditSpecV3 } from './normalize'
import type {
  AssetTimelineCommand,
  EditSpecV3,
  TimelineClip,
  TimelineCommand,
  TimelineContext,
  TimelineTrack,
  VisualTransform,
} from './types'

function findTrack(spec: EditSpecV3, trackId: string): TimelineTrack | undefined {
  return spec.timeline.tracks.find((track) => track.id === trackId)
}

function findClip(track: TimelineTrack, clipId: string): TimelineClip | undefined {
  return track.clips.find((clip) => clip.id === clipId)
}

function replaceTracks(
  spec: EditSpecV3,
  tracks: TimelineTrack[],
  primaryTrackId = spec.timeline.primaryTrackId,
): EditSpecV3 {
  return {
    ...spec,
    timeline: { ...spec.timeline, primaryTrackId, tracks },
  }
}

function linkedClipIds(spec: EditSpecV3, linkGroupId?: string): Set<string> {
  if (!linkGroupId) return new Set()
  return new Set(
    spec.timeline.tracks.flatMap((track) =>
      track.clips
        .filter((clip) => clip.linkGroupId === linkGroupId)
        .map((clip) => clip.id),
    ),
  )
}

function trim(
  spec: EditSpecV3,
  command: Extract<TimelineCommand, { type: 'trimClip' }>,
): EditSpecV3 {
  const track = findTrack(spec, command.trackId)
  const selected = track && findClip(track, command.clipId)
  if (!track || !selected || track.locked) return spec
  const sourceTime = Math.min(
    Math.max(command.sourceTime, 0),
    selected.sourceOut,
  )
  if (
    (command.edge === 'start' && sourceTime >= selected.sourceOut) ||
    (command.edge === 'end' && sourceTime <= selected.sourceIn)
  ) return spec

  const primary = track.id === spec.timeline.primaryTrackId
  const targets = primary
    ? linkedClipIds(spec, selected.linkGroupId)
    : new Set([selected.id])
  const oldDuration = selected.sourceOut - selected.sourceIn
  const newDuration =
    command.edge === 'start'
      ? selected.sourceOut - sourceTime
      : sourceTime - selected.sourceIn
  const oldEnd = selected.timelineStart + oldDuration
  const delta = newDuration - oldDuration

  return replaceTracks(
    spec,
    spec.timeline.tracks.map((candidateTrack) => ({
      ...candidateTrack,
      clips: candidateTrack.clips.map((clip) => {
        if (targets.has(clip.id)) {
          return command.edge === 'start'
            ? { ...clip, sourceIn: sourceTime }
            : { ...clip, sourceOut: sourceTime }
        }
        if (primary && clip.timelineStart >= oldEnd) {
          return { ...clip, timelineStart: clip.timelineStart + delta }
        }
        return clip
      }),
    })),
  )
}

function split(
  spec: EditSpecV3,
  command: Extract<TimelineCommand, { type: 'splitClip' }>,
): EditSpecV3 {
  const track = findTrack(spec, command.trackId)
  const selected = track && findClip(track, command.clipId)
  if (!track || !selected || track.locked) return spec
  const selectedEnd =
    selected.timelineStart + selected.sourceOut - selected.sourceIn
  if (
    command.outputTime <= selected.timelineStart ||
    command.outputTime >= selectedEnd
  ) return spec

  const primary = track.id === spec.timeline.primaryTrackId
  const targets = primary
    ? linkedClipIds(spec, selected.linkGroupId)
    : new Set([selected.id])
  const marker = Math.round(command.outputTime * 1000)
  const baseGroup = selected.linkGroupId ?? selected.id
  const leftGroup = `${baseGroup}:left@${marker}`
  const rightGroup = `${baseGroup}:right@${marker}`

  return replaceTracks(
    spec,
    spec.timeline.tracks.map((candidateTrack) => ({
      ...candidateTrack,
      clips: candidateTrack.clips.flatMap((clip) => {
        if (!targets.has(clip.id)) return [clip]
        const sourceTime =
          clip.sourceIn + command.outputTime - clip.timelineStart
        if (sourceTime <= clip.sourceIn || sourceTime >= clip.sourceOut) {
          return [clip]
        }
        return [
          { ...clip, linkGroupId: leftGroup, sourceOut: sourceTime },
          {
            ...clip,
            id: `${clip.id}:right@${marker}`,
            linkGroupId: rightGroup,
            timelineStart: command.outputTime,
            sourceIn: sourceTime,
          },
        ]
      }),
    })),
  )
}

function deleteClip(
  spec: EditSpecV3,
  command: Extract<TimelineCommand, { type: 'deleteClip' }>,
): EditSpecV3 {
  const track = findTrack(spec, command.trackId)
  const selected = track && findClip(track, command.clipId)
  if (!track || !selected || track.locked) return spec
  const primary = track.id === spec.timeline.primaryTrackId
  const targets = primary
    ? linkedClipIds(spec, selected.linkGroupId)
    : new Set([selected.id])
  const duration = selected.sourceOut - selected.sourceIn
  const end = selected.timelineStart + duration

  return replaceTracks(
    spec,
    spec.timeline.tracks.map((candidateTrack) => ({
      ...candidateTrack,
      clips: candidateTrack.clips
        .filter((clip) => !targets.has(clip.id))
        .map((clip) =>
          primary && clip.timelineStart >= end
            ? { ...clip, timelineStart: clip.timelineStart - duration }
            : clip,
        ),
    })),
  )
}

const DEFAULT_VISUAL_TRANSFORM: VisualTransform = {
  x: 0.2,
  y: 0.2,
  width: 0.6,
  height: 0.6,
}

function nativeDuration(assetId: string, context: TimelineContext): number | null {
  const asset = context.assets[assetId]
  if (!asset) return null
  if (asset.mediaType === 'image') return 5
  return asset.duration && asset.duration > 0 ? asset.duration : null
}

function clipIdExists(spec: EditSpecV3, clipId: string): boolean {
  return spec.timeline.tracks.some((track) =>
    track.clips.some((clip) => clip.id === clipId),
  )
}

function assetCommand(
  spec: EditSpecV3,
  command: AssetTimelineCommand,
  context: TimelineContext,
): EditSpecV3 {
  if (command.type === 'insertAsset') {
    const asset = context.assets[command.assetId]
    const duration = nativeDuration(command.assetId, context)
    if (!asset || duration === null || clipIdExists(spec, command.clipId)) return spec
    const trackType = asset.mediaType === 'audio' ? 'audio' : 'video'
    const requestedStart = Number.isFinite(command.timelineStart)
      ? command.timelineStart
      : 0
    const timelineStart = Math.min(
      Math.max(requestedStart, 0),
      spec.timeline.duration,
    )
    const sourceOut = Math.min(duration, spec.timeline.duration - timelineStart)
    if (sourceOut < 1 / 30) return spec

    let tracks = [...spec.timeline.tracks]
    let target = tracks.find((track) => track.id === command.trackId)
    if (target && (target.type !== trackType || target.locked)) return spec
    if (!target) {
      target = {
        id: command.trackId,
        type: trackType,
        name: command.trackName,
        order: tracks.length,
        hidden: false,
        locked: false,
        clips: [],
      }
      tracks.push(target)
    }
    const linkGroupId = command.linkGroupId ??
      (command.linkedAudio ? `${command.clipId}:linked` : undefined)
    const visualClip: TimelineClip = {
      id: command.clipId,
      assetId: command.assetId,
      ...(linkGroupId ? { linkGroupId } : {}),
      timelineStart,
      sourceIn: 0,
      sourceOut,
      muted: false,
      ...(trackType === 'video'
        ? {
            transform: command.initialTransform ?? DEFAULT_VISUAL_TRANSFORM,
          }
        : {}),
    }
    tracks = tracks.map((track) =>
      track.id === target!.id
        ? { ...track, clips: [...track.clips, visualClip] }
        : track,
    )

    if (command.linkedAudio && asset.mediaType === 'video' && asset.hasAudio) {
      if (clipIdExists(spec, command.linkedAudio.clipId)) return spec
      let audioTrack = tracks.find((track) => track.id === command.linkedAudio!.trackId)
      if (audioTrack && (audioTrack.type !== 'audio' || audioTrack.locked)) return spec
      if (!audioTrack) {
        audioTrack = {
          id: command.linkedAudio.trackId,
          type: 'audio',
          name: command.linkedAudio.trackName,
          order: tracks.length,
          hidden: false,
          locked: false,
          clips: [],
        }
        tracks.push(audioTrack)
      }
      const audioClip: TimelineClip = {
        id: command.linkedAudio.clipId,
        assetId: command.assetId,
        linkGroupId: linkGroupId!,
        timelineStart,
        sourceIn: 0,
        sourceOut,
        muted: true,
      }
      tracks = tracks.map((track) =>
        track.id === audioTrack!.id
          ? { ...track, clips: [...track.clips, audioClip] }
          : track,
      )
    }
    return replaceTracks(spec, tracks)
  }

  if (command.type === 'updateVisualTransform') {
    const track = findTrack(spec, command.trackId)
    const clip = track && findClip(track, command.clipId)
    const asset = clip && context.assets[clip.assetId]
    if (
      !track ||
      !clip ||
      !asset ||
      track.locked ||
      track.type !== 'video' ||
      asset.mediaType === 'audio'
    ) return spec
    return replaceTracks(
      spec,
      spec.timeline.tracks.map((item) =>
        item.id === track.id
          ? {
              ...item,
              clips: item.clips.map((candidate) =>
                candidate.id === clip.id
                  ? { ...candidate, transform: command.transform }
                  : candidate,
              ),
            }
          : item,
      ),
    )
  }

  if (command.type === 'setClipMuted') {
    const track = findTrack(spec, command.trackId)
    const clip = track && findClip(track, command.clipId)
    if (!track || !clip || track.locked) return spec
    return replaceTracks(
      spec,
      spec.timeline.tracks.map((item) =>
        item.id === track.id
          ? {
              ...item,
              clips: item.clips.map((candidate) =>
                candidate.id === clip.id
                  ? { ...candidate, muted: command.muted }
                  : candidate,
              ),
            }
          : item,
      ),
    )
  }

  const from = context.assets[command.fromAssetId]
  const to = context.assets[command.toAssetId]
  if (!from || !to || from.mediaType !== to.mediaType) return spec
  const replacementDuration = nativeDuration(command.toAssetId, context)
  if (replacementDuration === null) return spec
  let replaced = false
  const tracks = spec.timeline.tracks.map((track) => ({
    ...track,
    clips: track.clips.flatMap((clip) => {
      if (clip.assetId !== command.fromAssetId || track.locked) return [clip]
      const sourceIn = Math.min(
        clip.sourceIn,
        Math.max(0, replacementDuration - 1 / 30),
      )
      const sourceOut = Math.min(
        replacementDuration,
        Math.max(sourceIn + 1 / 30, clip.sourceOut),
      )
      replaced = true
      return [{
        ...clip,
        assetId: command.toAssetId,
        sourceIn,
        sourceOut,
      }]
    }),
  }))
  return replaced ? replaceTracks(spec, tracks) : spec
}

function simpleTrackCommand(
  spec: EditSpecV3,
  command: Exclude<
    TimelineCommand,
    | { type: 'trimClip' }
    | { type: 'splitClip' }
    | { type: 'deleteClip' }
    | { type: 'updateCrop' }
    | { type: 'updateCaptions' }
    | AssetTimelineCommand
  >,
): EditSpecV3 {
  const track = 'trackId' in command
    ? findTrack(spec, command.trackId)
    : undefined
  if (track?.locked && command.type !== 'setTrackLocked') return spec

  if (command.type === 'addTrack') {
    if (spec.timeline.tracks.some((item) => item.id === command.id)) return spec
    return replaceTracks(spec, [...spec.timeline.tracks, {
      id: command.id,
      type: command.trackType,
      name: command.name,
      order: spec.timeline.tracks.length,
      hidden: false,
      locked: false,
      clips: [],
    }])
  }
  if (command.type === 'deleteTrack' && track) {
    const videos = spec.timeline.tracks.filter((item) => item.type === 'video')
    if (track.type === 'video' && videos.length === 1) return spec
    const tracks = spec.timeline.tracks.filter((item) => item.id !== track.id)
    const primaryTrackId =
      track.id === spec.timeline.primaryTrackId
        ? tracks.find((item) => item.type === 'video')!.id
        : spec.timeline.primaryTrackId
    return replaceTracks(spec, tracks, primaryTrackId)
  }
  if (command.type === 'setPrimaryTrack' && track?.type === 'video') {
    return replaceTracks(spec, spec.timeline.tracks, track.id)
  }
  if (command.type === 'duplicateTrack' && track) {
    if (spec.timeline.tracks.some((item) => item.id === command.newTrackId)) return spec
    return replaceTracks(spec, [...spec.timeline.tracks, {
      ...track,
      id: command.newTrackId,
      name: `${track.name} copy`,
      order: spec.timeline.tracks.length,
      clips: track.clips.map((clip, index) => ({
        ...clip,
        id: command.clipIds[index] ?? `${command.newTrackId}:clip-${index + 1}`,
        linkGroupId: undefined,
      })),
    }])
  }

  const tracks = spec.timeline.tracks.map((item) => {
    if (!track || item.id !== track.id) return item
    if (command.type === 'renameTrack') return { ...item, name: command.name }
    if (command.type === 'reorderTrack') return { ...item, order: command.order }
    if (command.type === 'setTrackHidden') return { ...item, hidden: command.hidden }
    if (command.type === 'setTrackLocked') return { ...item, locked: command.locked }
    if (command.type === 'moveClip') {
      return {
        ...item,
        clips: item.clips.map((clip) =>
          clip.id === command.clipId
            ? {
                ...clip,
                timelineStart:
                  item.id === spec.timeline.primaryTrackId
                    ? clip.timelineStart
                    : Math.min(
                        Math.max(command.timelineStart, 0),
                        Math.max(
                          0,
                          spec.timeline.duration - (clip.sourceOut - clip.sourceIn),
                        ),
                      ),
              }
            : clip,
        ),
      }
    }
    return item
  })
  return replaceTracks(spec, tracks)
}

export function applyTimelineCommand(
  spec: EditSpecV3,
  command: TimelineCommand,
  context: TimelineContext,
): EditSpecV3 {
  let changed: EditSpecV3
  if (command.type === 'trimClip') changed = trim(spec, command)
  else if (command.type === 'splitClip') changed = split(spec, command)
  else if (command.type === 'deleteClip') changed = deleteClip(spec, command)
  else if (command.type === 'updateCrop') {
    changed = { ...spec, crop: { ...spec.crop, ...command.crop } }
  } else if (command.type === 'updateCaptions') {
    changed = { ...spec, captions: { ...spec.captions, ...command.captions } }
  } else if (
    command.type === 'insertAsset' ||
    command.type === 'updateVisualTransform' ||
    command.type === 'setClipMuted' ||
    command.type === 'replaceAsset'
  ) {
    changed = assetCommand(spec, command, context)
  } else {
    changed = simpleTrackCommand(spec, command)
  }
  return changed === spec ? spec : normalizeEditSpecV3(changed, context)
}
