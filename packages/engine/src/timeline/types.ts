import type { EditSpecV1 } from '../types'

export type TrackType = 'video' | 'audio' | 'caption'

export type MediaType = 'image' | 'audio' | 'video'

export interface VisualTransform {
  x: number
  y: number
  width: number
  height: number
}

export interface TimelineClipV2 {
  id: string
  sourceId: string
  linkGroupId?: string
  timelineStart: number
  sourceIn: number
  sourceOut: number
}

export interface TimelineClip {
  id: string
  assetId: string
  linkGroupId?: string
  timelineStart: number
  sourceIn: number
  sourceOut: number
  muted: boolean
  transform?: VisualTransform
}

export interface TimelineTrack<TClip = TimelineClip> {
  id: string
  type: TrackType
  name: string
  order: number
  hidden: boolean
  locked: boolean
  clips: TClip[]
}

export interface TimelineContextV2 {
  candidateDuration: number
  sourceId: string
}

export interface TimelineAssetContext {
  id: string
  mediaType: MediaType
  duration: number | null
  width: number | null
  height: number | null
  hasAudio: boolean
}

export interface TimelineContext extends TimelineContextV2 {
  candidateAssetId: string
  assets: Record<string, TimelineAssetContext>
}

export interface EditSpecV2 {
  version: 2
  output: EditSpecV1['output']
  crop: EditSpecV1['crop']
  captions: EditSpecV1['captions']
  timeline: {
    primaryTrackId: string
    duration: number
    tracks: TimelineTrack<TimelineClipV2>[]
  }
}

export type TimelineTransition = {
  id: string
  type: 'fade' | 'cross-dissolve' | 'dip-to-black'
  duration: number
  target:
    | { kind: 'clip-edge'; clipId: string; edge: 'in' | 'out' }
    | {
        kind: 'between-clips'
        trackId: string
        fromClipId: string
        toClipId: string
      }
}

export type TransitionCommand =
  | { type: 'addTransition'; transition: TimelineTransition }
  | {
      type: 'updateTransition'
      transitionId: string
      patch: { type?: TimelineTransition['type']; duration?: number }
    }
  | { type: 'deleteTransition'; transitionId: string }

export interface EditSpecV3 {
  version: 3
  output: EditSpecV1['output']
  crop: EditSpecV1['crop']
  captions: EditSpecV1['captions'] & { positionX: number }
  timeline: {
    primaryTrackId: string
    duration: number
    tracks: TimelineTrack[]
    transitions: TimelineTransition[]
  }
}

export type AssetTimelineCommand =
  | {
      type: 'insertAsset'
      assetId: string
      trackId: string
      trackName: string
      clipId: string
      timelineStart: number
      initialTransform?: VisualTransform
      linkGroupId?: string
      linkedAudio?: { trackId: string; trackName: string; clipId: string }
    }
  | {
      type: 'updateVisualTransform'
      trackId: string
      clipId: string
      transform: VisualTransform
    }
  | { type: 'setClipMuted'; trackId: string; clipId: string; muted: boolean }
  | { type: 'replaceAsset'; fromAssetId: string; toAssetId: string }

export type TimelineCommand =
  | {
      type: 'trimClip'
      trackId: string
      clipId: string
      edge: 'start' | 'end'
      sourceTime: number
    }
  | {
      type: 'splitClip'
      trackId: string
      clipId: string
      outputTime: number
    }
  | { type: 'deleteClip'; trackId: string; clipId: string }
  | {
      type: 'moveClip'
      trackId: string
      clipId: string
      timelineStart: number
    }
  | { type: 'addTrack'; trackType: TrackType; id: string; name: string }
  | { type: 'renameTrack'; trackId: string; name: string }
  | { type: 'reorderTrack'; trackId: string; order: number }
  | { type: 'setTrackHidden'; trackId: string; hidden: boolean }
  | { type: 'setTrackLocked'; trackId: string; locked: boolean }
  | {
      type: 'duplicateTrack'
      trackId: string
      newTrackId: string
      clipIds: string[]
    }
  | { type: 'deleteTrack'; trackId: string }
  | { type: 'setPrimaryTrack'; trackId: string }
  | { type: 'updateCrop'; crop: Partial<EditSpecV3['crop']> }
  | {
      type: 'updateCaptions'
      captions: Partial<EditSpecV3['captions']>
    }
  | AssetTimelineCommand
  | TransitionCommand

export interface ActiveTimelineItem {
  trackId: string
  trackType: TrackType
  clipId: string
  assetId: string
  mediaType: MediaType
  outputTime: number
  sourceTime: number
  order: number
  muted: boolean
  transform?: VisualTransform
}

export interface ActiveTimelineItemV2 {
  trackId: string
  trackType: TrackType
  clipId: string
  sourceId: string
  outputTime: number
  sourceTime: number
  order: number
}

export interface FrameScheduleItem {
  index: number
  outputTime: number
  duration: number
}

export interface AudioScheduleItem {
  trackId: string
  clipId: string
  assetId: string
  outputStart: number
  sourceIn: number
  sourceOut: number
  muted: boolean
}
