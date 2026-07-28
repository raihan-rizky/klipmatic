'use client'

import {
  Pause,
  Play,
  Redo2,
  Scissors,
  Trash2,
  Undo2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { Button } from '@/components/ui/button'

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
}) {
  return (
    <div className="flex min-h-14 items-center gap-1 border-b border-border px-2">
      <Button type="button" size="icon" variant="ghost" aria-label={playing ? 'Pause' : 'Play'} onClick={onTogglePlay}>
        {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
      </Button>
      <Button type="button" size="sm" variant="ghost" aria-label="Split" disabled={!canEdit} onClick={onSplit}>
        <Scissors className="size-4" />
        <span className="hidden sm:inline">Split</span>
      </Button>
      <Button type="button" size="sm" variant="ghost" aria-label="Hapus" disabled={!canEdit} onClick={onDelete}>
        <Trash2 className="size-4" />
        <span className="hidden sm:inline">Hapus</span>
      </Button>
      <span className="mx-1 h-6 w-px bg-border" aria-hidden="true" />
      <Button type="button" size="icon" variant="ghost" aria-label="Undo" disabled={!canUndo} onClick={onUndo}>
        <Undo2 className="size-4" />
      </Button>
      <Button type="button" size="icon" variant="ghost" aria-label="Redo" disabled={!canRedo} onClick={onRedo}>
        <Redo2 className="size-4" />
      </Button>
      <div className="ml-auto flex gap-1">
        <Button type="button" size="icon" variant="ghost" aria-label="Perkecil timeline" onClick={onZoomOut}>
          <ZoomOut className="size-4" />
        </Button>
        <Button type="button" size="icon" variant="ghost" aria-label="Perbesar timeline" onClick={onZoomIn}>
          <ZoomIn className="size-4" />
        </Button>
      </div>
    </div>
  )
}
