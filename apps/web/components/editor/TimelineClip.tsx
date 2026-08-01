'use client'

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
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
  timelineDuration,
  playhead,
  snapTargets,
  selected,
  onSelect,
  onCommand,
}: {
  clip: TimelineClipType
  track: TimelineTrack
  candidateDuration: number
  pixelsPerSecond: number
  timelineDuration: number
  playhead: number
  snapTargets: number[]
  selected: boolean
  onSelect: () => void
  onCommand: (command: TimelineCommand) => void
}) {
  const duration = clip.sourceOut - clip.sourceIn
  const [dragStart, setDragStart] = useState(clip.timelineStart)
  const cleanupGesture = useRef<(() => void) | null>(null)
  useEffect(() => setDragStart(clip.timelineStart), [clip.timelineStart])
  useEffect(() => () => cleanupGesture.current?.(), [])

  function snappedTime(raw: number): number {
    let value = Math.round(raw * 30) / 30
    const targets = [playhead, ...snapTargets]
    const closest = targets.reduce<number | null>((best, target) => {
      if (Math.abs(target - value) * pixelsPerSecond > 8) return best
      if (best === null || Math.abs(target - value) < Math.abs(best - value)) return target
      return best
    }, null)
    if (closest !== null) value = closest
    return Math.min(Math.max(value, 0), Math.max(0, timelineDuration - duration))
  }

  function beginMove(event: ReactPointerEvent<HTMLButtonElement>) {
    if (track.locked) return
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    onSelect()
    cleanupGesture.current?.()
    const pointerId = event.pointerId
    const clientX = event.clientX
    const initial = clip.timelineStart
    let current = initial
    let moved = false
    const update = (pointer: PointerEvent) => {
      if (pointer.pointerId !== pointerId) return
      moved ||= Math.abs(pointer.clientX - clientX) >= 2
      current = snappedTime(initial + (pointer.clientX - clientX) / pixelsPerSecond)
      setDragStart(current)
    }
    const cleanup = () => {
      window.removeEventListener('pointermove', update)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', cancel)
      cleanupGesture.current = null
    }
    const commit = () => {
      if (!moved) return
      onCommand({
        type: 'moveClip',
        trackId: track.id,
        clipId: clip.id,
        timelineStart: current,
      })
    }
    const finish = (pointer: PointerEvent) => {
      if (pointer.pointerId !== pointerId) return
      update(pointer)
      cleanup()
      commit()
    }
    const cancel = (pointer: PointerEvent) => {
      if (pointer.pointerId !== pointerId) return
      cleanup()
      commit()
    }
    cleanupGesture.current = cleanup
    window.addEventListener('pointermove', update)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', cancel)
  }
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
        left: dragStart * pixelsPerSecond,
        width: Math.max(44, duration * pixelsPerSecond),
      }}
    >
      <button
        type="button"
        aria-label={`${track.name}, ${duration.toFixed(1)} detik`}
        aria-pressed={selected}
        onClick={onSelect}
        onPointerDown={beginMove}
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
