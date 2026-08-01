import {
  createDefaultEditSpecV2,
  type EditSpecV2,
  type TimelineClipV2,
  type TimelineContextV2,
  type TimelineTrack,
} from '../src'

export const context: TimelineContextV2 = {
  candidateDuration: 30,
  sourceId: 'clip-1',
}

export const spec = createDefaultEditSpecV2(context)
export const primaryTrack = spec.timeline.tracks.find(
  (track) => track.id === spec.timeline.primaryTrackId,
)!
export const primaryClip = primaryTrack.clips[0]!

export function withTrack(
  input: EditSpecV2,
  trackId: string,
  patch: Partial<TimelineTrack<TimelineClipV2>>,
): EditSpecV2 {
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
