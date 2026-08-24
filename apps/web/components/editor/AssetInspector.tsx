'use client'

import type { TimelineClip, TimelineCommand, VisualTransform } from '@klipmatic/engine'

const INPUT_CLASS =
  'mt-1 min-h-11 w-full rounded-lg border border-border bg-background px-3 text-sm tabular-nums'

export function AssetInspector({
  trackId,
  clip,
  onCommand,
}: {
  trackId: string
  clip: TimelineClip
  onCommand: (command: TimelineCommand) => void
}) {
  const transform = clip.transform
  const update = (field: keyof VisualTransform, value: number) => {
    if (!transform || !Number.isFinite(value)) return
    const next = { ...transform, [field]: value }
    next.width = Math.min(Math.max(next.width, 0.05), 1 - next.x)
    next.height = Math.min(Math.max(next.height, 0.05), 1 - next.y)
    next.x = Math.min(Math.max(next.x, 0), 1 - next.width)
    next.y = Math.min(Math.max(next.y, 0), 1 - next.height)
    onCommand({
      type: 'updateVisualTransform',
      trackId,
      clipId: clip.id,
      transform: next,
    })
  }

  return (
    <fieldset className="space-y-4">
      <legend className="text-sm font-black">Media clip</legend>
      {transform ? (
        <div className="grid grid-cols-2 gap-3">
          {([
            ['x', 'Posisi X'],
            ['y', 'Posisi Y'],
            ['width', 'Lebar'],
            ['height', 'Tinggi'],
          ] as const).map(([field, label]) => (
            <label key={field} className="text-xs font-bold">
              {label}
              <input
                className={INPUT_CLASS}
                type="number"
                min="0"
                max="1"
                step="0.01"
                aria-label={label}
                value={transform[field]}
                onChange={(event) => update(field, Number(event.currentTarget.value))}
              />
            </label>
          ))}
        </div>
      ) : null}
      <label className="flex min-h-12 items-center justify-between gap-3 rounded-lg border border-border px-3 text-sm font-bold">
        Bisukan clip
        <input
          type="checkbox"
          className="size-5 accent-primary"
          checked={clip.muted}
          onChange={(event) => onCommand({
            type: 'setClipMuted',
            trackId,
            clipId: clip.id,
            muted: event.currentTarget.checked,
          })}
        />
      </label>
    </fieldset>
  )
}
