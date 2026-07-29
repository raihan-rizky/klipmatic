'use client'

import { Download, LoaderCircle, Save } from 'lucide-react'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'

type EditorActionBarProps = {
  saving: boolean
  exporting: boolean
  exportProgress: number
  exportSupported: boolean
  exportReason?: string | null
  onSave: () => void
  onExport: () => void
}

export function EditorActionBar({
  saving,
  exporting,
  exportProgress,
  exportSupported,
  exportReason,
  onSave,
  onExport,
}: EditorActionBarProps) {
  return (
    <div className="mt-6 rounded-2xl border border-border bg-background/90 p-3 shadow-2xl shadow-black/40 backdrop-blur-xl">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        {exporting && (
          <div className="min-w-0 flex-1" role="status">
            <div className="mb-2 flex justify-between text-xs font-bold">
              <span>Mengekspor MP4</span>
              <span className="font-mono text-primary">
                {Math.round(exportProgress * 100)}%
              </span>
            </div>
            <Progress value={exportProgress * 100} aria-label="Progress ekspor" />
          </div>
        )}
        {!exporting && !exportSupported && (
          <Alert tone="warning" role="alert" className="flex-1">
            {exportReason}
          </Alert>
        )}
        {!exporting && exportSupported && (
          <p className="flex-1 px-2 text-sm text-muted">
            Autosave aktif. Kamu juga bisa simpan sekarang atau ekspor MP4.
          </p>
        )}
        <div className="flex gap-2">
          <Button type="button" variant="secondary" onClick={onSave} disabled={saving}>
            {saving ? (
              <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Save className="size-4" aria-hidden="true" />
            )}
            {saving ? 'Menyimpan…' : 'Simpan sekarang'}
          </Button>
          <Button type="button" onClick={onExport} disabled={exporting || !exportSupported}>
            {exporting ? (
              <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Download className="size-4" aria-hidden="true" />
            )}
            {exporting ? 'Mengekspor…' : 'Ekspor MP4'}
          </Button>
        </div>
      </div>
    </div>
  )
}
