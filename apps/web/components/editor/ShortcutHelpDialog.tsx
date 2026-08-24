'use client'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'

export interface ShortcutItem {
  keys: string
  action: string
}

export const SHORTCUT_GROUPS: ReadonlyArray<{
  label: string
  items: ReadonlyArray<ShortcutItem>
}> = [
  {
    label: 'Pemutaran',
    items: [
      { keys: 'Space', action: 'Putar / jeda' },
      { keys: '← / →', action: 'Mundur / maju satu frame' },
      { keys: 'Shift + ← / →', action: 'Mundur / maju satu detik' },
      { keys: 'Home / End', action: 'Awal / akhir timeline' },
    ],
  },
  {
    label: 'Editing',
    items: [
      { keys: 'S', action: 'Split di playhead' },
      { keys: 'Delete / Backspace', action: 'Hapus clip terpilih' },
      { keys: 'Ctrl + Z', action: 'Undo' },
      { keys: 'Ctrl + Shift + Z', action: 'Redo' },
    ],
  },
  {
    label: 'Bantuan',
    items: [{ keys: '?', action: 'Buka daftar shortcut ini' }],
  },
]

export function ShortcutHelpDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl" aria-describedby={undefined}>
        <DialogTitle>Shortcut keyboard</DialogTitle>
        <DialogDescription>
          Bekerja di seluruh halaman editor selama fokus tidak di kolom isian.
        </DialogDescription>
        <div className="mt-4 space-y-5">
          {SHORTCUT_GROUPS.map((group) => (
            <section key={group.label} aria-label={group.label}>
              <h3 className="text-xs font-black uppercase tracking-wide text-muted">
                {group.label}
              </h3>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
                {group.items.map((item) => (
                  <div key={item.keys} className="contents">
                    <dt>
                      <kbd className="rounded border border-border bg-surface-soft px-2 py-0.5 font-mono text-xs">
                        {item.keys}
                      </kbd>
                    </dt>
                    <dd className="text-sm">{item.action}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
