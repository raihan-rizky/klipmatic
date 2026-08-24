'use client'

import type { ReactNode } from 'react'

export function PanelHeader({
  title,
  hint,
  actions,
}: {
  title: ReactNode
  hint?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-2 border-b border-border px-4 py-3">
      <div className="min-w-0">
        <h2 className="truncate text-sm font-black uppercase tracking-wide">
          {title}
        </h2>
        {hint ? (
          <p className="mt-0.5 truncate text-xs text-muted">{hint}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      ) : null}
    </div>
  )
}
