'use client'

import { X } from 'lucide-react'
import type { EditorToast } from './useToasts'

const TONE_CLASS: Record<EditorToast['tone'], string> = {
  success: 'border-primary/60',
  info: 'border-border',
  warning: 'border-warning',
}

export function EditorToasts({
  toasts,
  onDismiss,
}: {
  toasts: EditorToast[]
  onDismiss: (id: string) => void
}) {
  if (toasts.length === 0) return null
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none absolute right-3 top-3 z-40 flex w-[min(20rem,90vw)] flex-col gap-2 max-lg:bottom-20 max-lg:left-3 max-lg:right-3 max-lg:top-auto max-lg:w-auto"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`pointer-events-auto flex items-start gap-2 rounded-lg border bg-surface-raised/95 p-3 shadow-xl backdrop-blur ${TONE_CLASS[toast.tone]}`}
        >
          <p className="min-w-0 flex-1 text-sm leading-5">{toast.message}</p>
          <button
            type="button"
            aria-label={`Tutup notifikasi: ${toast.message}`}
            onClick={() => onDismiss(toast.id)}
            className="grid size-6 shrink-0 place-items-center rounded-md text-muted hover:bg-surface-soft hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  )
}
