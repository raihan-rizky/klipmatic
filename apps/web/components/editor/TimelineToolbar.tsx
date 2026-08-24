'use client'

import { useEffect, useState } from 'react'
import {
  Keyboard,
  Pause,
  Play,
  Redo2,
  Scissors,
  Trash2,
  Undo2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

const HINT_KEY = 'klipmatic-shortcut-hint-dismissed'

function KbdHint({ keys }: { keys: string }) {
  return (
    <span className="ml-1 rounded border border-border bg-surface-soft px-1 font-mono text-[10px]">
      {keys}
    </span>
  )
}

function ToolButton({
  label,
  keys,
  children,
  ...buttonProps
}: React.ComponentProps<typeof Button> & { label: string; keys?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" {...buttonProps}>{children}</Button>
      </TooltipTrigger>
      <TooltipContent>
        {label}
        {keys ? <KbdHint keys={keys} /> : null}
      </TooltipContent>
    </Tooltip>
  )
}

export function TimelineToolbar({
  playing,
  canEdit,
  canUndo,
  canRedo,
  onTogglePlay,
  onSplit,
  onDelete,
  onUndo,
  onRedo,
  onZoomIn,
  onZoomOut,
  onShowShortcuts,
}: {
  playing: boolean
  canEdit: boolean
  canUndo: boolean
  canRedo: boolean
  onTogglePlay: () => void
  onSplit: () => void
  onDelete: () => void
  onUndo: () => void
  onRedo: () => void
  onZoomIn: () => void
  onZoomOut: () => void
  onShowShortcuts: () => void
}) {
  const [hintVisible, setHintVisible] = useState(false)

  useEffect(() => {
    try {
      if (window.localStorage.getItem(HINT_KEY) !== '1') setHintVisible(true)
    } catch {
      setHintVisible(true)
    }
  }, [])

  const hideHint = () => {
    setHintVisible(false)
    try {
      window.localStorage.setItem(HINT_KEY, '1')
    } catch {
      // Storage bisa diblokir; pill cukup hilang untuk session ini.
    }
  }

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex min-h-14 items-center gap-1 border-b border-border px-2">
        <ToolButton label={playing ? 'Pause' : 'Play'} keys="Spasi" size="icon" variant="ghost" aria-label={playing ? 'Pause' : 'Play'} onClick={onTogglePlay}>
          {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
        </ToolButton>
        <ToolButton label="Split" keys="S" size="sm" variant="ghost" aria-label="Split" disabled={!canEdit} onClick={onSplit}>
          <Scissors className="size-4" />
          <span className="hidden sm:inline">Split</span>
        </ToolButton>
        <ToolButton label="Hapus" keys="Del" size="sm" variant="ghost" aria-label="Hapus" disabled={!canEdit} onClick={onDelete}>
          <Trash2 className="size-4" />
          <span className="hidden sm:inline">Hapus</span>
        </ToolButton>
        <span className="mx-1 h-6 w-px bg-border" aria-hidden="true" />
        <ToolButton label="Undo" keys="Ctrl+Z" size="icon" variant="ghost" aria-label="Undo" disabled={!canUndo} onClick={onUndo}>
          <Undo2 className="size-4" />
        </ToolButton>
        <ToolButton label="Redo" keys="Ctrl+Shift+Z" size="icon" variant="ghost" aria-label="Redo" disabled={!canRedo} onClick={onRedo}>
          <Redo2 className="size-4" />
        </ToolButton>
        {hintVisible ? (
          <span className="ml-auto hidden items-center gap-1 rounded-full border border-border px-2 py-1 text-xs text-muted sm:inline-flex">
            Tekan
            <kbd className="rounded border border-border bg-surface-soft px-1 font-mono text-[10px]">?</kbd>
            untuk shortcut
            <button
              type="button"
              aria-label="Sembunyikan hint shortcut"
              onClick={hideHint}
              className="grid size-5 place-items-center rounded text-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              ×
            </button>
          </span>
        ) : null}
        <div className={cn('flex gap-1', !hintVisible && 'ml-auto')}>
          <ToolButton label="Perkecil timeline" size="icon" variant="ghost" aria-label="Perkecil timeline" onClick={onZoomOut}>
            <ZoomOut className="size-4" />
          </ToolButton>
          <ToolButton label="Perbesar timeline" size="icon" variant="ghost" aria-label="Perbesar timeline" onClick={onZoomIn}>
            <ZoomIn className="size-4" />
          </ToolButton>
          <ToolButton label="Daftar shortcut" keys="?" size="icon" variant="ghost" aria-label="Shortcut keyboard" onClick={() => {
            hideHint()
            onShowShortcuts()
          }}>
            <Keyboard className="size-4" />
          </ToolButton>
        </div>
      </div>
    </TooltipProvider>
  )
}
