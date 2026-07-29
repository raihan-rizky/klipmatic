'use client'

import type {
  TimelineClip as TimelineClipType,
  TimelineCommand,
  TimelineTrack,
} from '@cheapclipper/engine'
import { cn } from '@/lib/utils'

export function TimelineClip({
  clip,
  track,
  candidateDuration,
  pixelsPerSecond,
  selected,
  onSelect,
  onCommand,
}: {
  clip: TimelineClipType
  track: TimelineTrack
  candidateDuration: number
  pixelsPerSecond: number
  selected: boolean
  onSelect: () => void
  onCommand: (command: TimelineCommand) => void
}) {
  const duration = clip.sourceOut - clip.sourceIn
  const color =
    track.type === 'video'
      ? 'bg-primary/25 border-primary/70'
      : track.type === 'audio'
        ? 'bg-sky-400/20 border-sky-400/60'
        : 'bg-amber-400/20 border-amber-400/60'

  return (
    <div
      className={cn(
        'absolute top-2 h-12 min-w-11 overflow-hidden rounded-lg border',
        color,
        selected && 'ring-2 ring-primary',
      )}
      style={{
        left: clip.timelineStart * pixelsPerSecond,
        width: Math.max(44, duration * pixelsPerSecond),
      }}
    >
      <button
        type="button"
        aria-label={`${track.name}, ${duration.toFixed(1)} detik`}
        aria-pressed={selected}
        onClick={onSelect}
        className="absolute inset-0 w-full text-left outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <span className="pointer-events-none block truncate px-3 text-xs font-bold">
          {track.name}
        </span>
      </button>
      <input
        type="range"
        aria-label={`Trim awal ${track.name}`}
        min={0}
        max={candidateDuration}
        step={1 / 30}
        value={clip.sourceIn}
        disabled={track.locked}
        onClick={(event) => event.stopPropagation()}
        onChange={(event) =>
          onCommand({
            type: 'trimClip',
            trackId: track.id,
            clipId: clip.id,
            edge: 'start',
            sourceTime: Number(event.currentTarget.value),
          })
        }
        className="timeline-trim-handle absolute inset-y-0 left-0 z-10 w-11 cursor-ew-resize opacity-0 focus:opacity-100"
      />
      <input
        type="range"
        aria-label={`Trim akhir ${track.name}`}
        min={0}
        max={candidateDuration}
        step={1 / 30}
        value={clip.sourceOut}
        disabled={track.locked}
        onClick={(event) => event.stopPropagation()}
        onChange={(event) =>
          onCommand({
            type: 'trimClip',
            trackId: track.id,
            clipId: clip.id,
            edge: 'end',
            sourceTime: Number(event.currentTarget.value),
          })
        }
        className="timeline-trim-handle absolute inset-y-0 right-0 z-10 w-11 cursor-ew-resize opacity-0 focus:opacity-100"
      />
    </div>
  )
}
