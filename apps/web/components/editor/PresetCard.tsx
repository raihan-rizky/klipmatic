'use client'

import { Music2, Pause, Play, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { BuiltInMediaAsset } from '@/lib/builtinMedia'

interface PresetCardProps {
  asset: BuiltInMediaAsset
  previewing: boolean
  onTogglePreview: () => void
  onInsert: () => void
}

function durationLabel(duration: number | null): string {
  return duration === null ? '' : `${duration.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}s`
}

export function PresetCard({
  asset,
  previewing,
  onTogglePreview,
  onInsert,
}: PresetCardProps) {
  const startDrag = (event: React.DragEvent<HTMLElement>) => {
    event.dataTransfer.effectAllowed = 'copy'
    event.dataTransfer.setData(
      'application/x-klipmatic-asset',
      JSON.stringify({ assetId: asset.id }),
    )
  }

  if (asset.category === 'sfx') {
    return (
      <article
        draggable
        onDragStart={startDrag}
        className="space-y-3 rounded-lg border border-border bg-surface-raised p-3"
      >
        <div className="flex items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
            <Music2 className="size-5" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-black">{asset.name}</span>
            <span className="block text-xs text-muted">{durationLabel(asset.duration)}</span>
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            aria-label={`${previewing ? 'Stop' : 'Preview'} ${asset.name}`}
            onClick={onTogglePreview}
          >
            {previewing ? (
              <Pause className="size-4" aria-hidden="true" />
            ) : (
              <Play className="size-4" aria-hidden="true" />
            )}
            {previewing ? 'Stop' : 'Preview'}
          </Button>
          <Button
            type="button"
            size="sm"
            aria-label={`Tambahkan ${asset.name}`}
            onClick={onInsert}
          >
            <Plus className="size-4" aria-hidden="true" />
            Insert
          </Button>
        </div>
      </article>
    )
  }

  return (
    <article
      draggable
      onDragStart={startDrag}
      className="group overflow-hidden rounded-lg border border-border bg-surface-raised"
    >
      <div className="aspect-[4/5] overflow-hidden bg-surface-soft">
        <img
          src={asset.thumbnailUrl}
          alt=""
          loading="lazy"
          className="size-full object-cover transition duration-200 group-hover:scale-[1.02]"
        />
      </div>
      <div className="space-y-2 p-3">
        <p className="truncate text-sm font-black">{asset.name}</p>
        <Button
          type="button"
          size="sm"
          className="w-full"
          aria-label={`Tambahkan ${asset.name}`}
          onClick={onInsert}
        >
          <Plus className="size-4" aria-hidden="true" />
          Insert
        </Button>
      </div>
    </article>
  )
}
