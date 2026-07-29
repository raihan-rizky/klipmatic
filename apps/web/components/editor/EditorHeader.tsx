'use client'

import { RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { AutosaveStatus } from './useEditorAutosave'

const STATUS_LABEL: Record<AutosaveStatus, string> = {
  saved: 'Tersimpan',
  unsaved: 'Belum tersimpan',
  saving: 'Menyimpan…',
  error: 'Gagal menyimpan',
}

export function EditorHeader({
  title,
  duration,
  timingPrecision,
  saveStatus,
  onRetry,
}: {
  title: string
  duration: number
  timingPrecision: 'word' | 'estimated'
  saveStatus: AutosaveStatus
  onRetry: () => void
}) {
  return (
    <header className="flex flex-col gap-3 border-b border-border bg-surface px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
      <div className="min-w-0">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-primary">
          Video editor
        </p>
        <h1 className="truncate text-xl font-black tracking-[-0.03em] sm:text-2xl">
          {title}
        </h1>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span
          role="status"
          className={saveStatus === 'error' ? 'text-sm text-danger' : 'text-sm text-muted'}
        >
          {STATUS_LABEL[saveStatus]}
        </span>
        {saveStatus === 'error' && (
          <Button type="button" size="sm" variant="secondary" onClick={onRetry}>
            <RefreshCw className="size-4" aria-hidden="true" />
            Coba simpan lagi
          </Button>
        )}
        <Badge variant="muted">{duration.toFixed(1)} detik</Badge>
        <Badge variant={timingPrecision === 'estimated' ? 'warning' : 'default'}>
          {timingPrecision === 'estimated' ? 'Timing estimasi' : 'Timing presisi'}
        </Badge>
      </div>
    </header>
  )
}
