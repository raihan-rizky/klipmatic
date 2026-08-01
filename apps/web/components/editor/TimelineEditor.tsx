'use client'

import { useMemo, useState } from 'react'
import type {
  EditSpecV3,
  TimelineCommand,
  VisualTransform,
} from '@cheapclipper/engine'
import { TimelineToolbar } from './TimelineToolbar'
import { TimelineTrack } from './TimelineTrack'

export interface TimelineSelection {
  trackId: string
  clipId?: string
}

export interface TimelineEditorProps {
  spec: EditSpecV3
  candidateDuration: number
  playhead: number
  selected: TimelineSelection | null
  onPlayheadChange: (time: number) => void
  onSelectionChange: (selection: TimelineSelection | null) => void
  onCommand: (command: TimelineCommand) => void
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  playing: boolean
  onTogglePlay: () => void
  onAssetDrop?: (
    assetId: string,
    placement: { timelineStart?: number; transform?: VisualTransform },
  ) => void
}

export function TimelineEditor(props: TimelineEditorProps) {
  const [pixelsPerSecond, setPixelsPerSecond] = useState(36)
  const selectedTrack = useMemo(
    () => props.spec.timeline.tracks.find((track) => track.id === props.selected?.trackId),
    [props.selected?.trackId, props.spec.timeline.tracks],
  )
  const canEdit = Boolean(props.selected?.clipId && selectedTrack && !selectedTrack.locked)

  const split = () => {
    if (!props.selected?.clipId || !selectedTrack || selectedTrack.locked) return
    props.onCommand({
      type: 'splitClip',
      trackId: selectedTrack.id,
      clipId: props.selected.clipId,
      outputTime: props.playhead,
    })
  }
  const remove = () => {
    if (!props.selected?.clipId || !selectedTrack || selectedTrack.locked) return
    props.onCommand({
      type: 'deleteClip',
      trackId: selectedTrack.id,
      clipId: props.selected.clipId,
    })
  }

  return (
    <section
      role="region"
      aria-label="Timeline editor"
      tabIndex={0}
      onKeyDown={(event) => {
        const modifier = event.ctrlKey || event.metaKey
        if (event.key === ' ') {
          event.preventDefault()
          props.onTogglePlay()
        } else if (event.key.toLowerCase() === 's' && !modifier) {
          event.preventDefault()
          split()
        } else if (event.key === 'Delete' || event.key === 'Backspace') {
          event.preventDefault()
          remove()
        } else if (modifier && event.key.toLowerCase() === 'z') {
          event.preventDefault()
          event.shiftKey ? props.onRedo() : props.onUndo()
        }
      }}
      className="overflow-hidden border-y border-border bg-surface outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
    >
      <TimelineToolbar
        playing={props.playing}
        canEdit={canEdit}
        canUndo={props.canUndo}
        canRedo={props.canRedo}
        onTogglePlay={props.onTogglePlay}
        onSplit={split}
        onDelete={remove}
        onUndo={props.onUndo}
        onRedo={props.onRedo}
        onZoomIn={() => setPixelsPerSecond((value) => Math.min(160, value + 12))}
        onZoomOut={() => setPixelsPerSecond((value) => Math.max(16, value - 12))}
      />
      <div className="timeline-scroll max-h-[38vh] overflow-auto">
        <div className="relative min-w-max">
          <div
            aria-label={`Playhead ${props.playhead.toFixed(1)} detik`}
            className="pointer-events-none absolute bottom-0 top-0 z-30 w-px bg-primary"
            style={{ left: 192 + props.playhead * pixelsPerSecond }}
          />
          {props.spec.timeline.tracks.map((track) => (
            <TimelineTrack
              key={track.id}
              track={track}
              candidateDuration={props.candidateDuration}
              timelineDuration={props.spec.timeline.duration}
              pixelsPerSecond={pixelsPerSecond}
              playhead={props.playhead}
              selected={props.selected}
              onSelectionChange={props.onSelectionChange}
              onCommand={props.onCommand}
              onAssetDrop={props.onAssetDrop}
            />
          ))}
        </div>
      </div>
    </section>
  )
}
