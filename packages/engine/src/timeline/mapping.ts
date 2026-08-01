import type { TranscriptWord } from '../types'
import type {
  ActiveTimelineItem,
  AudioScheduleItem,
  EditSpecV3,
  FrameScheduleItem,
  TimelineContext,
} from './types'
import { transitionWindow } from './transitions'

export function mapOutputTime(
  spec: EditSpecV3,
  outputTime: number,
  context?: TimelineContext,
): ActiveTimelineItem[] {
  const active: ActiveTimelineItem[] = spec.timeline.tracks
    .filter((track) => !track.hidden)
    .flatMap((track) =>
      track.clips.flatMap((clip) => {
        const asset = context?.assets[clip.assetId]
        const duration = clip.sourceOut - clip.sourceIn
        if (
          outputTime < clip.timelineStart ||
          outputTime >= clip.timelineStart + duration
        ) return []
        return [{
          trackId: track.id,
          trackType: track.type,
          clipId: clip.id,
          assetId: clip.assetId,
          mediaType: asset?.mediaType ?? (track.type === 'audio' ? 'audio' : 'video'),
          outputTime,
          sourceTime: clip.sourceIn + outputTime - clip.timelineStart,
          order: track.order,
          muted: clip.muted,
          ...(clip.transform ? { transform: clip.transform } : {}),
        }]
      }),
    )
  for (const transition of spec.timeline.transitions) {
    if (transition.target.kind !== 'between-clips') continue
    const target = transition.target
    const window = transitionWindow(transition, spec, outputTime)
    if (
      !window ||
      outputTime < window.start - 1e-9 ||
      outputTime > window.end + 1e-9
    ) {
      continue
    }
    const track = spec.timeline.tracks.find(
      (candidate) =>
        candidate.id === target.trackId && !candidate.hidden,
    )
    if (!track) continue
    for (const clipId of [
      target.fromClipId,
      target.toClipId,
    ]) {
      if (active.some((item) => item.clipId === clipId)) continue
      const clip = track.clips.find((candidate) => candidate.id === clipId)
      if (!clip) continue
      const asset = context?.assets[clip.assetId]
      const assetDuration =
        asset?.duration && asset.duration > 0 ? asset.duration : clip.sourceOut
      const linearSourceTime = clip.sourceIn + outputTime - clip.timelineStart
      active.push({
        trackId: track.id,
        trackType: track.type,
        clipId: clip.id,
        assetId: clip.assetId,
        mediaType: asset?.mediaType ?? 'video',
        outputTime,
        sourceTime: Math.min(Math.max(linearSourceTime, 0), assetDuration),
        order: track.order,
        muted: clip.muted,
        transitionParticipant: true,
        ...(clip.transform ? { transform: clip.transform } : {}),
      })
    }
  }

  return active.sort((left, right) => left.order - right.order)
}

export function buildFrameSchedule(spec: EditSpecV3): FrameScheduleItem[] {
  const duration = 1 / spec.output.frameRate
  const count = Math.ceil(spec.timeline.duration * spec.output.frameRate)
  return Array.from({ length: count }, (_, index) => ({
    index,
    outputTime: index / spec.output.frameRate,
    duration,
  }))
}

export function buildAudioSchedule(spec: EditSpecV3): AudioScheduleItem[] {
  return spec.timeline.tracks
    .filter((track) => track.type === 'audio' && !track.hidden)
    .flatMap((track) =>
      track.clips.flatMap((clip) => {
        if (clip.muted) return []
        if (clip.timelineStart >= spec.timeline.duration) return []
        const available = spec.timeline.duration - clip.timelineStart
        const sourceOut = Math.min(clip.sourceOut, clip.sourceIn + available)
        if (sourceOut <= clip.sourceIn) return []
        return [{
          trackId: track.id,
          clipId: clip.id,
          assetId: clip.assetId,
          outputStart: clip.timelineStart,
          sourceIn: clip.sourceIn,
          sourceOut,
          muted: clip.muted,
        }]
      }),
    )
    .sort((left, right) => left.outputStart - right.outputStart)
}

export function mapWordsToTimeline(
  words: TranscriptWord[],
  spec: EditSpecV3,
): TranscriptWord[] {
  return spec.timeline.tracks
    .filter((track) => track.type === 'caption' && !track.hidden)
    .flatMap((track) =>
      track.clips.flatMap((clip) =>
        words.flatMap((word) => {
          const start = Math.max(word.start, clip.sourceIn)
          const end = Math.min(word.end, clip.sourceOut)
          if (end <= start) return []
          return [{
            text: word.text,
            start: clip.timelineStart + start - clip.sourceIn,
            end: clip.timelineStart + end - clip.sourceIn,
          }]
        }),
      ),
    )
    .sort((left, right) => left.start - right.start)
}
