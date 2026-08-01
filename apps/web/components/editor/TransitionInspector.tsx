'use client'

import { Trash2 } from 'lucide-react'
import {
  findTransitionJoints,
  MAX_TRANSITION_DURATION,
  TRANSITION_TYPES,
  type EditSpecV3,
  type TimelineCommand,
  type TimelineTransition,
} from '@cheapclipper/engine'
import { Button } from '@/components/ui/button'
import { TRANSITION_LABELS } from './TransitionLibrary'

function transitionMaxDuration(
  spec: EditSpecV3,
  transition: TimelineTransition,
): number {
  if (transition.target.kind === 'between-clips') {
    const target = transition.target
    return findTransitionJoints(spec).find((joint) =>
      joint.trackId === target.trackId &&
      joint.fromClipId === target.fromClipId &&
      joint.toClipId === target.toClipId
    )?.maxDuration ?? transition.duration
  }
  const target = transition.target
  for (const track of spec.timeline.tracks) {
    const clip = track.clips.find((candidate) => candidate.id === target.clipId)
    if (clip) {
      return Math.min(MAX_TRANSITION_DURATION, clip.sourceOut - clip.sourceIn)
    }
  }
  return transition.duration
}

export function TransitionInspector({
  spec,
  transitionId,
  onCommand,
}: {
  spec: EditSpecV3
  transitionId: string
  onCommand: (command: TimelineCommand) => void
}) {
  const transition = spec.timeline.transitions.find((item) => item.id === transitionId)
  if (!transition) {
    return <p className="p-5 text-sm text-muted">Transition sudah tidak tersedia.</p>
  }
  const maxDuration = transitionMaxDuration(spec, transition)
  const update = (patch: { type?: TimelineTransition['type']; duration?: number }) => {
    onCommand({ type: 'updateTransition', transitionId, patch })
  }

  return (
    <div className="space-y-5 p-5">
      <div>
        <h2 className="font-black">Transition</h2>
        <p className="mt-1 text-xs text-muted">
          Ganti preset atau atur durasi tanpa mengubah panjang video.
        </p>
      </div>
      <label className="block text-sm font-bold">
        Tipe transition
        <select
          aria-label="Tipe transition"
          value={transition.type}
          className="mt-2 min-h-11 w-full rounded-xl border border-border bg-background px-3"
          onChange={(event) => update({
            type: event.currentTarget.value as TimelineTransition['type'],
          })}
        >
          {TRANSITION_TYPES.map((type) => (
            <option key={type} value={type}>{TRANSITION_LABELS[type]}</option>
          ))}
        </select>
      </label>
      <div className="space-y-2">
        <span className="text-sm font-bold">
          Durasi transition
        </span>
        <div className="grid grid-cols-[1fr_5rem] gap-2">
          <input
            id="transition-duration"
            type="range"
            aria-label="Durasi transition slider"
            min={1 / spec.output.frameRate}
            max={maxDuration}
            step={1 / spec.output.frameRate}
            value={transition.duration}
            className="accent-primary"
            onChange={(event) => update({ duration: Number(event.currentTarget.value) })}
          />
          <input
            type="number"
            aria-label="Durasi transition"
            min={1 / spec.output.frameRate}
            max={maxDuration}
            step={0.1}
            value={transition.duration}
            className="min-h-11 rounded-xl border border-border bg-background px-2"
            onChange={(event) => {
              const duration = Number(event.currentTarget.value)
              if (Number.isFinite(duration) && duration > 0) update({ duration })
            }}
          />
        </div>
        <p className="text-xs text-muted">Maksimal {maxDuration} detik untuk target ini.</p>
      </div>
      <Button
        type="button"
        variant="destructive"
        className="w-full"
        aria-label="Hapus transition"
        onClick={() => onCommand({ type: 'deleteTransition', transitionId })}
      >
        <Trash2 className="size-4" aria-hidden="true" />
        Hapus transition
      </Button>
    </div>
  )
}
