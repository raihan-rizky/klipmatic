import {
  applyTimelineCommand,
  createDefaultEditSpecV3,
  type EditSpecV3,
  type TimelineClip,
  type TimelineContext,
  type TimelineTransition,
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

export const splitSpec = applyTimelineCommand(spec, {
  type: 'splitClip',
  trackId: primaryTrack.id,
  clipId: primaryClip.id,
  outputTime: 12,
}, context)

export const [left, right] = splitSpec.timeline.tracks
  .find((track) => track.id === splitSpec.timeline.primaryTrackId)!.clips

export const specWithTransition: EditSpecV3 = {
  ...splitSpec,
  timeline: {
    ...splitSpec.timeline,
    transitions: [{
      id: 'transition-1',
      type: 'cross-dissolve',
      duration: 0.5,
      target: {
        kind: 'between-clips',
        trackId: primaryTrack.id,
        fromClipId: left!.id,
        toClipId: right!.id,
      },
    }],
  },
}

export const malformedTransitionSpec: EditSpecV3 = {
  ...specWithTransition,
  timeline: {
    ...specWithTransition.timeline,
    tracks: specWithTransition.timeline.tracks.map((track) =>
      track.id === primaryTrack.id
        ? {
            ...track,
            clips: track.clips.map((clip) =>
              clip.id === right!.id
                ? { ...clip, timelineStart: 14 }
                : clip,
            ),
          }
        : track,
    ),
  },
}

export const overlayClip: TimelineClip = {
  id: 'overlay-clip',
  assetId: 'asset-image',
  timelineStart: 3,
  sourceIn: 0,
  sourceOut: 5,
  muted: false,
  transform: { x: 0.2, y: 0.2, width: 0.6, height: 0.6 },
}

export const specWithOverlay: EditSpecV3 = {
  ...splitSpec,
  timeline: {
    ...splitSpec.timeline,
    tracks: [
      ...splitSpec.timeline.tracks,
      {
        id: 'overlay-track',
        type: 'video',
        name: 'Overlay',
        order: splitSpec.timeline.tracks.length,
        hidden: false,
        locked: false,
        clips: [overlayClip],
      },
    ],
  },
}

export const overlayFadeIn: TimelineTransition = {
  id: 'overlay-fade-in',
  type: 'fade',
  duration: 0.5,
  target: { kind: 'clip-edge', clipId: overlayClip.id, edge: 'in' },
}

export const primaryFadeIn: TimelineTransition = {
  ...overlayFadeIn,
  id: 'primary-fade-in',
  target: { kind: 'clip-edge', clipId: left!.id, edge: 'in' },
}

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
