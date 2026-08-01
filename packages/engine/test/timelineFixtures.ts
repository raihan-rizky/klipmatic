import {
  createDefaultEditSpecV3,
  type EditSpecV3,
  type TimelineContext,
  type TimelineTrack,
} from '../src'

export const context: TimelineContext = {
  candidateDuration: 30,
  sourceId: 'clip-1',
  candidateAssetId: 'asset-candidate',
  assets: {
    'asset-candidate': {
      id: 'asset-candidate',
      mediaType: 'video',
      duration: 30,
      width: 1920,
      height: 1080,
      hasAudio: true,
    },
    'asset-image': {
      id: 'asset-image',
      mediaType: 'image',
      duration: null,
      width: 800,
      height: 600,
      hasAudio: false,
    },
    'asset-audio': {
      id: 'asset-audio',
      mediaType: 'audio',
      duration: 12,
      width: null,
      height: null,
      hasAudio: true,
    },
    'asset-video': {
      id: 'asset-video',
      mediaType: 'video',
      duration: 9,
      width: 1280,
      height: 720,
      hasAudio: true,
    },
    'asset-image-replacement': {
      id: 'asset-image-replacement',
      mediaType: 'image',
      duration: null,
      width: 1200,
      height: 1200,
      hasAudio: false,
    },
  },
}

export const spec = createDefaultEditSpecV3(context)
export const primaryTrack = spec.timeline.tracks.find(
  (track) => track.id === spec.timeline.primaryTrackId,
)!
export const primaryClip = primaryTrack.clips[0]!

export function withTrack(
  input: EditSpecV3,
  trackId: string,
  patch: Partial<TimelineTrack>,
): EditSpecV3 {
  return {
    ...input,
    timeline: {
      ...input.timeline,
      tracks: input.timeline.tracks.map((track) =>
        track.id === trackId ? { ...track, ...patch } : track,
      ),
    },
  }
}
