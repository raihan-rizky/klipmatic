# Editor Page Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merevitalisasi halaman editor `/clips/[id]`: wayfinding panel, feedback yang terlihat (toast + banner), shortcut global + cheat sheet, popover transition pada cut point, performa redraw/playhead, dan paritas mobile.

**Architecture:** Semua perubahan berada di `apps/web` (komponen editor + hook baru). Skeleton 3-region desktop dipertahankan; engine `@klipmatic/engine` dan pipeline export tidak disentuh. Helper performa diekstrak sebagai modul pure agar mudah dites.

**Tech Stack:** Next.js 15 App Router, React 19, Tailwind v4, Radix UI (Dialog/Tooltip/Accordion), lucide-react, vitest + testing-library (jsdom), bun workspace.

**Spec:** `docs/superpowers/specs/2026-08-23-editor-page-overhaul-design.md`

## Global Constraints

- Bahasa UI: Indonesia (konsisten dengan kode existing — semua `aria-label`, copy, pesan).
- Semua kontrol interaktif ≥44×44px (`size-11` / `min-h-11`; sebagian besar sudah ada).
- Tidak mengubah paket `@klipmatic/engine`, `@klipmatic/db`, worker, atau API route mana pun.
- Tipe transition hanya 3: `fade`, `cross-dissolve`, `dip-to-black` (dari `TRANSITION_TYPES` engine).
- Animasi <200ms dan hormati `prefers-reduced-motion` (kelas `.editor-workspace *` sudah dinolkan di globals.css).
- Jalankan tes dari `apps/web/` dengan `bunx vitest run test/<file>`; suite penuh dari root: `bun run test`. Typecheck: `bun run typecheck` (root, turbo).
- Setiap task diakhiri commit; JANGAN pernah `git add -A` karena working tree berisi perubahan rebrand milik user yang belum selesai — tambahkan hanya file yang disebut di langkah commit.
- File test baru memerlukan header `// @vitest-environment jsdom` (konvensi existing).

---

### Task 1: Helper performa `frameScheduler` (throttle redraw + rAF sink)

**Files:**
- Create: `apps/web/components/editor/frameScheduler.ts`
- Create: `apps/web/test/frameScheduler.test.ts`

**Interfaces:**
- Consumes: tidak ada (modul pure).
- Produces:
  - `createFrameThrottle(draw: () => void, options?: { minIntervalMs?: number; now?: () => number; schedule?: (cb: () => void, delayMs: number) => () => void }): FrameThrottle`
  - `interface FrameThrottle { request(): void; force(): void; cancel(): void }`
    - `request()`: gambar langsung bila never-drawn atau jeda ≥ minInterval; selain itu gabungkan jadi SATU panggilan trailing (coalesce), tidak menumpuk timer.
    - `force()`: gambar langsung + batalkan pending trailing.
  - `createRafSink(flush: (value: number) => void, requestFrame?, cancelFrame?): RafSink`
  - `interface RafSink { push(value: number): void; dispose(): void }` — banyak push per frame → tepat satu flush dengan nilai terakhir; hanya satu rAF aktif.

- [ ] **Step 1: Tulis test gagal**

Buat `apps/web/test/frameScheduler.test.ts`:

```ts
import { describe, expect, test, vi } from 'vitest'
import {
  createFrameThrottle,
  createRafSink,
} from '@/components/editor/frameScheduler'

function fakeSchedule() {
  const pending: Array<{ cb: () => void; at: number }> = []
  let time = 0
  const schedule = (cb: () => void, delayMs: number) => {
    const entry = { cb, at: time + delayMs }
    pending.push(entry)
    return () => {
      const index = pending.indexOf(entry)
      if (index >= 0) pending.splice(index, 1)
    }
  }
  return {
    schedule,
    advance(ms: number) {
      time += ms
      for (const entry of [...pending].sort((a, b) => a.at - b.at)) {
        if (entry.at <= time) {
          pending.splice(pending.indexOf(entry), 1)
          entry.cb()
        }
      }
    },
    get count() {
      return pending.length
    },
  }
}

describe('createFrameThrottle', () => {
  test('request pertama menggambar langsung', () => {
    const draw = vi.fn()
    const throttle = createFrameThrottle(draw, { minIntervalMs: 33 })
    throttle.request()
    expect(draw).toHaveBeenCalledTimes(1)
    throttle.cancel()
  })

  test('request dalam interval digabung jadi satu draw trailing', () => {
    const clock = fakeSchedule()
    const draw = vi.fn()
    const throttle = createFrameThrottle(draw, {
      minIntervalMs: 33,
      now: () => 0,
      schedule: clock.schedule,
    })
    throttle.request()
    expect(draw).toHaveBeenCalledTimes(1)
    clock.advance(10)
    throttle.request()
    throttle.request()
    expect(draw).toHaveBeenCalledTimes(1)
    expect(clock.count).toBe(1)
    clock.advance(23)
    expect(draw).toHaveBeenCalledTimes(2)
    throttle.cancel()
  })

  test('force menggambar langsung dan membatalkan trailing', () => {
    const clock = fakeSchedule()
    const draw = vi.fn()
    const throttle = createFrameThrottle(draw, {
      minIntervalMs: 33,
      now: () => 0,
      schedule: clock.schedule,
    })
    throttle.request()
    clock.advance(10)
    throttle.request()
    throttle.force()
    expect(draw).toHaveBeenCalledTimes(2)
    expect(clock.count).toBe(0)
    clock.advance(100)
    expect(draw).toHaveBeenCalledTimes(2)
    throttle.cancel()
  })

  test('request setelah interval penuh menggambar langsung lagi', () => {
    const clock = fakeSchedule()
    const draw = vi.fn()
    const throttle = createFrameThrottle(draw, {
      minIntervalMs: 33,
      now: () => 0,
      schedule: clock.schedule,
    })
    throttle.request()
    clock.advance(40)
    throttle.request()
    expect(draw).toHaveBeenCalledTimes(2)
    throttle.cancel()
  })
})

describe('createRafSink', () => {
  test('banyak push dalam satu frame = satu flush dengan nilai terakhir', () => {
    let frameCb: FrameRequestCallback | null = null
    const raf = vi.fn((cb: FrameRequestCallback) => {
      frameCb = cb
      return 1
    })
    const cancelRaf = vi.fn()
    const flush = vi.fn()
    const sink = createRafSink(flush, raf, cancelRaf)
    sink.push(1)
    sink.push(2)
    sink.push(3)
    expect(flush).not.toHaveBeenCalled()
    frameCb!(performance.now())
    expect(flush).toHaveBeenCalledTimes(1)
    expect(flush).toHaveBeenCalledWith(3)
    sink.dispose()
  })

  test('push setelah frame terjadwal tidak membuat rAF kedua', () => {
    let calls = 0
    const raf = vi.fn((cb: FrameRequestCallback) => {
      calls += 1
      cb(performance.now())
      return calls
    })
    const flush = vi.fn()
    const sink = createRafSink(flush, raf, () => undefined)
    sink.push(1)
    sink.push(2)
    expect(raf).toHaveBeenCalledTimes(1)
    sink.dispose()
  })

  test('dispose membatalkan frame terjadwal', () => {
    const cancelRaf = vi.fn()
    const raf = vi.fn(() => 7)
    const sink = createRafSink(vi.fn(), raf, cancelRaf)
    sink.push(1)
    sink.dispose()
    expect(cancelRaf).toHaveBeenCalledWith(7)
  })
})
```

- [ ] **Step 2: Verifikasi test gagal**

Run (cwd `apps/web`): `bunx vitest run test/frameScheduler.test.ts`
Expected: FAIL — module `@/components/editor/frameScheduler` tidak ditemukan.

- [ ] **Step 3: Implementasi minimal**

Buat `apps/web/components/editor/frameScheduler.ts`:

```ts
export interface FrameThrottle {
  request(): void
  force(): void
  cancel(): void
}

export function createFrameThrottle(
  draw: () => void,
  options?: {
    minIntervalMs?: number
    now?: () => number
    schedule?: (callback: () => void, delayMs: number) => () => void
  },
): FrameThrottle {
  const minIntervalMs = options?.minIntervalMs ?? 33
  const now = options?.now ?? (() => performance.now())
  const schedule = options?.schedule ??
    ((callback: () => void, delayMs: number) => {
      const handle = setTimeout(callback, delayMs)
      return () => clearTimeout(handle)
    })
  let lastDrawAt: number | null = null
  let cancelPending: (() => void) | null = null

  const clearPending = () => {
    cancelPending?.()
    cancelPending = null
  }

  return {
    request() {
      const time = now()
      if (lastDrawAt === null || time - lastDrawAt >= minIntervalMs) {
        clearPending()
        lastDrawAt = time
        draw()
        return
      }
      if (cancelPending !== null) return
      const remaining = lastDrawAt + minIntervalMs - time
      cancelPending = schedule(() => {
        cancelPending = null
        lastDrawAt = now()
        draw()
      }, remaining)
    },
    force() {
      clearPending()
      lastDrawAt = now()
      draw()
    },
    cancel() {
      clearPending()
    },
  }
}

export interface RafSink {
  push(value: number): void
  dispose(): void
}

export function createRafSink(
  flush: (value: number) => void,
  requestFrame: (callback: FrameRequestCallback) => number =
    typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : (cb) => setTimeout(() => cb(performance.now()), 16) as unknown as number,
  cancelFrame: (handle: number) => void =
    typeof cancelAnimationFrame === 'function'
      ? cancelAnimationFrame
      : ((handle: number) => clearTimeout(handle)) as (handle: number) => void,
): RafSink {
  let latest: number | null = null
  let handle: number | null = null
  return {
    push(value: number) {
      latest = value
      if (handle !== null) return
      handle = requestFrame(() => {
        handle = null
        if (latest === null) return
        flush(latest)
        latest = null
      })
    },
    dispose() {
      if (handle !== null) cancelFrame(handle)
      handle = null
      latest = null
    },
  }
}
```

- [ ] **Step 4: Verifikasi test lulus**

Run (cwd `apps/web`): `bunx vitest run test/frameScheduler.test.ts`
Expected: PASS semua.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/editor/frameScheduler.ts apps/web/test/frameScheduler.test.ts
git commit -m "feat(editor): add frame throttle and raf sink helpers"
```

---

### Task 2: Sistem toast (`useToasts` + `EditorToasts`)

**Files:**
- Create: `apps/web/components/editor/useToasts.ts`
- Create: `apps/web/components/editor/EditorToasts.tsx`
- Create: `apps/web/test/useToasts.test.ts`
- Create: `apps/web/test/EditorToasts.test.tsx`

**Interfaces:**
- Consumes: tidak ada.
- Produces:
  - `type ToastTone = 'success' | 'info' | 'warning'`
  - `interface EditorToast { id: string; tone: ToastTone; message: string }`
  - `useToasts(options?: { durationMs?: Partial<Record<ToastTone, number>> }): { toasts: EditorToast[]; showToast(message: string, tone?: ToastTone): void; dismissToast(id: string): void }`
  - Durasi default: success/info 4000ms, warning 8000ms. Maksimal 3 toast tampil; lebihnya ANTRE dan muncul saat ada slot kosong (setelah dismiss/auto-dismiss).
  - `EditorToasts({ toasts, onDismiss }: { toasts: EditorToast[]; onDismiss(id: string): void })` — stack absolut `top-right` desktop, pindah ke bawah (`bottom`) di mobile via kelas `max-lg:*`; container `role="status" aria-live="polite"`; tiap toast punya tombol tutup `aria-label="Tutup notifikasi: {message}"`.

- [ ] **Step 1: Tulis test hook gagal**

Buat `apps/web/test/useToasts.test.ts`:

```ts
// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { useToasts } from '@/components/editor/useToasts'

afterEach(() => {
  vi.useRealTimers()
})

test('showToast menambah toast dan auto-dismiss sesuai durasi tone', () => {
  vi.useFakeTimers()
  const { result } = renderHook(() => useToasts())

  act(() => result.current.showToast('Tersimpan.', 'success'))
  expect(result.current.toasts).toHaveLength(1)
  expect(result.current.toasts[0]).toMatchObject({
    tone: 'success',
    message: 'Tersimpan.',
  })

  act(() => vi.advanceTimersByTime(4000))
  expect(result.current.toasts).toHaveLength(0)
})

test('warning bertahan lebih lama dari success', () => {
  vi.useFakeTimers()
  const { result } = renderHook(() => useToasts())
  act(() => result.current.showToast('Hampir hapus.', 'warning'))
  act(() => vi.advanceTimersByTime(4000))
  expect(result.current.toasts).toHaveLength(1)
  act(() => vi.advanceTimersByTime(4000))
  expect(result.current.toasts).toHaveLength(0)
})

test('maksimal 3 tampil, sisanya antre lalu muncul setelah slot bebas', () => {
  vi.useFakeTimers()
  const { result } = renderHook(() => useToasts())
  act(() => {
    for (let index = 0; index < 5; index += 1) {
      result.current.showToast(`pesan ${index}`, 'info')
    }
  })
  expect(result.current.toasts).toHaveLength(3)

  act(() => result.current.dismissToast(result.current.toasts[0]!.id))
  expect(result.current.toasts).toHaveLength(3)
  expect(result.current.toasts.map((toast) => toast.message)).toEqual([
    'pesan 3',
    'pesan 2',
    'pesan 4',
  ])
})

test('dismissToast menghapus toast spesifik', () => {
  vi.useFakeTimers()
  const { result } = renderHook(() => useToasts())
  act(() => result.current.showToast('satu', 'info'))
  act(() => result.current.showToast('dua', 'info'))
  const firstId = result.current.toasts[0]!.id
  act(() => result.current.dismissToast(firstId))
  expect(result.current.toasts.map((toast) => toast.message)).toEqual(['dua'])
})
```

- [ ] **Step 2: Tulis test komponen gagal**

Buat `apps/web/test/EditorToasts.test.tsx`:

```tsx
// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import { EditorToasts } from '@/components/editor/EditorToasts'

afterEach(cleanup)

const toasts = [
  { id: 't1', tone: 'success' as const, message: 'Fokus crop mengikuti wajah.' },
  { id: 't2', tone: 'warning' as const, message: 'logo.png akan dihapus.' },
]

test('merender stack dengan aria-live polite dan tombol tutup per toast', async () => {
  const onDismiss = vi.fn()
  render(<EditorToasts toasts={toasts} onDismiss={onDismiss} />)

  const stack = screen.getByRole('status')
  expect(stack).toHaveAttribute('aria-live', 'polite')
  expect(screen.getByText('Fokus crop mengikuti wajah.')).toBeVisible()

  await userEvent.click(
    screen.getByLabelText('Tutup notifikasi: logo.png akan dihapus.'),
  )
  expect(onDismiss).toHaveBeenCalledWith('t2')
})
```

- [ ] **Step 3: Verifikasi gagal**

Run (cwd `apps/web`): `bunx vitest run test/useToasts.test.ts test/EditorToasts.test.tsx`
Expected: FAIL — modul tidak ditemukan.

- [ ] **Step 4: Implementasi hook**

Buat `apps/web/components/editor/useToasts.ts`:

```ts
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export type ToastTone = 'success' | 'info' | 'warning'

export interface EditorToast {
  id: string
  tone: ToastTone
  message: string
}

const DEFAULT_DURATIONS: Record<ToastTone, number> = {
  success: 4000,
  info: 4000,
  warning: 8000,
}

const MAX_VISIBLE = 3

export function useToasts(options?: {
  durationMs?: Partial<Record<ToastTone, number>>
}) {
  const durations = { ...DEFAULT_DURATIONS, ...options?.durationMs }
  const [toasts, setToasts] = useState<EditorToast[]>([])
  const queueRef = useRef<EditorToast[]>([])
  const timersRef = useRef(new Map<string, number>())

  const scheduleAutoDismiss = useCallback(
    (toast: EditorToast) => {
      const timer = window.setTimeout(() => {
        timersRef.current.delete(toast.id)
        setToasts((current) => {
          const next = current.filter((item) => item.id !== toast.id)
          const queued = queueRef.current.shift()
          if (queued) {
            next.push(queued)
            scheduleAutoDismiss(queued)
          }
          return next
        })
      }, durations[toast.tone])
      timersRef.current.set(toast.id, timer)
    },
    // durations adalah objek baru tiap render bila options dikirim; kunci oleh
    // nilai primitifnya lewat JSON agar callback stabil.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [durations.success, durations.info, durations.warning],
  )

  const showToast = useCallback(
    (message: string, tone: ToastTone = 'info') => {
      const toast: EditorToast = {
        id: globalThis.crypto.randomUUID(),
        tone,
        message,
      }
      setToasts((current) => {
        if (current.length >= MAX_VISIBLE) {
          queueRef.current.push(toast)
          return current
        }
        scheduleAutoDismiss(toast)
        return [...current, toast]
      })
    },
    [scheduleAutoDismiss],
  )

  const dismissToast = useCallback(
    (id: string) => {
      const timer = timersRef.current.get(id)
      if (timer !== undefined) {
        window.clearTimeout(timer)
        timersRef.current.delete(id)
      }
      queueRef.current = queueRef.current.filter((item) => item.id !== id)
      setToasts((current) => {
        const next = current.filter((item) => item.id !== id)
        if (next.length < MAX_VISIBLE) {
          const queued = queueRef.current.shift()
          if (queued) {
            next.push(queued)
            scheduleAutoDismiss(queued)
          }
        }
        return next
      })
    },
    [scheduleAutoDismiss],
  )

  useEffect(
    () => () => {
      for (const timer of timersRef.current.values()) window.clearTimeout(timer)
      timersRef.current.clear()
      queueRef.current = []
    },
    [],
  )

  return { toasts, showToast, dismissToast }
}
```

Catatan tentang test "slot bebas": urutan akhir `[pesan 3, pesan 2, pesan 4]`
muncul karena dismiss index pertama memicu shift antrean `pesan 3`, sementara
auto-dismiss `pesan 2` (masih dalam window 4 detik fake timers BELUM dijalankan)
— test ini deterministic karena fake timers tidak maju; `pesan 2` masih tampil.

- [ ] **Step 5: Implementasi komponen**

Buat `apps/web/components/editor/EditorToasts.tsx`:

```tsx
'use client'

import { X } from 'lucide-react'
import type { EditorToast } from './useToasts'

const TONE_CLASS: Record<EditorToast['tone'], string> = {
  success: 'border-primary/60',
  info: 'border-border',
  warning: 'border-warning',
}

export function EditorToasts({
  toasts,
  onDismiss,
}: {
  toasts: EditorToast[]
  onDismiss: (id: string) => void
}) {
  if (toasts.length === 0) return null
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none absolute right-3 top-3 z-40 flex w-[min(20rem,90vw)] flex-col gap-2 max-lg:bottom-20 max-lg:left-3 max-lg:right-3 max-lg:top-auto max-lg:w-auto"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`pointer-events-auto flex items-start gap-2 rounded-lg border bg-surface-raised/95 p-3 shadow-xl backdrop-blur ${TONE_CLASS[toast.tone]}`}
        >
          <p className="min-w-0 flex-1 text-sm leading-5">{toast.message}</p>
          <button
            type="button"
            aria-label={`Tutup notifikasi: ${toast.message}`}
            onClick={() => onDismiss(toast.id)}
            className="grid size-6 shrink-0 place-items-center rounded-md text-muted hover:bg-surface-soft hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 6: Verifikasi lulus**

Run (cwd `apps/web`): `bunx vitest run test/useToasts.test.ts test/EditorToasts.test.tsx`
Expected: PASS semua.

- [ ] **Step 7: Commit**

```bash
git add apps/web/components/editor/useToasts.ts apps/web/components/editor/EditorToasts.tsx apps/web/test/useToasts.test.ts apps/web/test/EditorToasts.test.tsx
git commit -m "feat(editor): add toast system with queue and auto-dismiss"
```

---

### Task 3: Komponen `PanelHeader`

**Files:**
- Create: `apps/web/components/editor/PanelHeader.tsx`
- Create: `apps/web/test/PanelHeader.test.tsx`

**Interfaces:**
- Consumes: tidak ada.
- Produces: `PanelHeader({ title, hint, actions }: { title: ReactNode; hint?: ReactNode; actions?: ReactNode })` — baris header ramping dengan border-b; dipakai Task 7 (LayerInspector) dan Task 12 (MediaLibrary), serta sheet mobile di Task 11 memakai pola serupa.

- [ ] **Step 1: Tulis test gagal**

Buat `apps/web/test/PanelHeader.test.tsx`:

```tsx
// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import { PanelHeader } from '@/components/editor/PanelHeader'

afterEach(cleanup)

test('menampilkan judul, hint opsional, dan slot aksi', () => {
  render(
    <PanelHeader
      title="Media"
      hint="120 KB / 500 MB"
      actions={<button type="button">Upload</button>}
    />,
  )

  expect(screen.getByRole('heading', { name: 'Media' })).toBeVisible()
  expect(screen.getByText('120 KB / 500 MB')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Upload' })).toBeVisible()
})

test('tanpa hint dan aksi tetap valid', () => {
  render(<PanelHeader title="Inspector" />)
  expect(screen.getByRole('heading', { name: 'Inspector' })).toBeVisible()
})
```

- [ ] **Step 2: Verifikasi gagal**

Run (cwd `apps/web`): `bunx vitest run test/PanelHeader.test.tsx`
Expected: FAIL — modul tidak ditemukan.

- [ ] **Step 3: Implementasi**

Buat `apps/web/components/editor/PanelHeader.tsx`:

```tsx
'use client'

import type { ReactNode } from 'react'

export function PanelHeader({
  title,
  hint,
  actions,
}: {
  title: ReactNode
  hint?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-2 border-b border-border px-4 py-3">
      <div className="min-w-0">
        <h2 className="truncate text-sm font-black uppercase tracking-wide">
          {title}
        </h2>
        {hint ? (
          <p className="mt-0.5 truncate text-xs text-muted">{hint}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      ) : null}
    </div>
  )
}
```

- [ ] **Step 4: Verifikasi lulus**

Run (cwd `apps/web`): `bunx vitest run test/PanelHeader.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/editor/PanelHeader.tsx apps/web/test/PanelHeader.test.tsx
git commit -m "feat(editor): add shared panel header component"
```

---

### Task 4: Shortcut global (`useGlobalShortcuts`) + cheat sheet (`ShortcutHelpDialog`)

**Files:**
- Create: `apps/web/components/editor/useGlobalShortcuts.ts`
- Create: `apps/web/components/editor/ShortcutHelpDialog.tsx`
- Create: `apps/web/test/useGlobalShortcuts.test.tsx`
- Create: `apps/web/test/ShortcutHelpDialog.test.tsx`

**Interfaces:**
- Consumes: ui `Dialog`, `DialogContent`, `DialogTitle`, `DialogDescription` (`@/components/ui/dialog`).
- Produces:
  - `interface GlobalShortcutHandlers { onTogglePlay(): void; onSplit(): void; onDeleteSelected(): void; onUndo(): void; onRedo(): void; onStepFrame(direction: -1 | 1, coarse: boolean): void; onJumpToStart(): void; onJumpToEnd(): void; onShowShortcuts(): void }`
  - `useGlobalShortcuts(handlers: GlobalShortcutHandlers): void` — window keydown; abaikan bila `event.defaultPrevented`, target editable (`input, textarea, select, [contenteditable="true"]`), atau target di dalam `[role="dialog"]`.
  - Keys: Space→togglePlay; `s`→split; `Delete`/`Backspace`→delete; Ctrl/Cmd+Z→undo; Ctrl/Cmd+Shift+Z→redo; `←`/`→`→onStepFrame(dir, shiftKey); Home→start; End→end; `?`→showShortcuts. Aksi non-modifier selalu `preventDefault()`.
  - `SHORTCUT_GROUPS` + `ShortcutHelpDialog({ open, onOpenChange })`.

- [ ] **Step 1: Tulis test hook gagal**

Buat `apps/web/test/useGlobalShortcuts.test.tsx`:

```tsx
// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { useGlobalShortcuts } from '@/components/editor/useGlobalShortcuts'

afterEach(cleanup)

function harness(handlers: Parameters<typeof useGlobalShortcuts>[0]) {
  function Component() {
    useGlobalShortcuts(handlers)
    return null
  }
  render(<Component />)
}

function press(key: string, init: KeyboardEventInit = {}) {
  fireEvent(
    window,
    new KeyboardEvent('keydown', { key, bubbles: true, ...init }),
  )
}

const baseHandlers = () => ({
  onTogglePlay: vi.fn(),
  onSplit: vi.fn(),
  onDeleteSelected: vi.fn(),
  onUndo: vi.fn(),
  onRedo: vi.fn(),
  onStepFrame: vi.fn(),
  onJumpToStart: vi.fn(),
  onJumpToEnd: vi.fn(),
  onShowShortcuts: vi.fn(),
})

test('space memicu toggle play', () => {
  const handlers = baseHandlers()
  harness(handlers)
  press(' ')
  expect(handlers.onTogglePlay).toHaveBeenCalledOnce()
})

test('s memicu split tanpa modifier', () => {
  const handlers = baseHandlers()
  harness(handlers)
  press('s')
  expect(handlers.onSplit).toHaveBeenCalledOnce()
})

test('Delete memicu hapus seleksi', () => {
  const handlers = baseHandlers()
  harness(handlers)
  press('Delete')
  expect(handlers.onDeleteSelected).toHaveBeenCalledOnce()
})

test('ctrl+z undo dan ctrl+shift+z redo', () => {
  const handlers = baseHandlers()
  harness(handlers)
  press('z', { ctrlKey: true })
  expect(handlers.onUndo).toHaveBeenCalledOnce()
  press('z', { ctrlKey: true, shiftKey: true })
  expect(handlers.onRedo).toHaveBeenCalledOnce()
})

test('panah memicu step frame dengan arah dan coarse benar', () => {
  const handlers = baseHandlers()
  harness(handlers)
  press('ArrowLeft')
  press('ArrowRight', { shiftKey: true })
  expect(handlers.onStepFrame).toHaveBeenNthCalledWith(1, -1, false)
  expect(handlers.onStepFrame).toHaveBeenNthCalledWith(2, 1, true)
})

test('Home dan End melompat ke ujung timeline', () => {
  const handlers = baseHandlers()
  harness(handlers)
  press('Home')
  press('End')
  expect(handlers.onJumpToStart).toHaveBeenCalledOnce()
  expect(handlers.onJumpToEnd).toHaveBeenCalledOnce()
})

test('tanda tanya membuka cheat sheet', () => {
  const handlers = baseHandlers()
  harness(handlers)
  press('?')
  expect(handlers.onShowShortcuts).toHaveBeenCalledOnce()
})

test('mengabaikan shortcut saat fokus di input', () => {
  const handlers = baseHandlers()
  document.body.innerHTML = '<input id="field" />'
  harness(handlers)
  const input = document.getElementById('field')!
  input.focus()
  Object.defineProperty(document, 'activeElement', {
    value: input,
    configurable: true,
  })
  press(' ')
  expect(handlers.onTogglePlay).not.toHaveBeenCalled()
})

test('mengabaikan shortcut saat event terjadi di dalam dialog', () => {
  const handlers = baseHandlers()
  document.body.innerHTML = '<div role="dialog"><input id="in-dialog" /></div>'
  harness(handlers)
  const input = document.getElementById('in-dialog')!
  input.focus()
  Object.defineProperty(document, 'activeElement', {
    value: input,
    configurable: true,
  })
  press(' ')
  expect(handlers.onTogglePlay).not.toHaveBeenCalled()
})
```

Catatan: `fireEvent(window, ...)` menargetkan `window` sehingga `event.target`
adalah `window`, bukan elemen — untuk test guard, set `activeElement` seperti
di atas dan pastikan implementasi guard membaca `document.activeElement` bila
`event.target` bukan Element (lihat Step 4).

- [ ] **Step 2: Tulis test dialog gagal**

Buat `apps/web/test/ShortcutHelpDialog.test.tsx`:

```tsx
// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import {
  SHORTCUT_GROUPS,
  ShortcutHelpDialog,
} from '@/components/editor/ShortcutHelpDialog'

afterEach(cleanup)

test('daftar grup shortcut lengkap dan dialog merender itemnya', () => {
  render(<ShortcutHelpDialog open onOpenChange={() => undefined} />)

  const labels = SHORTCUT_GROUPS.map((group) => group.label)
  expect(labels).toEqual(['Pemutaran', 'Editing', 'Bantuan'])

  expect(screen.getByRole('dialog')).toBeVisible()
  expect(screen.getByText('Putar / jeda')).toBeVisible()
  expect(screen.getByText('Split di playhead')).toBeVisible()
  expect(screen.getByText('Undo')).toBeVisible()
})
```

- [ ] **Step 3: Verifikasi gagal**

Run (cwd `apps/web`): `bunx vitest run test/useGlobalShortcuts.test.tsx test/ShortcutHelpDialog.test.tsx`
Expected: FAIL — modul tidak ditemukan.

- [ ] **Step 4: Implementasi hook**

Buat `apps/web/components/editor/useGlobalShortcuts.ts`:

```ts
'use client'

import { useEffect, useRef } from 'react'

export interface GlobalShortcutHandlers {
  onTogglePlay(): void
  onSplit(): void
  onDeleteSelected(): void
  onUndo(): void
  onRedo(): void
  onStepFrame(direction: -1 | 1, coarse: boolean): void
  onJumpToStart(): void
  onJumpToEnd(): void
  onShowShortcuts(): void
}

const EDITABLE_SELECTOR =
  'input, textarea, select, [contenteditable="true"], [role="dialog"]'

function eventTargetElement(event: KeyboardEvent): Element | null {
  if (event.target instanceof Element) return event.target
  // jsdom/fireEvent dari window tidak mengisi target elemen; pakai focus aktif.
  if (typeof document !== 'undefined' && document.activeElement) {
    return document.activeElement
  }
  return null
}

function shouldIgnore(event: KeyboardEvent): boolean {
  if (event.defaultPrevented) return true
  const target = eventTargetElement(event)
  return target !== null && target.closest(EDITABLE_SELECTOR) !== null
}

export function useGlobalShortcuts(handlers: GlobalShortcutHandlers): void {
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (shouldIgnore(event)) return
      const call = handlersRef.current
      const modifier = event.ctrlKey || event.metaKey
      if (modifier && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) call.onRedo()
        else call.onUndo()
        return
      }
      if (modifier || event.altKey) return
      switch (event.key) {
        case ' ':
          event.preventDefault()
          call.onTogglePlay()
          return
        case 's':
        case 'S':
          event.preventDefault()
          call.onSplit()
          return
        case 'Delete':
        case 'Backspace':
          event.preventDefault()
          call.onDeleteSelected()
          return
        case 'ArrowLeft':
          event.preventDefault()
          call.onStepFrame(-1, event.shiftKey)
          return
        case 'ArrowRight':
          event.preventDefault()
          call.onStepFrame(1, event.shiftKey)
          return
        case 'Home':
          event.preventDefault()
          call.onJumpToStart()
          return
        case 'End':
          event.preventDefault()
          call.onJumpToEnd()
          return
        case '?':
          event.preventDefault()
          call.onShowShortcuts()
          return
        default:
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
```

- [ ] **Step 5: Implementasi dialog**

Buat `apps/web/components/editor/ShortcutHelpDialog.tsx`:

```tsx
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
```

- [ ] **Step 6: Verifikasi lulus**

Run (cwd `apps/web`): `bunx vitest run test/useGlobalShortcuts.test.tsx test/ShortcutHelpDialog.test.tsx`
Expected: PASS semua.

- [ ] **Step 7: Commit**

```bash
git add apps/web/components/editor/useGlobalShortcuts.ts apps/web/components/editor/ShortcutHelpDialog.tsx apps/web/test/useGlobalShortcuts.test.tsx apps/web/test/ShortcutHelpDialog.test.tsx
git commit -m "feat(editor): add global shortcuts hook and cheat sheet dialog"
```

---

### Task 5: `JointTransitionPopover`

**Files:**
- Create: `apps/web/components/editor/JointTransitionPopover.tsx`
- Create: `apps/web/test/JointTransitionPopover.test.tsx`

**Interfaces:**
- Consumes: `DEFAULT_TRANSITION_DURATION`, `TRANSITION_TYPES`, tipe `TimelineTransition`, `TransitionJoint` dari `@klipmatic/engine`; `TRANSITION_LABELS` dari `./TransitionLibrary`; `Button`.
- Produces:
  - `JointTransitionPopover({ joint, left, frameRate, onAdd, onClose }: { joint: TransitionJoint; left: number; frameRate: number; onAdd(type: TimelineTransition['type'], duration: number): void; onClose(): void })`
  - Panel absolut (`role="dialog"` `aria-label="Tambahkan transition di cut point"`, diposisikan parent yang `position:relative`). Esc → `onClose()` tanpa menambah. Tombol tipe: aria-label `TRANSITION_LABELS[type]`, `aria-pressed`. Slider `aria-label="Durasi transition popover"`: min `1/frameRate`, max `joint.maxDuration`, step `1/frameRate`, nilai awal `Math.min(DEFAULT_TRANSITION_DURATION, joint.maxDuration)`. Add (`aria-label="Tambahkan transition"`) → `onAdd(type, Math.min(duration, joint.maxDuration))` lalu `onClose()`.

- [ ] **Step 1: Tulis test gagal**

Buat `apps/web/test/JointTransitionPopover.test.tsx`:

```tsx
// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import { JointTransitionPopover } from '@/components/editor/JointTransitionPopover'
import type { TransitionJoint } from '@klipmatic/engine'

afterEach(cleanup)

const joint: TransitionJoint = {
  trackId: 'video-primary',
  fromClipId: 'clip-a',
  toClipId: 'clip-b',
  outputTime: 12,
  maxDuration: 1,
}

function renderPopover() {
  const onAdd = vi.fn()
  const onClose = vi.fn()
  render(
    <div className="relative">
      <JointTransitionPopover
        joint={joint}
        left={432}
        frameRate={30}
        onAdd={onAdd}
        onClose={onClose}
      />
    </div>,
  )
  return { onAdd, onClose }
}

test('menampilkan tiga tipe transition dan fade terpilih default', () => {
  renderPopover()
  expect(
    screen.getByRole('dialog', { name: 'Tambahkan transition di cut point' }),
  ).toBeVisible()
  for (const label of ['Fade', 'Cross Dissolve', 'Dip to Black']) {
    expect(screen.getByRole('button', { name: label })).toBeVisible()
  }
  expect(screen.getByRole('button', { name: 'Fade' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
})

test('slider durasi di-clamp ke maxDuration joint', () => {
  renderPopover()
  const slider = screen.getByRole('slider', {
    name: 'Durasi transition popover',
  })
  expect(slider).toHaveAttribute('max', '1')
  expect(slider).toHaveAttribute('step', String(1 / 30))
})

test('ganti tipe lalu Add mengirim payload benar dan menutup', async () => {
  const user = userEvent.setup()
  const { onAdd, onClose } = renderPopover()
  await user.click(screen.getByRole('button', { name: 'Cross Dissolve' }))
  await user.click(screen.getByRole('button', { name: 'Tambahkan transition' }))

  expect(onAdd).toHaveBeenCalledWith('cross-dissolve', 0.5)
  expect(onClose).toHaveBeenCalledOnce()
})

test('Escape menutup tanpa menambah', () => {
  const { onAdd, onClose } = renderPopover()
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
  expect(onClose).toHaveBeenCalledOnce()
  expect(onAdd).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Verifikasi gagal**

Run (cwd `apps/web`): `bunx vitest run test/JointTransitionPopover.test.tsx`
Expected: FAIL — modul tidak ditemukan.

- [ ] **Step 3: Implementasi**

Buat `apps/web/components/editor/JointTransitionPopover.tsx`:

```tsx
'use client'

import { useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import {
  DEFAULT_TRANSITION_DURATION,
  TRANSITION_TYPES,
  type TimelineTransition,
  type TransitionJoint,
} from '@klipmatic/engine'
import { Button } from '@/components/ui/button'
import { TRANSITION_LABELS } from './TransitionLibrary'

export function JointTransitionPopover({
  joint,
  left,
  frameRate,
  onAdd,
  onClose,
}: {
  joint: TransitionJoint
  left: number
  frameRate: number
  onAdd: (type: TimelineTransition['type'], duration: number) => void
  onClose: () => void
}) {
  const [type, setType] = useState<TimelineTransition['type']>('fade')
  const [duration, setDuration] = useState(() =>
    Math.min(DEFAULT_TRANSITION_DURATION, joint.maxDuration),
  )

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      onClose()
    }
  }

  return (
    <div
      role="dialog"
      aria-label="Tambahkan transition di cut point"
      onKeyDown={onKeyDown}
      style={{ left }}
      className="absolute bottom-full left-0 z-40 mb-2 w-64 -translate-x-1/2 space-y-3 rounded-lg border border-border bg-surface-raised p-3 shadow-xl"
    >
      <div className="grid grid-cols-3 gap-1">
        {TRANSITION_TYPES.map((candidate) => (
          <Button
            key={candidate}
            type="button"
            size="sm"
            variant={candidate === type ? 'primary' : 'secondary'}
            aria-label={TRANSITION_LABELS[candidate]}
            aria-pressed={candidate === type}
            onClick={() => setType(candidate)}
          >
            {TRANSITION_LABELS[candidate]}
          </Button>
        ))}
      </div>
      <label className="block text-xs font-bold">
        Durasi (maks {joint.maxDuration}s)
        <input
          type="range"
          aria-label="Durasi transition popover"
          min={1 / frameRate}
          max={joint.maxDuration}
          step={1 / frameRate}
          value={duration}
          onChange={(event) => setDuration(Number(event.currentTarget.value))}
          className="mt-1 h-11 w-full accent-primary"
        />
      </label>
      <Button
        type="button"
        className="w-full"
        aria-label="Tambahkan transition"
        onClick={() => {
          onAdd(type, Math.min(duration, joint.maxDuration))
          onClose()
        }}
      >
        Tambah
      </Button>
    </div>
  )
}
```

- [ ] **Step 4: Verifikasi lulus**

Run (cwd `apps/web`): `bunx vitest run test/JointTransitionPopover.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/editor/JointTransitionPopover.tsx apps/web/test/JointTransitionPopover.test.tsx
git commit -m "feat(editor): add inline joint transition popover"
```

---

### Task 6: Wiring popover + shortcut global ke TimelineEditor/Toolbar/ClipEditor

**Files:**
- Modify: `apps/web/components/editor/TimelineTrack.tsx`
- Modify: `apps/web/components/editor/TimelineEditor.tsx`
- Modify: `apps/web/components/editor/TimelineToolbar.tsx`
- Modify: `apps/web/components/ClipEditor.tsx`
- Test (modify): `apps/web/test/TimelineEditor.test.tsx`, `apps/web/test/EditorWorkspace.test.tsx`

**Interfaces:**
- Consumes: `useGlobalShortcuts` + `ShortcutHelpDialog` (Task 4), `JointTransitionPopover` (Task 5).
- Produces:
  - `export interface TimelineTransport { split(): void; remove(): void }` — diekspor dari `TimelineEditor.tsx`; diisi ke `transportRef` tiap render.
  - Props baru `TimelineEditor`: `onShowShortcuts: () => void`, `transportRef?: React.MutableRefObject<TimelineTransport | null>`.
  - Props baru `TimelineToolbar`: `onShowShortcuts: () => void`.
  - Props baru `TimelineTrack`: `frameRate: number`, `popoverJoint: TransitionJoint | null`, `onOpenPopover(joint)`, `onClosePopover()`.
  - Klik joint (`aria-label` awalan `Sambungan`): seleksi joint + buka popover. Popover Add memakai closure `addTransition` existing (seleksi pindah ke transition baru) lalu menutup popover.
  - Handler keydown lokal `<section>` DIHAPUS (digantikan global). Test keyboard lama diganti.

- [ ] **Step 1: Update test TimelineEditor**

Di `apps/web/test/TimelineEditor.test.tsx`:

1. Di `propsFor`, tambahkan `onShowShortcuts: vi.fn(),`.
2. Hapus test `keyboard shortcut toggles playback without requiring hover` (dicover `useGlobalShortcuts.test.tsx`).
3. Tambah dua test baru di akhir file:

```tsx
test('klik joint membuka popover transition di posisi cut', async () => {
  const source = makeEditorSpec()
  const primary = source.timeline.tracks[0]!
  const split = applyTimelineCommand(source, {
    type: 'splitClip',
    trackId: primary.id,
    clipId: primary.clips[0]!.id,
    outputTime: 12,
  }, editorContext)
  const props = propsFor(split)
  render(<TimelineEditor {...props} />)

  await userEvent.click(screen.getByRole('button', { name: /Sambungan/ }))

  expect(props.onSelectionChange).toHaveBeenCalledWith(
    expect.objectContaining({ kind: 'joint' }),
  )
  expect(
    screen.getByRole('dialog', { name: 'Tambahkan transition di cut point' }),
  ).toBeVisible()
})

test('popover Add mengirim addTransition dan menutup popover', async () => {
  const source = makeEditorSpec()
  const primary = source.timeline.tracks[0]!
  const split = applyTimelineCommand(source, {
    type: 'splitClip',
    trackId: primary.id,
    clipId: primary.clips[0]!.id,
    outputTime: 12,
  }, editorContext)
  const props = propsFor(split)
  render(<TimelineEditor {...props} />)
  await userEvent.click(screen.getByRole('button', { name: /Sambungan/ }))

  await userEvent.click(screen.getByRole('button', { name: 'Tambahkan transition' }))

  expect(props.onCommand).toHaveBeenCalledWith(expect.objectContaining({
    type: 'addTransition',
    transition: expect.objectContaining({
      type: 'fade',
      duration: 0.5,
      target: expect.objectContaining({ kind: 'between-clips' }),
    }),
  }))
  expect(
    screen.queryByRole('dialog', { name: 'Tambahkan transition di cut point' }),
  ).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Verifikasi gagal**

Run (cwd `apps/web`): `bunx vitest run test/TimelineEditor.test.tsx`
Expected: FAIL — dialog tidak muncul (popover belum ada).

- [ ] **Step 3: Implementasi TimelineTrack**

Di `TimelineTrack.tsx`:

1. Import: `import { JointTransitionPopover } from './JointTransitionPopover'`.
2. Tambah 4 props pada signature (setelah `transitions`): `frameRate: number`, `popoverJoint: TransitionJoint | null`, `onOpenPopover: (joint: TransitionJoint) => void`, `onClosePopover: () => void`.
3. Ganti blok render joint primary dengan versi yang membuka popover:

```tsx
{primary ? joints.map((joint) => (
  <TimelineTransitionTarget
    key={`${joint.fromClipId}:${joint.toClipId}`}
    left={joint.outputTime * pixelsPerSecond}
    ariaLabel={`Sambungan ${joint.fromClipId} ke ${joint.toClipId}`}
    onSelect={() => {
      onSelectionChange({ kind: 'joint', joint })
      onOpenPopover(joint)
    }}
    onAdd={(type, duration) => onAddTransition({
      kind: 'between-clips',
      trackId: joint.trackId,
      fromClipId: joint.fromClipId,
      toClipId: joint.toClipId,
    }, type, Math.min(duration, joint.maxDuration))}
  />
)) : null}
{popoverJoint ? (
  <JointTransitionPopover
    joint={popoverJoint}
    left={popoverJoint.outputTime * pixelsPerSecond}
    frameRate={frameRate}
    onAdd={(type, duration) => {
      onClosePopover()
      onAddTransition({
        kind: 'between-clips',
        trackId: popoverJoint.trackId,
        fromClipId: popoverJoint.fromClipId,
        toClipId: popoverJoint.toClipId,
      }, type, duration)
    }}
    onClose={onClosePopover}
  />
) : null}
```

(Perilaku drop transition di target TIDAK berubah.)

- [ ] **Step 4: Implementasi TimelineEditor**

Di `TimelineEditor.tsx`:

1. Export + import react tambahan (`useEffect`, `type MutableRefObject`):

```tsx
export interface TimelineTransport {
  split(): void
  remove(): void
}
```

2. Props interface tambah:

```tsx
onShowShortcuts: () => void
transportRef?: MutableRefObject<TimelineTransport | null>
```

3. Hapus seluruh atribut `tabIndex={0}` dan `onKeyDown={(event) => {...}}` dari `<section>`; sederhanakan className section menjadi `overflow-hidden border-y border-border bg-surface`.

4. Tambah state + efek expose transport (setelah definisi `remove`):

```tsx
const [popoverJoint, setPopoverJoint] = useState<TransitionJoint | null>(null)

useEffect(() => {
  if (!props.transportRef) return
  props.transportRef.current = { split, remove }
  return () => {
    props.transportRef.current = null
  }
})
```

Tanpa array deps — sengaja diregistrasi ulang tiap render agar closure segar; murah.

5. Teruskan props ke `TimelineTrack`:

```tsx
frameRate={props.spec.output.frameRate}
popoverJoint={
  popoverJoint && popoverJoint.trackId === track.id ? popoverJoint : null
}
onOpenPopover={setPopoverJoint}
onClosePopover={() => setPopoverJoint(null)}
```

6. Toolbar menerima prop baru: `<TimelineToolbar ... onShowShortcuts={props.onShowShortcuts} />`.

- [ ] **Step 5: Implementasi TimelineToolbar**

Rewrite `TimelineToolbar.tsx` sepenuhnya:

```tsx
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
```

Catatan jsdom/Radix Tooltip: TooltipContent hanya muncul saat hover/focus
(default), jadi query `getByRole('button', { name })` tetap unik di test.

- [ ] **Step 6: Wire ClipEditor**

Di `ClipEditor.tsx` (`ReadyClipEditor`):

1. Imports tambahan:

```tsx
import { ShortcutHelpDialog } from '@/components/editor/ShortcutHelpDialog'
import { useGlobalShortcuts } from '@/components/editor/useGlobalShortcuts'
// TimelineEditor import ditambah tipe:
import {
  TimelineEditor,
  type TimelineSelection,
  type TimelineTransport,
} from '@/components/editor/TimelineEditor'
```

2. State/ref (dekat state lain):

```tsx
const transportRef = useRef<TimelineTransport | null>(null)
const [shortcutsOpen, setShortcutsOpen] = useState(false)
```

3. Handlers global (setelah `dispatchCommand`):

```tsx
const frameRate = history.present.output.frameRate
const timelineDuration = history.present.timeline.duration
const shortcuts = useMemo(() => ({
  onTogglePlay: () => setPlaying((value) => !value),
  onSplit: () => transportRef.current?.split(),
  onDeleteSelected: () => transportRef.current?.remove(),
  onUndo: () => historyDispatch({ type: 'undo' }),
  onRedo: () => historyDispatch({ type: 'redo' }),
  onStepFrame: (direction: -1 | 1, coarse: boolean) =>
    setPlayhead((value) => Math.min(
      Math.max(value + direction * (coarse ? 1 : 1 / frameRate), 0),
      timelineDuration,
    )),
  onJumpToStart: () => setPlayhead(0),
  onJumpToEnd: () => setPlayhead(timelineDuration),
  onShowShortcuts: () => setShortcutsOpen(true),
}), [frameRate, timelineDuration])
useGlobalShortcuts(shortcuts)
```

4. Render dialog dalam fragment luar:

```tsx
<ShortcutHelpDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
```

5. Props TimelineEditor baru:

```tsx
onShowShortcuts={() => setShortcutsOpen(true)}
transportRef={transportRef}
```

- [ ] **Step 7: Update test integrasi alur transitions**

Di `apps/web/test/EditorWorkspace.test.tsx`, test `split then add transition autosaves the joint reference` — ganti baris klik tab library:

Lama:
```tsx
  await userEvent.click(await screen.findByRole('button', { name: /Sambungan/ }))
  await userEvent.click(screen.getByRole('tab', { name: 'Transitions' }))
  await userEvent.click(
    screen.getByRole('button', { name: 'Add Cross Dissolve to selected cut' }),
  )
```

Baru:
```tsx
  await userEvent.click(await screen.findByRole('button', { name: /Sambungan/ }))
  await userEvent.click(screen.getByRole('button', { name: 'Cross Dissolve' }))
  await userEvent.click(screen.getByRole('button', { name: 'Tambahkan transition' }))
```

Assertion PATCH tidak berubah (cross-dissolve, 0.5, between-clips).

- [ ] **Step 8: Verifikasi lulus**

Run (cwd `apps/web`): `bunx vitest run test/TimelineEditor.test.tsx test/EditorWorkspace.test.tsx test/TransitionLibrary.test.tsx`
Expected: PASS (drag transition via library/tab tetap berfungsi; popover jalur baru).

- [ ] **Step 9: Typecheck**

Run (root): `bun run typecheck`
Expected: tidak ada error TS BARU di file yang disentuh. (Error pre-existing milik working tree user: catat, biarkan.)

- [ ] **Step 10: Commit**

```bash
git add apps/web/components/editor/TimelineTrack.tsx apps/web/components/editor/TimelineEditor.tsx apps/web/components/editor/TimelineToolbar.tsx apps/web/components/ClipEditor.tsx apps/web/test/TimelineEditor.test.tsx apps/web/test/EditorWorkspace.test.tsx
git commit -m "feat(editor): joint popover, global shortcuts, kbd tooltips"
```

---

### Task 7: Wayfinding LayerInspector (judul kontekstual + accordion + empty state)

**Files:**
- Modify: `apps/web/components/editor/LayerInspector.tsx`
- Modify: `apps/web/components/ClipEditor.tsx`
- Create: `apps/web/test/LayerInspector.test.tsx`

**Interfaces:**
- Consumes: `PanelHeader` (Task 3), ui `Accordion, AccordionItem, AccordionTrigger, AccordionContent` (`@/components/ui/accordion`), `TRANSITION_LABELS` dari `./TransitionLibrary`.
- Produces (LayerInspector):
  - `export function selectionHeading(spec: EditSpecV3, selected: TimelineSelection | null, assetNames: Record<string, string>): { title: string; hint: string }`
    - transition → `Transition · ${TRANSITION_LABELS[type]}` / 'Atur tipe dan durasi tanpa mengubah panjang video.'
    - joint → `Cut point` / 'Pilih tipe transition langsung di popover timeline.'
    - clip → `Clip · ${assetNames[clip.assetId] ?? clip.assetId}` / 'Geser di canvas untuk memindah atau resize overlay.'
    - track → `Track · ${track.name}` / 'Rename, duplikat, atau hapus layer.'
    - null → `Editor` / 'Pilih clip di timeline atau drop media ke preview.'
  - Props baru opsional: `assetNames?: Record<string, string>`, `onSelectFirstClip?: () => void`, `onOpenMedia?: () => void`.
  - Struktur: PanelHeader di atas; kartu kontekstual (`AssetInspector`/`TransitionInspector`) langsung di bawah header; kontrol layer dalam accordion "Layer settings" (collapsed default; TERBUKA default bila seleksi = track via `defaultValue`).

- [ ] **Step 1: Tulis test gagal**

Buat `apps/web/test/LayerInspector.test.tsx`:

```tsx
// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import {
  LayerInspector,
  selectionHeading,
} from '@/components/editor/LayerInspector'
import type { TimelineSelection } from '@/components/editor/TimelineEditor'
import { makeEditorSpec, makeSpecWithTransition } from './editorFixtures'

afterEach(cleanup)

const assetNames = { 'asset-candidate': 'Klip fixture' }

function primaryClipId(spec: ReturnType<typeof makeEditorSpec>) {
  const primary = spec.timeline.tracks.find(
    (track) => track.id === spec.timeline.primaryTrackId,
  )!
  return primary.clips[0]!.id
}

test('selectionHeading menghasilkan judul per jenis seleksi', () => {
  const spec = makeEditorSpec()
  const clipSel: TimelineSelection = {
    kind: 'clip',
    trackId: spec.timeline.primaryTrackId,
    clipId: primaryClipId(spec),
  }
  expect(selectionHeading(spec, clipSel, assetNames)).toEqual({
    title: 'Clip · Klip fixture',
    hint: 'Geser di canvas untuk memindah atau resize overlay.',
  })
  expect(selectionHeading(spec, null, assetNames).title).toBe('Editor')

  const transitionSpec = makeSpecWithTransition('cross-dissolve')
  expect(selectionHeading(
    transitionSpec,
    {
      kind: 'transition',
      transitionId: transitionSpec.timeline.transitions[0]!.id,
    },
    assetNames,
  ).title).toBe('Transition · Cross Dissolve')
})

test('header kontekstual tampil dan accordion layer settings hadir', () => {
  const spec = makeEditorSpec()
  render(
    <LayerInspector
      spec={spec}
      selected={{
        kind: 'clip',
        trackId: spec.timeline.primaryTrackId,
        clipId: primaryClipId(spec),
      }}
      assetNames={assetNames}
      onCommand={vi.fn()}
    />,
  )

  expect(screen.getByText('Clip · Klip fixture')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Layer settings' })).toBeVisible()
})

test('empty state menawarkan aksi cepat', async () => {
  const onSelectFirstClip = vi.fn()
  const onOpenMedia = vi.fn()
  render(
    <LayerInspector
      spec={makeEditorSpec()}
      selected={null}
      assetNames={assetNames}
      onCommand={vi.fn()}
      onSelectFirstClip={onSelectFirstClip}
      onOpenMedia={onOpenMedia}
    />,
  )

  expect(screen.getByText(/Pilih clip di timeline/)).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: 'Pilih clip pertama' }))
  await userEvent.click(screen.getByRole('button', { name: 'Buka Media' }))
  expect(onSelectFirstClip).toHaveBeenCalledOnce()
  expect(onOpenMedia).toHaveBeenCalledOnce()
})

test('seleksi track membuka accordion layer settings secara default', () => {
  const spec = makeEditorSpec()
  render(
    <LayerInspector
      spec={spec}
      selected={{ kind: 'track', trackId: spec.timeline.primaryTrackId }}
      assetNames={assetNames}
      onCommand={vi.fn()}
    />,
  )

  // Nama track video dari fixture — verifikasi dulu nama aslinya:
  // lihat output `makeEditorSpec()` di packages/engine (createDefaultEditSpecV3).
  const primaryName = spec.timeline.tracks.find(
    (track) => track.id === spec.timeline.primaryTrackId,
  )!.name
  expect(screen.getByText(`Track · ${primaryName}`)).toBeVisible()
  expect(screen.getByLabelText('Nama layer')).toBeVisible()
})
```

- [ ] **Step 2: Verifikasi gagal**

Run (cwd `apps/web`): `bunx vitest run test/LayerInspector.test.tsx`
Expected: FAIL — `selectionHeading` belum ada.

- [ ] **Step 3: Implementasi**

Rewrite `LayerInspector.tsx`:

```tsx
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
      title: `Transition · ${transition ? TRANSITION_LABELS[transition.type] : '?'}`,
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
      title: `Clip · ${name}`,
      hint: 'Geser di canvas untuk memindah atau resize overlay.',
    }
  }
  if (track) {
    return {
      title: `Track · ${track.name}`,
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
```

Catatan: jika `ui/accordion.tsx` tidak mengekspor `AccordionTrigger` dengan
gaya chevron, buka filenya dan gunakan nama export yang ada (jangan ubah
accordion.tsx kecuali varian memang belum ada).

- [ ] **Step 4: Wire ClipEditor**

Di `ReadyClipEditor`:

```tsx
const assetNames = useMemo(() => Object.fromEntries([
  ...BUILTIN_MEDIA.map((asset) => [asset.id, asset.name] as const),
  ...assets.map((asset) => [asset.id, asset.name] as const),
]), [assets])

const selectFirstClip = useCallback(() => {
  const primary = history.present.timeline.tracks.find(
    (track) => track.id === history.present.timeline.primaryTrackId,
  )
  const clip = primary?.clips[0]
  if (primary && clip) {
    setSelected({ kind: 'clip', trackId: primary.id, clipId: clip.id })
  }
}, [history.present])
```

Pass ke inspector:

```tsx
<LayerInspector
  spec={history.present}
  selected={selected}
  onCommand={dispatchCommand}
  assetNames={assetNames}
  onSelectFirstClip={selectFirstClip}
/>
```

(`onOpenMedia` diwire di Task 11 setelah tab Media mobile tersedia.)

- [ ] **Step 5: Verifikasi**

Run (cwd `apps/web`): `bunx vitest run test/LayerInspector.test.tsx test/EditorControls.test.tsx test/EditorWorkspace.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/editor/LayerInspector.tsx apps/web/components/ClipEditor.tsx apps/web/test/LayerInspector.test.tsx
git commit -m "feat(editor): contextual inspector headings and layer accordion"
```

---

### Task 8: Konsolidasi header (ekspor pindah ke header; hapus EditorActionBar)

**Files:**
- Modify: `apps/web/components/editor/EditorHeader.tsx`
- Modify: `apps/web/components/ClipEditor.tsx`
- Delete: `apps/web/components/editor/EditorActionBar.tsx`
- Test (modify): `apps/web/test/EditorWorkspace.test.tsx`

**Interfaces:**
- Produces (props BARU EditorHeader, semua required):

```ts
{
  title: string
  duration: number
  timingPrecision: 'word' | 'estimated'
  saveStatus: AutosaveStatus
  onRetry: () => void
  exporting: boolean
  exportProgress: number
  exportSupported: boolean
  exportReason: string | null
  onExport: () => void
}
```

- Chip simpan berwarna: `saved→text-muted`, `unsaved|saving→text-warning`, `error→text-danger`. Teks label tidak berubah ('Tersimpan', dst.) sehingga test lama cocok.
- Tombol `Ekspor MP4` kanan header; saat exporting label `Mengekspor… N%` + disabled; Progress tipis full-width di bawah baris header saat exporting; badge warning `Ekspor tidak didukung` + Tooltip alasan saat unsupported.
- `EditorActionBar.tsx` DIHAPUS; fungsi `saveNow` di ClipEditor DIHAPUS (autosave + retry cukup; ekspor tetap flush).

- [ ] **Step 1: Update test header**

Di `apps/web/test/EditorWorkspace.test.tsx`, ganti test `save errors are announced without relying on color` dengan tiga test:

```tsx
test('header menampilkan status simpan berwarna dan kontrol ekspor', () => {
  render(
    <EditorHeader
      title="Klip fixture"
      duration={30}
      timingPrecision="word"
      saveStatus="error"
      onRetry={vi.fn()}
      exporting={false}
      exportProgress={0}
      exportSupported
      exportReason={null}
      onExport={vi.fn()}
    />,
  )

  expect(screen.getByRole('status')).toHaveClass('text-danger')
  expect(screen.getByText('Gagal menyimpan')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Coba simpan lagi' })).toBeVisible()
  expect(screen.getByRole('button', { name: 'Ekspor MP4' })).toBeEnabled()
})

test('saat mengekspor label tombol memuat persentase', () => {
  render(
    <EditorHeader
      title="Klip fixture"
      duration={30}
      timingPrecision="word"
      saveStatus="saved"
      onRetry={vi.fn()}
      exporting
      exportProgress={0.42}
      exportSupported
      exportReason={null}
      onExport={vi.fn()}
    />,
  )

  expect(screen.getByRole('button', { name: /Mengekspor… 42%/ })).toBeDisabled()
  expect(screen.getByRole('progressbar', { name: 'Progress ekspor' })).toBeVisible()
})

test('ekspor tidak didukung memunculkan badge dengan alasan di tooltip', async () => {
  const userEvent = (await import('@testing-library/user-event')).default
  render(
    <EditorHeader
      title="Klip fixture"
      duration={30}
      timingPrecision="word"
      saveStatus="saved"
      onRetry={vi.fn()}
      exporting={false}
      exportProgress={0}
      exportSupported={false}
      exportReason="Browser tidak mendukung WebCodecs."
      onExport={vi.fn()}
    />,
  )

  await userEvent.hover(screen.getByText('Ekspor tidak didukung'))
  expect(await screen.findByText('Browser tidak mendukung WebCodecs.')).toBeVisible()
})
```

- [ ] **Step 2: Verifikasi gagal**

Run (cwd `apps/web`): `bunx vitest run test/EditorWorkspace.test.tsx`
Expected: FAIL — props baru belum ada.

- [ ] **Step 3: Implementasi EditorHeader**

Rewrite `EditorHeader.tsx`:

```tsx
'use client'

import { RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import type { AutosaveStatus } from './useEditorAutosave'

const STATUS_LABEL: Record<AutosaveStatus, string> = {
  saved: 'Tersimpan',
  unsaved: 'Belum tersimpan',
  saving: 'Menyimpan…',
  error: 'Gagal menyimpan',
}

const STATUS_CLASS: Record<AutosaveStatus, string> = {
  saved: 'text-muted',
  unsaved: 'text-warning',
  saving: 'text-warning',
  error: 'text-danger',
}

export function EditorHeader({
  title,
  duration,
  timingPrecision,
  saveStatus,
  onRetry,
  exporting,
  exportProgress,
  exportSupported,
  exportReason,
  onExport,
}: {
  title: string
  duration: number
  timingPrecision: 'word' | 'estimated'
  saveStatus: AutosaveStatus
  onRetry: () => void
  exporting: boolean
  exportProgress: number
  exportSupported: boolean
  exportReason: string | null
  onExport: () => void
}) {
  return (
    <TooltipProvider delayDuration={200}>
      <header className="border-b border-border bg-surface px-4 py-3 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-primary">
              Video editor
            </p>
            <h1 className="truncate text-xl font-black tracking-normal sm:text-2xl">
              {title}
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span role="status" className={`text-sm font-bold ${STATUS_CLASS[saveStatus]}`}>
              {STATUS_LABEL[saveStatus]}
            </span>
            {saveStatus === 'error' && (
              <Button type="button" size="sm" variant="secondary" onClick={onRetry}>
                <RefreshCw className="size-4" aria-hidden="true" />
                Coba simpan lagi
              </Button>
            )}
            <Badge variant="muted">{duration.toFixed(1)} detik</Badge>
            <Badge variant={timingPrecision === 'estimated' ? 'warning' : 'default'}>
              {timingPrecision === 'estimated' ? 'Timing estimasi' : 'Timing presisi'}
            </Badge>
            {!exportSupported ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="warning">Ekspor tidak didukung</Badge>
                </TooltipTrigger>
                <TooltipContent>{exportReason}</TooltipContent>
              </Tooltip>
            ) : null}
            <Button
              type="button"
              onClick={onExport}
              disabled={exporting || !exportSupported}
              aria-label={
                exporting
                  ? `Mengekspor… ${Math.round(exportProgress * 100)}%`
                  : 'Ekspor MP4'
              }
            >
              {exporting
                ? `Mengekspor… ${Math.round(exportProgress * 100)}%`
                : 'Ekspor MP4'}
            </Button>
          </div>
        </div>
        {exporting ? (
          <Progress
            value={exportProgress * 100}
            aria-label="Progress ekspor"
            className="mt-2 h-1"
          />
        ) : null}
      </header>
    </TooltipProvider>
  )
}
```

Catatan: cek `badge.tsx` — pakai varian yang benar-benar tersedia
(`muted/warning/default` diasumsikan ada; sesuaikan bila berbeda).

- [ ] **Step 4: Rewire ClipEditor + hapus EditorActionBar**

Di `ClipEditor.tsx`:

1. Hapus import dan seluruh render `<EditorActionBar ... />`.
2. Hapus fungsi `saveNow` beserta pemanggilnya (tidak ada lagi tombol simpan manual).
3. Props header baru:

```tsx
<EditorHeader
  title={payload.clip.title}
  duration={history.present.timeline.duration}
  timingPrecision={payload.clip.timingPrecision}
  saveStatus={autosave.status}
  onRetry={() => void autosave.retry().catch(() => undefined)}
  exporting={exporting}
  exportProgress={progress}
  exportSupported={support.supported}
  exportReason={support.reason}
  onExport={() => void runExport()}
/>
```

4. Hapus file komponen:

```bash
git rm apps/web/components/editor/EditorActionBar.tsx
```

- [ ] **Step 5: Verifikasi**

Run (cwd `apps/web`): `bunx vitest run test/EditorWorkspace.test.tsx test/EditorControls.test.tsx`
Expected: PASS — termasuk test integrasi lama `built-in sticker reaches the same asset map used by export` yang klik `Ekspor MP4` (nama tombol sama, lokasi baru).

Jalankan juga grep (root): `Get-ChildItem -Recurse apps\web\src -Filter *.ts* | Select-String "EditorActionBar"` atau `rg "EditorActionBar" apps/web` → Expected: kosong.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/editor/EditorHeader.tsx apps/web/components/ClipEditor.tsx apps/web/test/EditorWorkspace.test.tsx
git commit -m "refactor(editor): consolidate export and save state into header"
```

(File EditorActionBar sudah distage lewat `git rm` di Step 4.)

---

### Task 9: Feedback rewiring (toast menggantikan notice; banner error persisten di atas transport)

**Files:**
- Modify: `apps/web/components/ClipEditor.tsx`
- Modify: `apps/web/components/editor/TimelinePreview.tsx`
- Test (modify): `apps/web/test/EditorControls.test.tsx`

**Interfaces:**
- Consumes: `useToasts` / `EditorToasts` (Task 2).
- Produces:
  - `TimelinePreview` props baru: `errorBanner?: ReactNode` — dirender tepat DI ATAS transport bar.
  - Stall internal TimelinePreview: state `stalled`; saat controller `onStall`, tampilkan banner sendiri (`role="alert"`, teks `Video berhenti merespons.`, tombol `Coba putar lagi`, tutup `aria-label="Tutup pesan galat"`). Prop `onStall` ke parent TETAP dipanggil. Banner hilang saat play sukses lagi atau ditutup.
  - Pemetaan pesan ClipEditor:
    - Semua eks-`setNotice(...)` → `showToast(...)` dengan tone: info (proses berjalan), success (hasil ok), warning (gagal tapi ada jalan manual).
    - `setError(...)` (ekspor gagal, simpan gagal, media expired) → tetap state `error` → dikirim sebagai `errorBanner` (persisten, tanpa auto-dismiss). BUKAN toast.
    - `expiringAssets` → SATU toast warning saat jumlah berubah 0→N (guard ref).
    - `expiredAssets` → masuk error persisten.
    - Error polling transient saat segment pending TIDAK lagi memanggil `setError` — cukup pollAgain (supaya banner tidak berkedip).

- [ ] **Step 1: Tulis test gagal**

Di `apps/web/test/EditorControls.test.tsx` tambah:

```tsx
test('errorBanner dirender di atas transport', () => {
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined)
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined)

  render(
    <TimelinePreview
      spec={makeEditorSpec()}
      assets={[candidateVideo]}
      words={[]}
      playhead={0}
      playing={false}
      onPlayheadChange={vi.fn()}
      onPlayingChange={vi.fn()}
      onStall={vi.fn()}
      errorBanner={<div role="alert">Ekspor gagal: codec hilang.</div>}
    />,
  )

  expect(screen.getByRole('alert')).toHaveTextContent('Ekspor gagal: codec hilang.')
})
```

- [ ] **Step 2: Verifikasi gagal**

Run (cwd `apps/web`): `bunx vitest run test/EditorControls.test.tsx`
Expected: FAIL — prop `errorBanner` belum dikenal/dirender.

- [ ] **Step 3: Implementasi TimelinePreview**

Di `TimelinePreview.tsx`:

1. Import `useState` dan `type ReactNode`. Props type tambah `errorBanner?: ReactNode`; destructure default `null`.
2. State stall + retry handler:

```tsx
const [stalled, setStalled] = useState(false)
```

3. Dalam pembuatan controller, ubah `onStall`:

```tsx
onStall: (message) => {
  setStalled(true)
  callbacksRef.current.onPlayingChange(false)
  callbacksRef.current.onStall(message)
},
```

4. Efek `playing` menjadi reset stalled saat play sukses:

```tsx
useEffect(() => {
  const controller = controllerRef.current
  if (!controller) return
  if (playing) {
    void controller.play()
      .then(() => setStalled(false))
      .catch(() => undefined)
  } else {
    controller.pause()
  }
}, [playing])
```

5. Retry:

```tsx
async function retryPlayback(): Promise<void> {
  const controller = controllerRef.current
  if (!controller) return
  await controller.seek(reportedTimeRef.current).catch(() => undefined)
  try {
    await controller.play()
    setStalled(false)
  } catch {
    // Tetap stalled; banner tetap tampil.
  }
}
```

6. Render sebelum transport div (di dalam `<section>`, setelah container canvas):

```tsx
{(stalled || errorBanner) ? (
  <div className="space-y-2 border-t border-white/10 px-3 py-2">
    {stalled ? (
      <div
        role="alert"
        className="flex items-center justify-between gap-3 rounded-lg border border-danger/60 bg-danger/10 p-3 text-sm"
      >
        <span>Video berhenti merespons.</span>
        <span className="flex shrink-0 items-center gap-1">
          <Button type="button" size="sm" variant="secondary" onClick={() => void retryPlayback()}>
            Coba putar lagi
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label="Tutup pesan galat"
            onClick={() => setStalled(false)}
          >
            ×
          </Button>
        </span>
      </div>
    ) : null}
    {errorBanner}
  </div>
) : null}
```

- [ ] **Step 4: Implementasi ClipEditor feedback**

Di `ClipEditor.tsx` (`ReadyClipEditor`):

1. Import + hapus state notice:

```tsx
import { EditorToasts } from '@/components/editor/EditorToasts'
import { useToasts } from '@/components/editor/useToasts'
// ...
const { toasts, showToast, dismissToast } = useToasts()
const [error, setError] = useState<string | null>(null)
// const [notice, setNotice] = useState<string | null>(null)  <-- DIHAPUS
```

2. Ganti SEMUA pemanggilan `setNotice`:

| Lama | Baru |
|---|---|
| `'Preview belum siap. Coba lagi setelah frame video muncul.'` | `showToast(..., 'warning')` |
| `'Mendeteksi wajah di frame aktif…'` | `showToast(..., 'info')` |
| `'Wajah tidak ditemukan. Geser fokus secara manual.'` | `showToast(..., 'warning')` |
| `'Fokus crop mengikuti wajah terbesar di frame ini.'` | `showToast(..., 'success')` |
| `'Auto-focus tidak tersedia. Slider manual tetap bisa dipakai.'` | `showToast(..., 'warning')` |
| `'Media belum siap dipakai. Tunggu proses pengecekan selesai.'` | `showToast(..., 'warning')` |

3. Expiring toast dengan guard ref (letakkan dekat memo `expiringAssets`):

```tsx
const expiringSeenRef = useRef(false)
useEffect(() => {
  if (expiringAssets.length === 0) {
    expiringSeenRef.current = false
    return
  }
  if (expiringSeenRef.current) return
  expiringSeenRef.current = true
  showToast(
    `${expiringAssets.map((asset) => asset.name).join(', ')} akan dihapus kurang dari 1 hari kalau project tidak dipakai.`,
    'warning',
  )
}, [expiringAssets, showToast])
```

4. Expired → error persisten:

```tsx
useEffect(() => {
  if (expiredAssets.length === 0) return
  setError(
    `Media kedaluwarsa: ${expiredAssets.map((asset) => asset.name).join(', ')}. Gunakan Ganti di Media Library untuk memulihkan clip terkait.`,
  )
}, [expiredAssets])
```

5. Hapus blok render lama `{(notice || error || autosave.error) && (...)}` dan blok alerts expiring/expired di bawah workspace.

6. Bungkus node preview dengan container relatif + toasts + banner:

```tsx
preview={
  <div className="relative">
    <TimelinePreview
      /* props existing ... */
      errorBanner={(error || autosave.error) ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-lg border border-danger/60 bg-danger/10 p-3 text-sm"
        >
          <span>{error ?? autosave.error}</span>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label="Tutup pesan galat"
            onClick={() => setError(null)}
          >
            ×
          </Button>
        </div>
      ) : null}
    />
    <EditorToasts toasts={toasts} onDismiss={dismissToast} />
  </div>
}
```

7. Error polling transient: dalam effect `load()` di komponen `ClipEditor` (bukan Ready), pada branch `!response.ok` HANYA panggil `setError` bila body TIDAK memiliki field `segment` (error fatal); selain itu langsung `pollAgain()` tanpa setError. Pada `catch` network, JANGAN setError — hanya pollAgain (pesan lama 'Koneksi ke status video sempat terputus.' dihapus supaya banner tidak berkedip selama polling pending).

- [ ] **Step 5: Verifikasi**

Run (cwd `apps/web`): `bunx vitest run test/EditorControls.test.tsx test/EditorWorkspace.test.tsx`
Expected: PASS — termasuk `processing clip recovers from a transient polling error` (tanpa setError transient) dan semua test autosave existing.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/ClipEditor.tsx apps/web/components/editor/TimelinePreview.tsx apps/web/test/EditorControls.test.tsx
git commit -m "feat(editor): toasts over preview and persistent error banners"
```

---

### Task 10: Performa (memoized transitions, paused redraw gate, rAF playhead, stabil context)

**Files:**
- Modify: `apps/web/components/editor/TimelinePreview.tsx`
- Modify: `apps/web/components/ClipEditor.tsx`
- Test (modify): `apps/web/test/EditorControls.test.tsx`

**Interfaces:**
- Consumes: `createFrameThrottle`, `createRafSink` (Task 1).
- Produces (perilaku, tanpa API publik baru):
  - Cache `evaluateTransitions` per bucket frame: `Map<number, result>` keyed `Math.floor(outputTime * frameRate)`; invalidasi penuh saat identitas `spec` berubah; dibuang bila >600 entri.
  - Paused redraw lewat `createFrameThrottle(minIntervalMs: 33)`; event media loaded memakai `force()`. Saat playing: draw langsung.
  - Semua jalur `onPlayheadChange` (controller `onTime` + slider onChange) melalui satu `createRafSink`.
  - ClipEditor: `timelineContext.assets` & `previewAssets` stabil via pattern `assetsRef` + memo keyed string derived.

- [ ] **Step 1: Tulis regression test**

Di `apps/web/test/EditorControls.test.tsx` tambah:

```tsx
test('identity churn pada assets saat playing tidak mem-pause media', async () => {
  const userEvent = (await import('@testing-library/user-event')).default
  const pauseSpy = vi
    .spyOn(HTMLMediaElement.prototype, 'pause')
    .mockImplementation(() => undefined)
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined)
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)

  const shared = {
    spec: makeEditorSpec(),
    words: [] as never[],
    playhead: 0,
    onPlayheadChange: vi.fn(),
    onStall: vi.fn(),
  }
  const { rerender } = render(
    <TimelinePreview
      {...shared}
      assets={[candidateVideo]}
      playing={false}
      onPlayingChange={vi.fn()}
    />,
  )
  await userEvent.click(screen.getByRole('button', { name: 'Putar preview' }))

  rerender(
    <TimelinePreview
      {...shared}
      assets={[{ ...candidateVideo }]}
      playing
      onPlayingChange={vi.fn()}
    />,
  )
  await new Promise((resolve) => setTimeout(resolve, 80))

  expect(pauseSpy).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Jalankan untuk melihat baseline**

Run (cwd `apps/web`): `bunx vitest run test/EditorControls.test.tsx`
Expected: kemungkinan FAIL (context rebuild → controller recreation → pause). Bila ternyata PASS, tetap lanjut — test menjadi pengaman regresi.

- [ ] **Step 3: Implementasi TimelinePreview**

Di `TimelinePreview.tsx`:

1. Imports tambahan:

```tsx
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  createFrameThrottle,
  createRafSink,
  type FrameThrottle,
  type RafSink,
} from './frameScheduler'
```

2. Ref infrastruktur (dekat refs existing; sink/gate dibuat lazy sekali):

```tsx
const playingRef = useRef(playing)
playingRef.current = playing

const lastActiveRef = useRef<ActiveTimelineItem[]>([])
const reportedTimeRef = useRef(playhead) // sudah ada

const sinkRef = useRef<RafSink | null>(null)
if (sinkRef.current === null) {
  sinkRef.current = createRafSink((time) =>
    callbacksRef.current.onPlayheadChange(time),
  )
}
useEffect(() => () => sinkRef.current?.dispose(), [])

const gateRef = useRef<FrameThrottle | null>(null)
if (gateRef.current === null) {
  gateRef.current = createFrameThrottle(() => {
    drawFrameRef.current?.(lastActiveRef.current, reportedTimeRef.current)
  }, { minIntervalMs: 33 })
}
useEffect(() => () => gateRef.current?.cancel(), [])

const transitionCacheRef = useRef<{
  spec: EditSpecV3 | null
  buckets: Map<number, ReturnType<typeof evaluateTransitions>>
}>({ spec: null, buckets: new Map() })
```

3. Ubah efek pembuat controller:
   - `onTime`: ganti `callbacksRef.current.onPlayheadChange(outputTime)` dengan:

   ```tsx
   onTime: (outputTime) => {
     reportedTimeRef.current = outputTime
     sinkRef.current?.push(outputTime)
   },
   ```

   - `onFrame`: ganti dengan gated routing:

   ```tsx
   onFrame: (active) => {
     lastActiveRef.current = active
     const outputTime = active[0]?.outputTime ?? reportedTimeRef.current
     if (playingRef.current) {
       drawFrameRef.current?.(active, outputTime)
     } else {
       gateRef.current?.request()
     }
   },
   ```

   - Isi logika gambar existing (fungsi `drawFrame` yang sekarang inline di efek) pindahkan menjadi assignment ke ref di akhir efek:

   ```tsx
   drawFrameRef.current = (active, outputTime) => {
     // ...logika layers + transitionsAt + drawTimelineComposite yang existing...
   }
   ```

4. Deklarasi ref penampung draw (dekat refs lain):

```tsx
const drawFrameRef = useRef<
  ((active: ActiveTimelineItem[], outputTime: number) => void) | null
>(null)
```

5. Helper cache transitions (fungsi biasa di dalam komponen, membaca refs):

```tsx
function transitionsAt(outputTime: number) {
  const cache = transitionCacheRef.current
  if (cache.spec !== spec) {
    cache.spec = spec
    cache.buckets = new Map()
  }
  const bucket = Math.floor(outputTime * spec.output.frameRate)
  let value = cache.buckets.get(bucket)
  if (value === undefined) {
    if (cache.buckets.size > 600) cache.buckets.clear()
    value = evaluateTransitions(spec, bucket / spec.output.frameRate)
    cache.buckets.set(bucket, value)
  }
  return value
}
```

Ganti baris `const transitionState = evaluateTransitions(spec, outputTime)` di drawFrame dengan `const transitionState = transitionsAt(outputTime)`.

6. Slider playhead: route lewat sink:

```tsx
onChange={(event) => {
  const next = Number(event.currentTarget.value)
  reportedTimeRef.current = next
  sinkRef.current?.push(next)
}}
```

(hapus pemanggilan langsung `onPlayheadChange`.)

7. `redrawLoadedFrame` pakai force:

```tsx
function redrawLoadedFrame(): void {
  gateRef.current?.force()
  void controllerRef.current?.seek(playhead).catch(() => undefined)
}
```

- [ ] **Step 4: Stabilisasi context di ClipEditor**

Di `ReadyClipEditor`:

```tsx
const assetsRef = useRef(assets)
assetsRef.current = assets

const assetMetaKey = useMemo(
  () => [...BUILTIN_MEDIA, ...assets]
    .map((asset) =>
      `${asset.id}:${asset.mediaType}:${asset.duration}:${asset.width}:${asset.height}:${asset.hasAudio}`,
    )
    .sort()
    .join('|'),
  [assets],
)

const timelineContext = useMemo<TimelineContext>(() => {
  const all = [...BUILTIN_MEDIA, ...assetsRef.current]
  return {
    candidateDuration: payload.clip.durationSec,
    sourceId: payload.clip.id,
    candidateAssetId,
    assets: Object.fromEntries(all.map((asset) => [asset.id, {
      id: asset.id,
      mediaType: asset.mediaType,
      duration: asset.duration,
      width: asset.width,
      height: asset.height,
      hasAudio: asset.hasAudio,
    }])),
  }
  // Rebuild hanya saat metadata berubah (assetMetaKey), bukan tiap identitas array.
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [assetMetaKey, candidateAssetId, payload.clip.durationSec, payload.clip.id])

const previewAssetsKey = useMemo(
  () => assets.map((asset) => `${asset.id}:${asset.url}`).sort().join('|'),
  [assets],
)
const previewAssets = useMemo(
  () => assetsRef.current.map((asset) =>
    asset.id === candidateAssetId ? { ...asset, url: mediaUrl } : asset,
  ),
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed oleh previewAssetsKey + mediaUrl.
  [previewAssetsKey, mediaUrl, candidateAssetId],
)
```

- [ ] **Step 5: Verifikasi**

Run (cwd `apps/web`): `bunx vitest run test/frameScheduler.test.ts test/EditorControls.test.tsx test/timelinePlayback.test.ts test/EditorWorkspace.test.tsx`
Expected: PASS termasuk regression Task 10 Step 1 dan test playback lama (`playback survives a playhead re-render`).

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/editor/TimelinePreview.tsx apps/web/components/ClipEditor.tsx apps/web/test/EditorControls.test.tsx
git commit -m "perf(editor): throttle paused redraws, raf playhead, stable contexts"
```

---

### Task 11: Paritas mobile (tab bar sticky, sheet full-height, transport sticky)

**Files:**
- Modify: `apps/web/components/editor/EditorWorkspace.tsx`
- Modify: `apps/web/components/ui/sheet.tsx` (prop `closeLabel`)
- Modify: `apps/web/components/editor/TimelinePreview.tsx` (transport sticky + scrubber h-11)
- Modify: `apps/web/components/ClipEditor.tsx` (wire `onOpenMedia` inspector)
- Test (modify): `apps/web/test/EditorWorkspace.test.tsx`

**Interfaces:**
- Produces:
  - `SheetContent` props baru opsional: `closeLabel?: string` default `"Tutup panel"` untuk aria-label tombol tutup.
  - `EditorWorkspace` mobile: tab bar sticky bottom (`role="tablist" aria-label="Panel editor"`) dengan dua tab `Media` dan `Inspector` (`role="tab"`, `aria-selected`, toggle klik-dua-kali menutup); Sheet bottom `h-[85dvh]` flex-col dengan header sticky (`SheetTitle`) dan body scrollable (`role="tabpanel"`). Desktop tidak berubah.
  - Transport TimelinePreview: className transport += `sticky bottom-0 z-30 lg:static`; scrubber input += `h-11`.
  - Catatan wiring empty-state "Buka Media" (Task 7): state panel hidup di dalam EditorWorkspace; karena menaikkan state akan mengubah API publik tanpa nilai tambah, biarkan `onOpenMedia` LayerInspector TANPA wiring untuk saat ini dan catat di commit message sebagai follow-up kecil.

- [ ] **Step 1: Update test**

Di `apps/web/test/EditorWorkspace.test.tsx` ganti dua test sheet mobile:

Lama (`mobile media library opens as a sheet` / `mobile inspector opens as a sheet`) → baru:

```tsx
test('mobile media terbuka sebagai sheet penuh lewat tab', async () => {
  render(<EditorWorkspace {...workspaceProps} />)

  await userEvent.click(screen.getByRole('tab', { name: 'Media' }))

  expect(screen.getByRole('dialog', { name: 'Media' })).toBeVisible()
  expect(screen.getAllByText('Media library content')).toHaveLength(2)
})

test('mobile inspector terbuka sebagai sheet penuh lewat tab', async () => {
  render(<EditorWorkspace {...workspaceProps} />)

  await userEvent.click(screen.getByRole('tab', { name: 'Inspector' }))

  expect(screen.getByRole('dialog', { name: 'Inspector' })).toBeVisible()
  expect(screen.getAllByText('Inspector content')).toHaveLength(2)
})
```

- [ ] **Step 2: Verifikasi gagal**

Run (cwd `apps/web`): `bunx vitest run test/EditorWorkspace.test.tsx`
Expected: dua test mobile FAIL (tombol lama 'Buka media' tidak lagi ada sebagai tab).

- [ ] **Step 3: Parametrize sheet close label**

Di `ui/sheet.tsx`, ubah destrukturisasi `SheetContent`:

```tsx
(({ className, children, closeLabel = 'Tutup panel', ...props }, ref) => (
```

dan tombol tutup:

```tsx
<DialogPrimitive.Close aria-label={closeLabel} ... >
```

(Prop mengalir otomatis karena `ComponentPropsWithoutRef<typeof DialogPrimitive.Content>`; jangan teruskan `closeLabel` ke DOM — pastikan sudah dikeluarkan dari rest spread.)

- [ ] **Step 4: Rewrite EditorWorkspace**

Full rewrite `EditorWorkspace.tsx`:

```tsx
'use client'

import { useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'

export interface EditorWorkspaceProps {
  header: ReactNode
  preview: ReactNode
  mediaLibrary: ReactNode
  inspector: ReactNode
  timeline: ReactNode
}

type MobilePanel = 'media' | 'inspector' | null

export function EditorWorkspace({
  header,
  preview,
  mediaLibrary,
  inspector,
  timeline,
}: EditorWorkspaceProps) {
  const [panel, setPanel] = useState<MobilePanel>(null)

  return (
    <section className="editor-workspace -mx-4 overflow-hidden border-y border-border bg-background sm:-mx-6 lg:-mx-8">
      {header}
      <div className="grid min-h-0 lg:grid-cols-[14rem_minmax(0,1fr)_20rem]">
        <aside
          aria-label="Media"
          className="hidden max-h-[60vh] overflow-y-auto border-r border-border bg-surface lg:block"
        >
          {mediaLibrary}
        </aside>
        {preview}
        <aside
          aria-label="Inspector"
          className="hidden max-h-[60vh] overflow-y-auto border-l border-border bg-surface lg:block"
        >
          {inspector}
        </aside>
      </div>

      <div
        role="tablist"
        aria-label="Panel editor"
        className="sticky bottom-0 z-40 flex gap-2 border-t border-border bg-surface p-2 lg:hidden"
      >
        {(['media', 'inspector'] as const).map((target) => (
          <button
            key={target}
            type="button"
            role="tab"
            aria-selected={panel === target}
            aria-controls={`mobile-panel-${target}`}
            className={cn(
              'min-h-11 flex-1 rounded-lg text-sm font-black transition',
              panel === target
                ? 'bg-primary text-primary-foreground'
                : 'bg-surface-raised text-muted hover:text-foreground',
            )}
            onClick={() =>
              setPanel((current) => (current === target ? null : target))
            }
          >
            {target === 'media' ? 'Media' : 'Inspector'}
          </button>
        ))}
      </div>

      <Sheet
        open={panel === 'media'}
        onOpenChange={(open) => setPanel(open ? 'media' : null)}
      >
        <SheetContent
          className="flex h-[85dvh] flex-col p-0"
          closeLabel="Tutup panel Media"
          aria-label="Media"
        >
          <div className="sticky top-0 border-b border-border bg-surface-raised px-5 pb-3 pt-4">
            <SheetTitle className="pr-12 text-xl font-black">Media</SheetTitle>
          </div>
          <div
            id="mobile-panel-media"
            role="tabpanel"
            aria-label="Media"
            className="min-h-0 flex-1 overflow-y-auto"
          >
            {mediaLibrary}
          </div>
        </SheetContent>
      </Sheet>

      <Sheet
        open={panel === 'inspector'}
        onOpenChange={(open) => setPanel(open ? 'inspector' : null)}
      >
        <SheetContent
          className="flex h-[85dvh] flex-col p-0"
          closeLabel="Tutup panel Inspector"
          aria-label="Inspector"
        >
          <div className="sticky top-0 border-b border-border bg-surface-raised px-5 pb-3 pt-4">
            <SheetTitle className="pr-12 text-xl font-black">Inspector</SheetTitle>
          </div>
          <div
            id="mobile-panel-inspector"
            role="tabpanel"
            aria-label="Inspector"
            className="min-h-0 flex-1 overflow-y-auto"
          >
            {inspector}
          </div>
        </SheetContent>
      </Sheet>

      {timeline}
    </section>
  )
}
```

Catatan wiring empty-state "Buka Media" dari Task 7: state panel hidup di
dalam EditorWorkspace; menaikkan state mengubah API publik tanpa nilai
tambah, jadi biarkan `onOpenMedia` LayerInspector TANPA wiring untuk saat
ini dan catat di commit message sebagai follow-up kecil.

- [ ] **Step 5: Transport sticky + scrubber tinggi**

Di `TimelinePreview.tsx`:

1. Transport div className: `flex items-center gap-3 border-t border-white/10 bg-surface px-3 py-2` → `sticky bottom-0 z-30 flex items-center gap-3 border-t border-white/10 bg-surface px-3 py-2 lg:static`.
2. Scrubber input className: `min-w-0 flex-1 accent-primary` → `h-11 min-w-0 flex-1 accent-primary`.

- [ ] **Step 6: Verifikasi**

Run (cwd `apps/web`): `bunx vitest run test/EditorWorkspace.test.tsx test/EditorControls.test.tsx test/MediaLibrary.test.tsx`
Expected: PASS.

Audit sentuh (manual, cepat): Button size icon = 44px ✓; tab mobile min-h-11 ✓; joint target w-11 ✓; transition icon size-11 ✓; trim handles 44px ✓; scrubber h-11 ✓. Toast close 24px — secondary action dengan label aksesibel; diterima.

- [ ] **Step 7: Commit**

```bash
git add apps/web/components/editor/EditorWorkspace.tsx apps/web/components/ui/sheet.tsx apps/web/components/editor/TimelinePreview.tsx apps/web/test/EditorWorkspace.test.tsx
git commit -m "feat(editor): mobile parity with sticky panels and full-height sheets"
```

---

### Task 12: MediaLibrary header + verifikasi akhir

**Files:**
- Modify: `apps/web/components/editor/MediaLibrary.tsx`
- Test: jalankan penuh; sesuaikan selector MediaLibrary.test bila perlu

**Interfaces:**
- Consumes: `PanelHeader` (Task 3).
- Produces: blok atas MediaLibrary diganti PanelHeader — title `Media`, hint `${formatBytes(usedBytes)} / ${formatBytes(limitBytes)}`, actions = tombol `Upload media` existing. Struktur tab/search/panel tidak berubah.

- [ ] **Step 1: Baca assertion MediaLibrary.test**

Run (cwd `apps/web`): `bunx vitest run test/MediaLibrary.test.tsx`
Expected: PASS atau FAIL selektor heading. Catat assertion yang menyentuh `<h2>Media</h2>` / kuota.

- [ ] **Step 2: Implementasi PanelHeader**

Di `MediaLibrary.tsx`, ganti blok pertama `<div className="flex items-center justify-between gap-3">...</div>` (h2 + kuota + tombol Upload + input file) menjadi:

```tsx
<PanelHeader
  title="Media"
  hint={`${formatBytes(usage.usedBytes)} / ${formatBytes(usage.limitBytes)}`}
  actions={
    <>
      <Button
        type="button"
        size="sm"
        onClick={() => uploadInput.current?.click()}
      >
        <Upload className="size-4" aria-hidden="true" />
        Upload media
      </Button>
      <input
        ref={uploadInput}
        type="file"
        className="sr-only"
        accept="image/png,image/jpeg,image/webp,audio/mpeg,audio/wav,audio/ogg,audio/mp4,audio/webm,video/mp4,video/webm,video/quicktime"
        aria-label="Pilih media untuk di-upload"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0]
          if (file) void uploadFile(file)
          event.currentTarget.value = ''
        }}
      />
    </>
  }
/>
```

Import `import { PanelHeader } from './PanelHeader'`.

Penting: MediaLibrary dirender di dua konteks (aside desktop & sheet mobile).
PanelHeader punya `<h2>` — duplikasi heading antar konteks sudah terjadi juga
sebelumnya (dua section "Media project"), aman untuk test selama query tidak
pakai `getByRole('heading', { level: 2 })` strict tunggal. Sesuaikan test bila
perlu (lihat Step 1).

- [ ] **Step 3: Verifikasi MediaLibrary**

Run (cwd `apps/web`): `bunx vitest run test/MediaLibrary.test.tsx test/builtinSfx.test.ts`
Expected: PASS (dengan penyesuaian selector minimal bila perlu).

- [ ] **Step 4: Suite penuh + typecheck**

Run (root): `bun run test`
Expected: SELURUH suite PASS. Bila ada failure, perbaiki sebelum lanjut — JANGAN commit merah.

Run (root): `bun run typecheck`
Expected: tidak ada error BARU dari file task ini.

- [ ] **Step 5: Checklist manual (laporan teks, bukan kode)**

Verifikasi manual di `bun run dev` (butuh env Supabase/R2 milik user):

Desktop (viewport ≥1024):
1. Semua panel punya header; judul inspector berubah saat klik clip/track/transition/joint.
2. Klik cut point → popover muncul di titik potong; Add membuat transition; Esc menutup.
3. Tekan `?` → cheat sheet; Space/S/Del/Ctrl+Z bekerja walau fokus di body; tidak aktif saat fokus di input rename layer.
4. Scrub saat pause halus (≤1 draw/frame); play lancar; drag slider saat playing tidak mem-pause media.
5. Toast sukses/warning muncul kanan-atas preview; error ekspor jadi banner persisten di atas transport.
6. Header: chip simpan berwarna; Ekspor MP4 di header dengan progress.

Mobile (DevTools iPhone SE 375px):
7. Layout stacked; tab bar sticky terlihat; sheet Media/Inspector full-height dengan header sticky.
8. Transport (play/time/scrubber) sticky dan tidak hilang saat scroll.
9. Semua target mudah disentuh; pinch-zoom timeline masih bekerja.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/editor/MediaLibrary.tsx apps/web/test/MediaLibrary.test.tsx
git commit -m "feat(editor): media library panel header and quota readout"
```

---

## Self-Review Notes (sudah dicek penulis plan)

- **Spec coverage:** Bagian 1 wayfinding → Task 3+6+7; Bagian 2 feedback → Task 2+8+9; Bagian 3 shortcut → Task 4+6; Bagian 4 performa → Task 1+10; Bagian 5 mobile → Task 11 (+12); Bagian 6 error handling → Task 9; Testing → tiap task.
- **Konsistensi tipe:** `TimelineTransport` didefinisi Task 6 dan dipakai ClipEditor Task 6; `FrameThrottle`/`RafSink` didefinisi Task 1 dipakai Task 10; `ToastTone`/`showToast(message, tone)` konsisten Task 2→9; props `errorBanner` Task 9; `closeLabel` Task 11.
- **Urutan aman:** Task 9 menyentuh efek polling di ClipEditor yang juga disentuh Task 10 — jalankan berurutan; konflik kecil diselesaikan executor dengan merge manual pada file yang sama.





