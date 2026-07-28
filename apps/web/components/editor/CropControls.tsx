'use client'

import { ScanFace } from 'lucide-react'
import { normalizeEditSpec, type EditSpecV1 } from '@cheapclipper/engine'
import { Button } from '@/components/ui/button'

type CropControlsProps = {
  spec: EditSpecV1
  onChange: (spec: EditSpecV1) => void
  onAutoFocus: () => void
}

const RANGE_CLASS =
  'h-2 w-full cursor-pointer appearance-none rounded-full bg-surface-soft accent-primary outline-none focus-visible:ring-2 focus-visible:ring-primary'

export function CropControls({ spec, onChange, onAutoFocus }: CropControlsProps) {
  return (
    <fieldset className="space-y-5">
      <legend className="text-lg font-black tracking-[-0.025em]">Crop 9:16</legend>
      <p className="text-sm leading-6 text-muted">
        Atur titik fokus agar subjek tetap masuk frame vertikal.
      </p>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <label htmlFor="focus-x" className="text-sm font-bold">Fokus horizontal</label>
          <span className="font-mono text-xs text-muted">{Math.round(spec.crop.focusX * 100)}%</span>
        </div>
        <input
          id="focus-x"
          className={RANGE_CLASS}
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={spec.crop.focusX}
          onChange={(event) =>
            onChange(
              normalizeEditSpec({
                ...spec,
                crop: { ...spec.crop, focusX: event.target.value },
              }),
            )
          }
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <label htmlFor="zoom" className="text-sm font-bold">Zoom</label>
          <span className="font-mono text-xs text-muted">{spec.crop.zoom.toFixed(2)}×</span>
        </div>
        <input
          id="zoom"
          className={RANGE_CLASS}
          type="range"
          min="1"
          max="3"
          step="0.05"
          value={spec.crop.zoom}
          onChange={(event) =>
            onChange(
              normalizeEditSpec({
                ...spec,
                crop: { ...spec.crop, zoom: event.target.value },
              }),
            )
          }
        />
      </div>

      <Button type="button" variant="secondary" className="w-full" onClick={onAutoFocus}>
        <ScanFace className="size-4" aria-hidden="true" />
        Deteksi wajah
      </Button>
    </fieldset>
  )
}
