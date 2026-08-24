'use client'

import { Blend } from 'lucide-react'
import type { TimelineTransition } from '@klipmatic/engine'
import { TRANSITION_LABELS } from './TransitionLibrary'

export function TimelineTransitionIcon({
  transition,
  left,
  selected,
  onSelect,
}: {
  transition: TimelineTransition
  left: number
  selected: boolean
  onSelect: () => void
}) {
  const label = TRANSITION_LABELS[transition.type]
  return (
    <button
      type="button"
      aria-label={`${label}, ${transition.duration} detik`}
      aria-pressed={selected}
      className={`absolute left-0 top-1/2 z-30 flex size-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-lg border shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
        selected
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border bg-surface-raised text-foreground'
      }`}
      style={{ left }}
      onClick={onSelect}
    >
      <Blend className="size-4" aria-hidden="true" />
    </button>
  )
}
