'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { EditSpecV3 } from '@cheapclipper/engine'

export type AutosaveStatus = 'saved' | 'unsaved' | 'saving' | 'error'

export interface AutosaveController {
  status: AutosaveStatus
  error: string | null
  flush: () => Promise<void>
  retry: () => Promise<void>
}

export function useEditorAutosave({
  clipId,
  spec,
  delayMs = 1000,
}: {
  clipId: string
  spec: EditSpecV3
  delayMs?: number
}): AutosaveController {
  const [status, setStatus] = useState<AutosaveStatus>('saved')
  const [error, setError] = useState<string | null>(null)
  const latest = useRef(spec)
  const saved = useRef(spec)
  const inFlight = useRef<Promise<void> | null>(null)

  const flush = useCallback(async () => {
    if (inFlight.current) await inFlight.current
    if (saved.current === latest.current) {
      setStatus('saved')
      setError(null)
      return
    }

    const run = (async () => {
      while (saved.current !== latest.current) {
        const snapshot = latest.current
        setStatus('saving')
        const response = await fetch(`/api/clips/${clipId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ editSpec: snapshot, renderStatus: 'draft' }),
        })
        if (!response.ok) throw new Error('Perubahan gagal disimpan.')
        saved.current = snapshot
      }
    })()
    inFlight.current = run
    try {
      await run
      setStatus('saved')
      setError(null)
    } catch (cause) {
      setStatus('error')
      setError(
        cause instanceof Error ? cause.message : 'Perubahan gagal disimpan.',
      )
      throw cause
    } finally {
      inFlight.current = null
    }
  }, [clipId])

  useEffect(() => {
    if (spec === latest.current) return
    latest.current = spec
    if (spec === saved.current) {
      setStatus('saved')
      setError(null)
      return
    }
    setStatus('unsaved')
    const timer = window.setTimeout(() => {
      void flush().catch(() => undefined)
    }, delayMs)
    return () => window.clearTimeout(timer)
  }, [delayMs, flush, spec])

  useEffect(() => {
    if (status === 'saved') return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [status])

  const retry = useCallback(async () => {
    setStatus('unsaved')
    await flush()
  }, [flush])

  return { status, error, flush, retry }
}
