'use client'

import { Eye, EyeOff, Lock, Unlock } from 'lucide-react'
import type {
  TimelineTransition,
  TimelineCommand,
  TimelineTrack as TimelineTrackType,
  TransitionJoint,
  VisualTransform,
} from '@klipmatic/engine'
import { Button } from '@/components/ui/button'
import { TimelineClip } from './TimelineClip'
import type { TimelineSelection } from './TimelineEditor'
import { JointTransitionPopover } from './JointTransitionPopover'
import { TRANSITION_MIME } from './TransitionLibrary'
import { TimelineTransitionIcon } from './TimelineTransitionIcon'
import { TimelineTransitionTarget } from './TimelineTransitionTarget'

export function TimelineTrack({
  track,
  candidateDuration,
  timelineDuration,
  pixelsPerSecond,
  playhead,
  selected,
  onSelectionChange,
  onCommand,
  onAssetDrop,
  primary,
  joints,
  transitions,
  frameRate,
  popoverJoint,
  onOpenPopover,
  onClosePopover,
  transitionDragActive,
  onAddTransition,
  onInvalidTransitionDrop,
}: {
  track: TimelineTrackType
  candidateDuration: number
  timelineDuration: number
  pixelsPerSecond: number
  playhead: number
  selected: TimelineSelection | null
  onSelectionChange: (selection: TimelineSelection) => void
  onCommand: (command: TimelineCommand) => void
  onAssetDrop?: (
    assetId: string,
    placement: { timelineStart?: number; transform?: VisualTransform },
  ) => void
  primary: boolean
  joints: TransitionJoint[]
  transitions: TimelineTransition[]
  frameRate: number
  popoverJoint: TransitionJoint | null
  onOpenPopover: (joint: TransitionJoint) => void
  onClosePopover: () => void
  transitionDragActive: boolean
  onAddTransition: (
    target: TimelineTransition['target'],
    type: TimelineTransition['type'],
    duration: number,
  ) => void
  onInvalidTransitionDrop: () => void
}) {
  const snapTargets = track.clips.flatMap((clip) => [
    clip.timelineStart,
    clip.timelineStart + clip.sourceOut - clip.sourceIn,
  ])

  return (
    <div className="grid min-h-16 grid-cols-[12rem_minmax(0,1fr)] border-b border-border/70">
      <div className="sticky left-0 z-20 flex items-center gap-1 border-r border-border bg-surface px-2">
        <button
          type="button"
          className="min-w-0 flex-1 truncate rounded-lg px-2 py-2 text-left text-xs font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          onClick={() => onSelectionChange({ kind: 'track', trackId: track.id })}
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
        aria-label={`${track.name} timeline drop area`}
        style={{ minWidth: Math.max(480, timelineDuration * pixelsPerSecond) }}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes('application/x-klipmatic-asset')) {
            event.preventDefault()
            event.dataTransfer.dropEffect = 'copy'
          } else if (event.dataTransfer.types.includes(TRANSITION_MIME)) {
            event.preventDefault()
            event.dataTransfer.dropEffect = 'none'
          }
        }}
        onDrop={(event) => {
          if (event.dataTransfer.types.includes(TRANSITION_MIME)) {
            event.preventDefault()
            onInvalidTransitionDrop()
            return
          }
          const raw = event.dataTransfer.getData('application/x-klipmatic-asset')
          if (!raw) return
          event.preventDefault()
          try {
            const assetId = (JSON.parse(raw) as { assetId?: unknown }).assetId
            if (typeof assetId !== 'string') return
            const rect = event.currentTarget.getBoundingClientRect()
            const pointerTime = (event.clientX - rect.left) / pixelsPerSecond
            const timelineStart = Math.min(
              timelineDuration,
              Math.max(0, Math.round(pointerTime * 30) / 30),
            )
            onAssetDrop?.(assetId, { timelineStart })
          } catch {
            // Ignore drag payloads from outside Klipmatic.
          }
        }}
      >
        {track.clips.map((clip) => (
          <TimelineClip
            key={clip.id}
            clip={clip}
            track={track}
            candidateDuration={candidateDuration}
            pixelsPerSecond={pixelsPerSecond}
            timelineDuration={timelineDuration}
            playhead={playhead}
            snapTargets={snapTargets.filter((target) =>
              target !== clip.timelineStart &&
              target !== clip.timelineStart + clip.sourceOut - clip.sourceIn
            )}
            selected={selected?.kind === 'clip' && selected.trackId === track.id && selected.clipId === clip.id}
            onSelect={() => onSelectionChange({ kind: 'clip', trackId: track.id, clipId: clip.id })}
            onCommand={onCommand}
          />
        ))}
        {primary ? joints.map((joint) => (
          <TimelineTransitionTarget
            key={`${joint.fromClipId}:${joint.toClipId}`}
            left={joint.outputTime * pixelsPerSecond}
            ariaLabel={`Sambungan ${joint.fromClipId} ke ${joint.toClipId}`}
            onSelect={() => {
              onSelectionChange({ kind: 'joint', joint })
              onOpenPopover(joint)
            }}
            onAdd={(type, duration) => onAddTransition({
              kind: 'between-clips',
              trackId: joint.trackId,
              fromClipId: joint.fromClipId,
              toClipId: joint.toClipId,
            }, type, Math.min(duration, joint.maxDuration))}
          />
        )) : null}
        {popoverJoint ? (
          <JointTransitionPopover
            joint={popoverJoint}
            left={popoverJoint.outputTime * pixelsPerSecond}
            frameRate={frameRate}
            onAdd={(type, duration) => {
              onClosePopover()
              onAddTransition({
                kind: 'between-clips',
                trackId: popoverJoint.trackId,
                fromClipId: popoverJoint.fromClipId,
                toClipId: popoverJoint.toClipId,
              }, type, duration)
            }}
            onClose={onClosePopover}
          />
        ) : null}
        {!primary && track.type === 'video' ? track.clips.flatMap((clip) => {
          const clipSelected = selected?.kind === 'clip' &&
            selected.trackId === track.id && selected.clipId === clip.id
          const visible = transitionDragActive || clipSelected
          const duration = clip.sourceOut - clip.sourceIn
          return (['in', 'out'] as const).map((edge) => (
            <TimelineTransitionTarget
              key={`${clip.id}:${edge}`}
              left={(clip.timelineStart + (edge === 'out' ? duration : 0)) * pixelsPerSecond}
              ariaLabel={`${edge === 'in' ? 'Masuk' : 'Keluar'} transition ${track.name}`}
              visible={visible}
              onAdd={(type, requestedDuration) => onAddTransition({
                kind: 'clip-edge',
                clipId: clip.id,
                edge,
              }, type, Math.min(requestedDuration, duration, 2))}
            />
          ))
        }) : null}
        {transitions.flatMap((transition) => {
          let left: number | null = null
          if (transition.target.kind === 'between-clips' && transition.target.trackId === track.id) {
            const target = transition.target
            const joint = joints.find((candidate) =>
              candidate.fromClipId === target.fromClipId &&
              candidate.toClipId === target.toClipId
            )
            left = joint ? joint.outputTime * pixelsPerSecond : null
          } else if (transition.target.kind === 'clip-edge') {
            const target = transition.target
            const clip = track.clips.find((candidate) => candidate.id === target.clipId)
            if (clip) {
              left = (clip.timelineStart + (target.edge === 'out'
                ? clip.sourceOut - clip.sourceIn
                : 0)) * pixelsPerSecond
            }
          }
          return left === null ? [] : [(
            <TimelineTransitionIcon
              key={transition.id}
              transition={transition}
              left={left}
              selected={selected?.kind === 'transition' && selected.transitionId === transition.id}
              onSelect={() => onSelectionChange({
                kind: 'transition',
                transitionId: transition.id,
              })}
            />
          )]
        })}
      </div>
    </div>
  )
}
