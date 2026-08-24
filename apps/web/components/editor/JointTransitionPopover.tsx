'use client'

import { useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import {
  DEFAULT_TRANSITION_DURATION,
  TRANSITION_TYPES,
  type TimelineTransition,
  type TransitionJoint,
} from '@klipmatic/engine'
import { Button } from '@/components/ui/button'
import { TRANSITION_LABELS } from './TransitionLibrary'

export function JointTransitionPopover({
  joint,
  left,
  frameRate,
  onAdd,
  onClose,
}: {
  joint: TransitionJoint
  left: number
  frameRate: number
  onAdd: (type: TimelineTransition['type'], duration: number) => void
  onClose: () => void
}) {
  const [type, setType] = useState<TimelineTransition['type']>('fade')
  const [duration, setDuration] = useState(() =>
    Math.min(DEFAULT_TRANSITION_DURATION, joint.maxDuration),
  )

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      onClose()
    }
  }

  return (
    <div
      role="dialog"
      aria-label="Tambahkan transition di cut point"
      onKeyDown={onKeyDown}
      style={{ left }}
      className="absolute bottom-full left-0 z-40 mb-2 w-64 -translate-x-1/2 space-y-3 rounded-lg border border-border bg-surface-raised p-3 shadow-xl"
    >
      <div className="grid grid-cols-3 gap-1">
        {TRANSITION_TYPES.map((candidate) => (
          <Button
            key={candidate}
            type="button"
            size="sm"
            variant={candidate === type ? 'primary' : 'secondary'}
            aria-label={TRANSITION_LABELS[candidate]}
            aria-pressed={candidate === type}
            onClick={() => setType(candidate)}
          >
            {TRANSITION_LABELS[candidate]}
          </Button>
        ))}
      </div>
      <label className="block text-xs font-bold">
        Durasi (maks {joint.maxDuration}s)
        <input
          type="range"
          aria-label="Durasi transition popover"
          min={1 / frameRate}
          max={joint.maxDuration}
          step={1 / frameRate}
          value={duration}
          onChange={(event) => setDuration(Number(event.currentTarget.value))}
          className="mt-1 h-11 w-full accent-primary"
        />
      </label>
      <Button
        type="button"
        className="w-full"
        aria-label="Tambahkan transition"
        onClick={() => {
          onAdd(type, Math.min(duration, joint.maxDuration))
          onClose()
        }}
      >
        Tambah
      </Button>
    </div>
  )
}
