'use client'

import { Blend, CircleDotDashed, Eclipse } from 'lucide-react'
import {
  DEFAULT_TRANSITION_DURATION,
  TRANSITION_TYPES,
  type TimelineTransition,
  type TransitionJoint,
} from '@cheapclipper/engine'
import { Button } from '@/components/ui/button'

export const TRANSITION_MIME = 'application/x-cheapclipper-transition'

export type TransitionDragPayload = Pick<TimelineTransition, 'type' | 'duration'>

export const TRANSITION_LABELS: Record<TimelineTransition['type'], string> = {
  fade: 'Fade',
  'cross-dissolve': 'Cross Dissolve',
  'dip-to-black': 'Dip to Black',
}

const TRANSITIONS = [
  { type: 'fade' as const, icon: CircleDotDashed },
  { type: 'cross-dissolve' as const, icon: Blend },
  { type: 'dip-to-black' as const, icon: Eclipse },
]

export function parseTransitionDragPayload(raw: string): TransitionDragPayload | null {
  try {
    const value = JSON.parse(raw) as Record<string, unknown>
    if (!TRANSITION_TYPES.includes(value.type as TimelineTransition['type'])) return null
    const duration = Number(value.duration)
    if (!Number.isFinite(duration) || duration <= 0) return null
    return { type: value.type as TimelineTransition['type'], duration }
  } catch {
    return null
  }
}

export function TransitionLibrary({
  selectedJoint,
  onAdd,
  onDragStateChange,
}: {
  selectedJoint: TransitionJoint | null
  onAdd: (
    type: TimelineTransition['type'],
    duration: number,
    joint: TransitionJoint,
  ) => void
  onDragStateChange: (active: boolean) => void
}) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">
        Drag ke sambungan hasil split. Pilih sambungan untuk opsi keyboard.
      </p>
      <ul className="grid grid-cols-1 gap-2">
        {TRANSITIONS.map(({ type, icon: Icon }) => {
          const label = TRANSITION_LABELS[type]
          return (
            <li key={type} className="rounded-xl border border-border bg-surface-raised p-2">
              <button
                type="button"
                draggable
                aria-label={label}
                className="flex min-h-11 w-full items-center gap-3 rounded-lg px-2 text-left font-bold hover:bg-surface-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = 'copy'
                  event.dataTransfer.setData(TRANSITION_MIME, JSON.stringify({
                    type,
                    duration: DEFAULT_TRANSITION_DURATION,
                  } satisfies TransitionDragPayload))
                  onDragStateChange(true)
                }}
                onDragEnd={() => onDragStateChange(false)}
              >
                <Icon className="size-5" aria-hidden="true" />
                <span>{label}</span>
              </button>
              {selectedJoint ? (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="mt-2 w-full"
                  aria-label={`Add ${label} to selected cut`}
                  onClick={() => onAdd(type, DEFAULT_TRANSITION_DURATION, selectedJoint)}
                >
                  Add to selected cut
                </Button>
              ) : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
