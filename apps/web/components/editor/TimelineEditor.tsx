'use client'

import { useEffect, useMemo, useState, type MutableRefObject } from 'react'
import {
  findTransitionJoints,
  type TransitionJoint,
  EditSpecV3,
  TimelineCommand,
  TimelineTransition,
  VisualTransform,
} from '@klipmatic/engine'
import { TimelineToolbar } from './TimelineToolbar'
import { TimelineTrack } from './TimelineTrack'

export type TimelineSelection =
  | { kind: 'track'; trackId: string }
  | { kind: 'clip'; trackId: string; clipId: string }
  | { kind: 'joint'; joint: TransitionJoint }
  | { kind: 'transition'; transitionId: string }

export interface TimelineTransport {
  split(): void
  remove(): void
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
  transitionDragActive?: boolean
  onShowShortcuts: () => void
  transportRef?: MutableRefObject<TimelineTransport | null>
}

export function TimelineEditor(props: TimelineEditorProps) {
  const [pixelsPerSecond, setPixelsPerSecond] = useState(36)
  const [status, setStatus] = useState('')
  const selectedTrackId = props.selected?.kind === 'track' || props.selected?.kind === 'clip'
    ? props.selected.trackId
    : null
  const selectedTrack = useMemo(
    () => props.spec.timeline.tracks.find((track) => track.id === selectedTrackId),
    [selectedTrackId, props.spec.timeline.tracks],
  )
  const selectedClipId = props.selected?.kind === 'clip' ? props.selected.clipId : null
  const canEdit = Boolean(selectedClipId && selectedTrack && !selectedTrack.locked)
  const joints = useMemo(() => findTransitionJoints(props.spec), [props.spec])

  const split = () => {
    if (!selectedClipId || !selectedTrack || selectedTrack.locked) return
    props.onCommand({
      type: 'splitClip',
      trackId: selectedTrack.id,
      clipId: selectedClipId,
      outputTime: props.playhead,
    })
  }
  const remove = () => {
    if (!selectedClipId || !selectedTrack || selectedTrack.locked) return
    props.onCommand({
      type: 'deleteClip',
      trackId: selectedTrack.id,
      clipId: selectedClipId,
    })
  }
  const [popoverJoint, setPopoverJoint] = useState<TransitionJoint | null>(null)

  useEffect(() => {
    const transportRef = props.transportRef
    if (!transportRef) return
    transportRef.current = { split, remove }
    return () => {
      transportRef.current = null
    }
  })

  const addTransition = (
    target: TimelineTransition['target'],
    type: TimelineTransition['type'],
    duration: number,
  ) => {
    const id = crypto.randomUUID()
    props.onCommand({
      type: 'addTransition',
      transition: { id, type, duration, target },
    })
    props.onSelectionChange({ kind: 'transition', transitionId: id })
    setStatus('Transition ditambahkan.')
  }

  return (
    <section
      role="region"
      aria-label="Timeline editor"
      className="overflow-hidden border-y border-border bg-surface"
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
        onShowShortcuts={props.onShowShortcuts}
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
              primary={track.id === props.spec.timeline.primaryTrackId}
              joints={joints.filter((joint) => joint.trackId === track.id)}
              transitions={props.spec.timeline.transitions}
              transitionDragActive={Boolean(props.transitionDragActive)}
              onAddTransition={addTransition}
              onInvalidTransitionDrop={() => {
                setStatus('Split clip terlebih dahulu untuk menambahkan transition.')
              }}
              frameRate={props.spec.output.frameRate}
              popoverJoint={
                popoverJoint && popoverJoint.trackId === track.id ? popoverJoint : null
              }
              onOpenPopover={setPopoverJoint}
              onClosePopover={() => setPopoverJoint(null)}
            />
          ))}
        </div>
      </div>
      <p role="status" aria-live="polite" className="sr-only">{status}</p>
    </section>
  )
}
