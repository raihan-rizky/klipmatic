'use client'

import { Captions } from 'lucide-react'
import { normalizeEditSpec, type EditSpecV1 } from '@cheapclipper/engine'

type CaptionControlsProps = {
  spec: EditSpecV1
  onChange: (spec: EditSpecV1) => void
}

const RANGE_CLASS =
  'h-2 w-full cursor-pointer appearance-none rounded-full bg-surface-soft accent-primary outline-none focus-visible:ring-2 focus-visible:ring-primary'

export function CaptionControls({ spec, onChange }: CaptionControlsProps) {
  return (
    <fieldset className="space-y-5">
      <legend className="flex items-center gap-2 text-lg font-black tracking-[-0.025em]">
        <Captions className="size-5 text-primary" aria-hidden="true" />
        Caption
      </legend>

      <label className="flex min-h-12 cursor-pointer items-center justify-between gap-4 rounded-xl border border-border bg-background/40 px-4">
        <span className="text-sm font-bold">Tampilkan caption karaoke</span>
        <input
          type="checkbox"
          className="size-5 accent-primary outline-none focus-visible:ring-2 focus-visible:ring-primary"
          checked={spec.captions.enabled}
          onChange={(event) =>
            onChange(
              normalizeEditSpec({
                ...spec,
                captions: { ...spec.captions, enabled: event.target.checked },
              }),
            )
          }
        />
      </label>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <label htmlFor="font-size" className="text-sm font-bold">Ukuran font</label>
          <span className="font-mono text-xs text-muted">{spec.captions.fontSize}px</span>
        </div>
        <input
          id="font-size"
          className={RANGE_CLASS}
          type="range"
          min="32"
          max="140"
          value={spec.captions.fontSize}
          onChange={(event) =>
            onChange(
              normalizeEditSpec({
                ...spec,
                captions: { ...spec.captions, fontSize: event.target.value },
              }),
            )
          }
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <label htmlFor="caption-y" className="text-sm font-bold">Posisi vertikal</label>
          <span className="font-mono text-xs text-muted">
            {Math.round(spec.captions.positionY * 100)}%
          </span>
        </div>
        <input
          id="caption-y"
          className={RANGE_CLASS}
          type="range"
          min="0.15"
          max="0.9"
          step="0.01"
          value={spec.captions.positionY}
          onChange={(event) =>
            onChange(
              normalizeEditSpec({
                ...spec,
                captions: { ...spec.captions, positionY: event.target.value },
              }),
            )
          }
        />
      </div>

      <div className="flex min-h-12 items-center justify-between gap-4 rounded-xl border border-border bg-background/40 px-4">
        <label htmlFor="active-color" className="text-sm font-bold">Warna kata aktif</label>
        <input
          id="active-color"
          type="color"
          className="size-8 cursor-pointer rounded-md border-0 bg-transparent"
          value={spec.captions.activeColor.slice(0, 7)}
          onChange={(event) =>
            onChange(
              normalizeEditSpec({
                ...spec,
                captions: { ...spec.captions, activeColor: event.target.value },
              }),
            )
          }
        />
      </div>
    </fieldset>
  )
}
