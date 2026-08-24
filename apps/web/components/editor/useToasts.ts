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
  // Akuntansi slot hidup di ref supaya semua keputusan (enqueue, dequeue,
  // penjadwalan timer) terjadi di luar updater. Updater yang murni bisa
  // dipanggil ulang React kapan saja (StrictMode dev memanggilnya dua kali)
  // tanpa menimbulkan efek sisi ganda.
  const visibleIdsRef = useRef<Set<string>>(new Set())
  const queueRef = useRef<EditorToast[]>([])
  const timersRef = useRef(new Map<string, number>())
  // scheduleAutoDismiss dipanggil dari dalam removeAndSurface dan
  // sebaliknya lewat callback timer; ref memutus siklus dependensi
  // antara kedua useCallback tanpa mengorbankan kestabilan identitas.
  const removeAndSurfaceRef = useRef<(id: string) => void>(() => {})

  const scheduleAutoDismiss = useCallback(
    (toast: EditorToast) => {
      const timer = window.setTimeout(() => {
        removeAndSurfaceRef.current(toast.id)
      }, durations[toast.tone])
      timersRef.current.set(toast.id, timer)
    },
    // durations adalah objek baru tiap render bila options dikirim; kunci
    // deps oleh nilai primitifnya agar callback tetap stabil antar-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [durations.success, durations.info, durations.warning],
  )

  const removeAndSurface = useCallback(
    (id: string) => {
      timersRef.current.delete(id)
      visibleIdsRef.current.delete(id)
      setToasts((current) => current.filter((item) => item.id !== id))
      if (visibleIdsRef.current.size < MAX_VISIBLE) {
        const queued = queueRef.current.shift()
        if (queued) {
          visibleIdsRef.current.add(queued.id)
          scheduleAutoDismiss(queued)
          setToasts((current) => [...current, queued])
        }
      }
    },
    [scheduleAutoDismiss],
  )

  useEffect(() => {
    removeAndSurfaceRef.current = removeAndSurface
  }, [removeAndSurface])

  const showToast = useCallback(
    (message: string, tone: ToastTone = 'info') => {
      const toast: EditorToast = {
        id: globalThis.crypto.randomUUID(),
        tone,
        message,
      }
      if (visibleIdsRef.current.size >= MAX_VISIBLE) {
        queueRef.current.push(toast)
        return
      }
      visibleIdsRef.current.add(toast.id)
      scheduleAutoDismiss(toast)
      setToasts((current) => [...current, toast])
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
      if (!visibleIdsRef.current.has(id)) return
      removeAndSurface(id)
    },
    [removeAndSurface],
  )

  useEffect(
    () => () => {
      for (const timer of timersRef.current.values()) window.clearTimeout(timer)
      timersRef.current.clear()
      queueRef.current = []
      visibleIdsRef.current.clear()
    },
    [],
  )

  return { toasts, showToast, dismissToast }
}
