'use client'

import { RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import type { AutosaveStatus } from './useEditorAutosave'

const STATUS_LABEL: Record<AutosaveStatus, string> = {
  saved: 'Tersimpan',
  unsaved: 'Belum tersimpan',
  saving: 'Menyimpan…',
  error: 'Gagal menyimpan',
}

const STATUS_CLASS: Record<AutosaveStatus, string> = {
  saved: 'text-muted',
  unsaved: 'text-warning',
  saving: 'text-warning',
  error: 'text-danger',
}

export function EditorHeader({
  title,
  duration,
  timingPrecision,
  saveStatus,
  onRetry,
  exporting,
  exportProgress,
  exportSupported,
  exportReason,
  onExport,
}: {
  title: string
  duration: number
  timingPrecision: 'word' | 'estimated'
  saveStatus: AutosaveStatus
  onRetry: () => void
  exporting: boolean
  exportProgress: number
  exportSupported: boolean
  exportReason: string | null
  onExport: () => void
}) {
  return (
    <TooltipProvider delayDuration={200}>
      <header className="border-b border-border bg-surface px-4 py-3 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-primary">
              Video editor
            </p>
            <h1 className="truncate text-xl font-black tracking-normal sm:text-2xl">
              {title}
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span role="status" className={`text-sm font-bold ${STATUS_CLASS[saveStatus]}`}>
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
            {!exportSupported ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="warning">Ekspor tidak didukung</Badge>
                </TooltipTrigger>
                <TooltipContent>{exportReason}</TooltipContent>
              </Tooltip>
            ) : null}
            <Button
              type="button"
              onClick={onExport}
              disabled={exporting || !exportSupported}
              aria-label={
                exporting
                  ? `Mengekspor… ${Math.round(exportProgress * 100)}%`
                  : 'Ekspor MP4'
              }
            >
              {exporting
                ? `Mengekspor… ${Math.round(exportProgress * 100)}%`
                : 'Ekspor MP4'}
            </Button>
          </div>
        </div>
        {exporting ? (
          <Progress
            value={exportProgress * 100}
            aria-label="Progress ekspor"
            className="mt-2 h-1"
          />
        ) : null}
      </header>
    </TooltipProvider>
  )
}
