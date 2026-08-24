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
