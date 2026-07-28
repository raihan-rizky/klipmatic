import type { EditSpecV1 } from '../types'

export type TrackType = 'video' | 'audio' | 'caption'

export interface TimelineClip {
  id: string
  sourceId: string
  linkGroupId?: string
  timelineStart: number
  sourceIn: number
  sourceOut: number
}

export interface TimelineTrack {
  id: string
  type: TrackType
  name: string
  order: number
  hidden: boolean
  locked: boolean
  clips: TimelineClip[]
}

export interface TimelineContext {
  candidateDuration: number
  sourceId: string
}

export interface EditSpecV2 {
  version: 2
  output: EditSpecV1['output']
  crop: EditSpecV1['crop']
  captions: EditSpecV1['captions']
  timeline: {
    primaryTrackId: string
    duration: number
    tracks: TimelineTrack[]
  }
}

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
  | { type: 'updateCrop'; crop: Partial<EditSpecV2['crop']> }
  | {
      type: 'updateCaptions'
      captions: Partial<EditSpecV2['captions']>
    }

export interface ActiveTimelineItem {
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
  sourceId: string
  outputStart: number
  sourceIn: number
  sourceOut: number
}
