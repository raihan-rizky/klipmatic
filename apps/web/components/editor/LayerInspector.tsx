'use client'

import { Copy, Trash2 } from 'lucide-react'
import type { EditSpecV3, TimelineCommand } from '@cheapclipper/engine'
import { Button } from '@/components/ui/button'
import type { TimelineSelection } from './TimelineEditor'
import { AssetInspector } from './AssetInspector'

export function LayerInspector({
  spec,
  selected,
  onCommand,
}: {
  spec: EditSpecV3
  selected: TimelineSelection | null
  onCommand: (command: TimelineCommand) => void
}) {
  const track = spec.timeline.tracks.find((item) => item.id === selected?.trackId)
  if (!track) {
    return <p className="p-5 text-sm text-muted">Pilih layer atau clip untuk melihat pengaturan.</p>
  }
  const finalVideo = track.type === 'video' &&
    spec.timeline.tracks.filter((item) => item.type === 'video').length === 1

  return (
    <div className="space-y-5 p-5">
      {selected?.clipId ? (() => {
        const clip = track.clips.find((item) => item.id === selected.clipId)
        return clip ? (
          <AssetInspector trackId={track.id} clip={clip} onCommand={onCommand} />
        ) : null
      })() : null}
      <div>
        <label htmlFor="layer-name" className="text-sm font-bold">Nama layer</label>
        <input
          id="layer-name"
          value={track.name}
          onChange={(event) => onCommand({ type: 'renameTrack', trackId: track.id, name: event.target.value })}
          className="mt-2 min-h-11 w-full rounded-xl border border-border bg-background px-3"
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          variant="secondary"
          onClick={() => onCommand({
            type: 'duplicateTrack',
            trackId: track.id,
            newTrackId: `${track.id}:copy`,
            clipIds: track.clips.map((clip) => `${clip.id}:copy`),
          })}
        >
          <Copy className="size-4" />
          Duplikat
        </Button>
        <Button
          type="button"
          variant="destructive"
          disabled={track.locked || finalVideo}
          title={finalVideo ? 'Buat video layer lain sebelum menghapus primary layer.' : undefined}
          onClick={() => onCommand({ type: 'deleteTrack', trackId: track.id })}
        >
          <Trash2 className="size-4" />
          Hapus
        </Button>
      </div>
    </div>
  )
}
