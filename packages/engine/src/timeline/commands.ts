import { normalizeEditSpecV2 } from './normalize'
import type {
  EditSpecV2,
  TimelineClip,
  TimelineCommand,
  TimelineContext,
  TimelineTrack,
} from './types'

function findTrack(spec: EditSpecV2, trackId: string): TimelineTrack | undefined {
  return spec.timeline.tracks.find((track) => track.id === trackId)
}

function findClip(track: TimelineTrack, clipId: string): TimelineClip | undefined {
  return track.clips.find((clip) => clip.id === clipId)
}

function replaceTracks(
  spec: EditSpecV2,
  tracks: TimelineTrack[],
  primaryTrackId = spec.timeline.primaryTrackId,
): EditSpecV2 {
  return {
    ...spec,
    timeline: { ...spec.timeline, primaryTrackId, tracks },
  }
}

function linkedClipIds(spec: EditSpecV2, linkGroupId?: string): Set<string> {
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
  spec: EditSpecV2,
  command: Extract<TimelineCommand, { type: 'trimClip' }>,
): EditSpecV2 {
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
  spec: EditSpecV2,
  command: Extract<TimelineCommand, { type: 'splitClip' }>,
): EditSpecV2 {
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
  spec: EditSpecV2,
  command: Extract<TimelineCommand, { type: 'deleteClip' }>,
): EditSpecV2 {
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

function simpleTrackCommand(
  spec: EditSpecV2,
  command: Exclude<
    TimelineCommand,
    | { type: 'trimClip' }
    | { type: 'splitClip' }
    | { type: 'deleteClip' }
    | { type: 'updateCrop' }
    | { type: 'updateCaptions' }
  >,
): EditSpecV2 {
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
            ? { ...clip, timelineStart: command.timelineStart }
            : clip,
        ),
      }
    }
    return item
  })
  return replaceTracks(spec, tracks)
}

export function applyTimelineCommand(
  spec: EditSpecV2,
  command: TimelineCommand,
  context: TimelineContext,
): EditSpecV2 {
  let changed: EditSpecV2
  if (command.type === 'trimClip') changed = trim(spec, command)
  else if (command.type === 'splitClip') changed = split(spec, command)
  else if (command.type === 'deleteClip') changed = deleteClip(spec, command)
  else if (command.type === 'updateCrop') {
    changed = { ...spec, crop: { ...spec.crop, ...command.crop } }
  } else if (command.type === 'updateCaptions') {
    changed = { ...spec, captions: { ...spec.captions, ...command.captions } }
  } else {
    changed = simpleTrackCommand(spec, command)
  }
  return changed === spec ? spec : normalizeEditSpecV2(changed, context)
}
