'use client'

import { Eye, EyeOff, Lock, Unlock } from 'lucide-react'
import type {
  TimelineCommand,
  TimelineTrack as TimelineTrackType,
} from '@cheapclipper/engine'
import { Button } from '@/components/ui/button'
import { TimelineClip } from './TimelineClip'

export function TimelineTrack({
  track,
  candidateDuration,
  timelineDuration,
  pixelsPerSecond,
  selected,
  onSelectionChange,
  onCommand,
}: {
  track: TimelineTrackType
  candidateDuration: number
  timelineDuration: number
  pixelsPerSecond: number
  selected: { trackId: string; clipId?: string } | null
  onSelectionChange: (selection: { trackId: string; clipId?: string }) => void
  onCommand: (command: TimelineCommand) => void
}) {
  return (
    <div className="grid min-h-16 grid-cols-[9rem_minmax(0,1fr)] border-b border-border/70">
      <div className="sticky left-0 z-20 flex items-center gap-1 border-r border-border bg-surface px-2">
        <button
          type="button"
          className="min-w-0 flex-1 truncate rounded-lg px-2 py-2 text-left text-xs font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          onClick={() => onSelectionChange({ trackId: track.id })}
        >
          {track.name}
        </button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label={track.hidden ? `Tampilkan ${track.name}` : `Sembunyikan ${track.name}`}
          aria-pressed={track.hidden}
          onClick={() => onCommand({ type: 'setTrackHidden', trackId: track.id, hidden: !track.hidden })}
        >
          {track.hidden ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label={track.locked ? `Buka kunci ${track.name}` : `Kunci ${track.name}`}
          aria-pressed={track.locked}
          onClick={() => onCommand({ type: 'setTrackLocked', trackId: track.id, locked: !track.locked })}
        >
          {track.locked ? <Lock className="size-4" /> : <Unlock className="size-4" />}
        </Button>
      </div>
      <div
        className="relative"
        style={{ minWidth: Math.max(480, timelineDuration * pixelsPerSecond) }}
      >
        {track.clips.map((clip) => (
          <TimelineClip
            key={clip.id}
            clip={clip}
            track={track}
            candidateDuration={candidateDuration}
            pixelsPerSecond={pixelsPerSecond}
            selected={selected?.trackId === track.id && selected.clipId === clip.id}
            onSelect={() => onSelectionChange({ trackId: track.id, clipId: clip.id })}
            onCommand={onCommand}
          />
        ))}
      </div>
    </div>
  )
}
