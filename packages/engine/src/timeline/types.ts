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
