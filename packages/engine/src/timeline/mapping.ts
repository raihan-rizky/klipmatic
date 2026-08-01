import type { TranscriptWord } from '../types'
import type {
  ActiveTimelineItemV2,
  AudioScheduleItem,
  EditSpecV2,
  FrameScheduleItem,
} from './types'

export function mapOutputTime(
  spec: EditSpecV2,
  outputTime: number,
): ActiveTimelineItemV2[] {
  return spec.timeline.tracks
    .filter((track) => !track.hidden)
    .flatMap((track) =>
      track.clips.flatMap((clip) => {
        const duration = clip.sourceOut - clip.sourceIn
        if (
          outputTime < clip.timelineStart ||
          outputTime >= clip.timelineStart + duration
        ) return []
        return [{
          trackId: track.id,
          trackType: track.type,
          clipId: clip.id,
          sourceId: clip.sourceId,
          outputTime,
          sourceTime: clip.sourceIn + outputTime - clip.timelineStart,
          order: track.order,
        }]
      }),
    )
    .sort((left, right) => left.order - right.order)
}

export function buildFrameSchedule(spec: EditSpecV2): FrameScheduleItem[] {
  const duration = 1 / spec.output.frameRate
  const count = Math.ceil(spec.timeline.duration * spec.output.frameRate)
  return Array.from({ length: count }, (_, index) => ({
    index,
    outputTime: index / spec.output.frameRate,
    duration,
  }))
}

export function buildAudioSchedule(spec: EditSpecV2): AudioScheduleItem[] {
  return spec.timeline.tracks
    .filter((track) => track.type === 'audio' && !track.hidden)
    .flatMap((track) =>
      track.clips.flatMap((clip) => {
        if (clip.timelineStart >= spec.timeline.duration) return []
        const available = spec.timeline.duration - clip.timelineStart
        const sourceOut = Math.min(clip.sourceOut, clip.sourceIn + available)
        if (sourceOut <= clip.sourceIn) return []
        return [{
          trackId: track.id,
          clipId: clip.id,
          sourceId: clip.sourceId,
          outputStart: clip.timelineStart,
          sourceIn: clip.sourceIn,
          sourceOut,
        }]
      }),
    )
    .sort((left, right) => left.outputStart - right.outputStart)
}

export function mapWordsToTimeline(
  words: TranscriptWord[],
  spec: EditSpecV2,
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
