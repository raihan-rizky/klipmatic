'use client'

import { Copy, Film, Trash2 } from 'lucide-react'
import type { EditSpecV3, TimelineCommand } from '@klipmatic/engine'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Button } from '@/components/ui/button'
import type { TimelineSelection } from './TimelineEditor'
import { AssetInspector } from './AssetInspector'
import { PanelHeader } from './PanelHeader'
import { TRANSITION_LABELS } from './TransitionLibrary'
import { TransitionInspector } from './TransitionInspector'

export function selectionHeading(
  spec: EditSpecV3,
  selected: TimelineSelection | null,
  assetNames: Record<string, string>,
): { title: string; hint: string } {
  if (selected?.kind === 'transition') {
    const transition = spec.timeline.transitions.find(
      (item) => item.id === selected.transitionId,
    )
    return {
      title: `Transition Â· ${transition ? TRANSITION_LABELS[transition.type] : '?'}`,
      hint: 'Atur tipe dan durasi tanpa mengubah panjang video.',
    }
  }
  if (selected?.kind === 'joint') {
    return {
      title: 'Cut point',
      hint: 'Pilih tipe transition langsung di popover timeline.',
    }
  }
  const track = spec.timeline.tracks.find((item) => item.id === selected?.trackId)
  if (selected?.kind === 'clip' && track) {
    const clip = track.clips.find((item) => item.id === selected.clipId)
    const name = clip ? assetNames[clip.assetId] ?? clip.assetId : '?'
    return {
      title: `Clip Â· ${name}`,
      hint: 'Geser di canvas untuk memindah atau resize overlay.',
    }
  }
  if (track) {
    return {
      title: `Track Â· ${track.name}`,
      hint: 'Rename, duplikat, atau hapus layer.',
    }
  }
  return {
    title: 'Editor',
    hint: 'Pilih clip di timeline atau drop media ke preview.',
  }
}

export function LayerInspector({
  spec,
  selected,
  onCommand,
  assetNames = {},
  onSelectFirstClip,
  onOpenMedia,
}: {
  spec: EditSpecV3
  selected: TimelineSelection | null
  onCommand: (command: TimelineCommand) => void
  assetNames?: Record<string, string>
  onSelectFirstClip?: () => void
  onOpenMedia?: () => void
}) {
  const heading = selectionHeading(spec, selected, assetNames)

  if (selected?.kind === 'transition') {
    return (
      <>
        <PanelHeader title={heading.title} hint={heading.hint} />
        <TransitionInspector
          spec={spec}
          transitionId={selected.transitionId}
          onCommand={onCommand}
        />
      </>
    )
  }
  if (selected?.kind === 'joint') {
    return <PanelHeader title={heading.title} hint={heading.hint} />
  }
  const track = spec.timeline.tracks.find((item) => item.id === selected?.trackId)
  if (!track) {
    return (
      <>
        <PanelHeader title={heading.title} hint={heading.hint} />
        <div className="space-y-3 p-5">
          <Film className="size-6 text-muted" aria-hidden="true" />
          <div className="grid gap-2">
            <Button
              type="button"
              variant="secondary"
              aria-label="Pilih clip pertama"
              onClick={() => onSelectFirstClip?.()}
            >
              Pilih clip pertama
            </Button>
            <Button
              type="button"
              variant="ghost"
              aria-label="Buka Media"
              onClick={() => onOpenMedia?.()}
            >
              Buka Media
            </Button>
          </div>
        </div>
      </>
    )
  }
  const finalVideo = track.type === 'video' &&
    spec.timeline.tracks.filter((item) => item.type === 'video').length === 1

  return (
    <>
      <PanelHeader title={heading.title} hint={heading.hint} />
      <div className="space-y-5 p-5">
        {selected?.kind === 'clip' ? (() => {
          const clip = track.clips.find((item) => item.id === selected.clipId)
          return clip ? (
            <AssetInspector trackId={track.id} clip={clip} onCommand={onCommand} />
          ) : null
        })() : null}
        <Accordion
          type="single"
          collapsible
          defaultValue={selected?.kind === 'track' ? 'layer-settings' : undefined}
        >
          <AccordionItem value="layer-settings">
            <AccordionTrigger>Layer settings</AccordionTrigger>
            <AccordionContent className="space-y-5">
              <div>
                <label htmlFor="layer-name" className="text-sm font-bold">Nama layer</label>
                <input
                  id="layer-name"
                  value={track.name}
                  onChange={(event) => onCommand({ type: 'renameTrack', trackId: track.id, name: event.target.value })}
                  className="mt-2 min-h-11 w-full rounded-lg border border-border bg-background px-3"
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
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>
    </>
  )
}
