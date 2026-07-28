import { DEFAULT_EDIT_SPEC, type EditSpecV1 } from '../types'
import type {
  EditSpecV2,
  TimelineClip,
  TimelineContext,
  TimelineTrack,
  TrackType,
} from './types'

const TRACK_NAMES: Record<TrackType, string> = {
  video: 'Video',
  audio: 'Audio',
  caption: 'Caption',
}

export function createDefaultEditSpecV2(
  context: TimelineContext,
  legacy: EditSpecV1 = DEFAULT_EDIT_SPEC,
): EditSpecV2 {
  const linkedClip = (type: TrackType): TimelineClip => ({
    id: `${context.sourceId}:${type}:clip`,
    sourceId: context.sourceId,
    linkGroupId: 'candidate-main',
    timelineStart: 0,
    sourceIn: 0,
    sourceOut: context.candidateDuration,
  })
  const makeTrack = (type: TrackType, order: number): TimelineTrack => ({
    id: `${context.sourceId}:${type}`,
    type,
    name: TRACK_NAMES[type],
    order,
    hidden: false,
    locked: false,
    clips: [linkedClip(type)],
  })

  return {
    version: 2,
    output: { ...legacy.output },
    crop: { ...legacy.crop },
    captions: { ...legacy.captions },
    timeline: {
      primaryTrackId: `${context.sourceId}:video`,
      duration: context.candidateDuration,
      tracks: [
        makeTrack('video', 0),
        makeTrack('audio', 1),
        makeTrack('caption', 2),
      ],
    },
  }
}
