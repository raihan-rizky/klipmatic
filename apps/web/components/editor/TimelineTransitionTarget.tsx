'use client'

import type { TimelineTransition } from '@klipmatic/engine'
import {
  parseTransitionDragPayload,
  TRANSITION_MIME,
} from './TransitionLibrary'

export function TimelineTransitionTarget({
  left,
  ariaLabel,
  visible = true,
  onSelect,
  onAdd,
}: {
  left: number
  ariaLabel: string
  visible?: boolean
  onSelect?: () => void
  onAdd: (type: TimelineTransition['type'], duration: number) => void
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      className={`absolute inset-y-0 z-20 w-11 -translate-x-1/2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
        visible ? 'cursor-copy' : 'pointer-events-none opacity-0'
      }`}
      style={{ left }}
      onClick={onSelect}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes(TRANSITION_MIME)) return
        event.preventDefault()
        event.stopPropagation()
        event.dataTransfer.dropEffect = 'copy'
      }}
      onDrop={(event) => {
        const payload = parseTransitionDragPayload(
          event.dataTransfer.getData(TRANSITION_MIME),
        )
        if (!payload) return
        event.preventDefault()
        event.stopPropagation()
        onAdd(payload.type, payload.duration)
      }}
    >
      <span className="absolute inset-y-2 left-1/2 w-0.5 -translate-x-1/2 rounded-full bg-primary/70" />
    </button>
  )
}
