'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft,
  ArrowRight,
  Clapperboard,
  LoaderCircle,
  Play,
  RotateCcw,
} from 'lucide-react'
import type { ErrorCode } from '@klipmatic/shared'
import type { CandidateView } from '@/lib/candidates'
import { createPreviewClip, fetchClipPreviewStatus } from '@/lib/candidatePreviewClient'
import { messageFor } from '@/lib/errorMessages'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'

type PreviewState =
  | { kind: 'idle' }
  | { kind: 'preparing'; clipId: string | null }
  | { kind: 'ready'; clipId: string; url: string }
  | { kind: 'failed'; clipId: string | null; message: string }

export interface CandidatePreviewModalProps {
  candidate: CandidateView
  open: boolean
  hasPrevious: boolean
  hasNext: boolean
  initialClipId: string | null
  onOpenChange(open: boolean): void
  onPrevious(): void
  onNext(): void
  onClipResolved(candidateId: string, clipId: string): void
}

const POLL_DELAYS = [1000, 1500, 2000, 3000] as const

function durationLabel(startSec: number, endSec: number) {
  const duration = Math.max(0, Math.floor(endSec) - Math.floor(startSec))
  return `${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, '0')}`
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      window.clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    const timer = window.setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function isAbort(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}

export function CandidatePreviewModal({
  candidate,
  open,
  hasPrevious,
  hasNext,
  initialClipId,
  onOpenChange,
  onPrevious,
  onNext,
  onClipResolved,
}: CandidatePreviewModalProps) {
  const router = useRouter()
  const [state, setState] = useState<PreviewState>(() =>
    candidate.previewUrl
      ? { kind: 'ready', clipId: initialClipId ?? '', url: candidate.previewUrl }
      : { kind: 'idle' },
  )
  const operationRef = useRef<AbortController | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)

  const stopMedia = useCallback(() => {
    operationRef.current?.abort()
    operationRef.current = null
    if (videoRef.current) {
      videoRef.current.pause()
      videoRef.current.removeAttribute('src')
      videoRef.current.load()
    }
  }, [])

  useEffect(() => {
    stopMedia()
    // Kalau kandidat sudah punya preview pre-render, langsung putar tanpa
    // membuat clip dulu; jalur create-clip hanya untuk kandidat yang belum
    // di-render oleh worker.
    if (candidate.previewUrl) {
      setState({ kind: 'ready', clipId: initialClipId ?? '', url: candidate.previewUrl })
    } else {
      setState({ kind: 'idle' })
    }
    return stopMedia
  }, [candidate.id, candidate.previewUrl, initialClipId, open, stopMedia])

  const poll = useCallback(async (clipId: string, signal: AbortSignal) => {
    let retryIndex = 0
    while (!signal.aborted) {
      let transientError = false
      try {
        const status = await fetchClipPreviewStatus(clipId, signal)
        retryIndex = 0
        if (status.status === 'ready' && status.url) {
          setState({ kind: 'ready', clipId, url: status.url })
          return
        }
        if (status.status === 'failed') {
          setState({
            kind: 'failed',
            clipId,
            message: messageFor((status.errorCode ?? 'INTERNAL') as ErrorCode),
          })
          return
        }
      } catch (error) {
        if (isAbort(error) || signal.aborted) return
        transientError = true
      }

      try {
        const wait = POLL_DELAYS[Math.min(retryIndex, POLL_DELAYS.length - 1)]!
        await delay(wait, signal)
        if (transientError) {
          retryIndex = Math.min(retryIndex + 1, POLL_DELAYS.length - 1)
        }
      } catch (error) {
        if (isAbort(error)) return
        throw error
      }
    }
  }, [])

  const startPreview = useCallback(async (forceCreate = false) => {
    stopMedia()
    const operation = new AbortController()
    operationRef.current = operation
    const knownClipId = forceCreate ? null : initialClipId
    setState({ kind: 'preparing', clipId: knownClipId })

    try {
      const clipId = knownClipId ?? (
        await createPreviewClip(candidate.id, operation.signal)
      ).clipId
      if (!knownClipId) onClipResolved(candidate.id, clipId)
      if (operation.signal.aborted) return
      setState({ kind: 'preparing', clipId })
      await poll(clipId, operation.signal)
    } catch (error) {
      if (isAbort(error) || operation.signal.aborted) return
      setState({
        kind: 'failed',
        clipId: knownClipId,
        message: error instanceof Error ? error.message : 'Gagal menyiapkan preview.',
      })
    }
  }, [candidate.id, initialClipId, onClipResolved, poll, stopMedia])

  const navigate = useCallback((direction: 'previous' | 'next') => {
    stopMedia()
    setState({ kind: 'idle' })
    if (direction === 'previous') onPrevious()
    else onNext()
  }, [onNext, onPrevious, stopMedia])

  const editClip = useCallback(async () => {
    const clipId = state.kind === 'idle'
      ? initialClipId
      : state.clipId
    if (clipId) {
      router.push(`/clips/${clipId}`)
      return
    }

    stopMedia()
    const operation = new AbortController()
    operationRef.current = operation
    setState({ kind: 'preparing', clipId: null })
    try {
      const created = await createPreviewClip(candidate.id, operation.signal)
      onClipResolved(candidate.id, created.clipId)
      router.push(`/clips/${created.clipId}`)
    } catch (error) {
      if (isAbort(error) || operation.signal.aborted) return
      setState({
        kind: 'failed',
        clipId: null,
        message: error instanceof Error ? error.message : 'Gagal membuka editor.',
      })
    }
  }, [candidate.id, initialClipId, onClipResolved, router, state, stopMedia])

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) stopMedia()
    onOpenChange(nextOpen)
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    const target = event.target as HTMLElement
    if (['VIDEO', 'INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName)) return
    if (event.key === 'ArrowLeft' && hasPrevious) {
      event.preventDefault()
      navigate('previous')
    }
    if (event.key === 'ArrowRight' && hasNext) {
      event.preventDefault()
      navigate('next')
    }
  }

  const poster = candidate.thumbnailUrl ?? undefined

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent onKeyDown={handleKeyDown} className="max-w-5xl p-0 sm:p-0">
        <header className="pr-16 p-4 pb-3 sm:p-6 sm:pb-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge>#{candidate.rank}</Badge>
            <Badge variant="score" aria-label={`skor ${Math.round(candidate.score * 100)}`}>
              {Math.round(candidate.score * 100)}
            </Badge>
            <span className="text-sm font-bold text-muted">
              {durationLabel(candidate.startSec, candidate.endSec)}
            </span>
          </div>
          <DialogTitle className="mt-3 pr-2 text-lg sm:text-2xl">
            {candidate.title}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Preview video untuk kandidat peringkat {candidate.rank}.
          </DialogDescription>
        </header>

        <div
          data-testid="candidate-preview-media"
          className="relative mx-auto aspect-[9/16] w-full max-w-sm overflow-hidden bg-black"
        >
          {state.kind === 'ready' ? (
            <video
              ref={videoRef}
              data-testid="candidate-preview-video"
              className="size-full object-contain"
              src={state.url}
              poster={poster}
              controls
              autoPlay={Boolean(candidate.previewUrl)}
              muted={Boolean(candidate.previewUrl)}
              playsInline
              preload="auto"
            />
          ) : (
            <>
              {poster ? (
                <img src={poster} alt="" className="size-full object-cover" />
              ) : (
                <div className="size-full bg-surface-soft" />
              )}
              <div className="absolute inset-0 grid place-items-center bg-black/35 p-4">
                {state.kind === 'idle' && (
                  <Button
                    type="button"
                    size="icon"
                    className="size-14 rounded-full"
                    aria-label={`Putar preview ${candidate.title}`}
                    onClick={() => void startPreview()}
                  >
                    <Play className="size-6 fill-current" aria-hidden="true" />
                  </Button>
                )}
                {state.kind === 'preparing' && (
                  <div role="status" className="flex items-center gap-3 rounded-lg bg-black/75 px-4 py-3 text-sm font-bold text-white">
                    <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />
                    Menyiapkan preview...
                  </div>
                )}
                {state.kind === 'failed' && (
                  <div className="max-w-md rounded-lg bg-black/80 p-4 text-center text-white">
                    <p role="alert" className="text-sm leading-6">{state.message}</p>
                    <Button
                      type="button"
                      variant="secondary"
                      className="mt-3"
                      onClick={() => void startPreview(true)}
                    >
                      <RotateCcw className="size-4" aria-hidden="true" />
                      Coba lagi
                    </Button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <div className="space-y-5 p-4 sm:p-6">
          <div>
            <p className="text-base font-bold leading-7 text-foreground">{candidate.hookText}</p>
            {candidate.reason && (
              <p className="mt-2 text-sm leading-6 text-muted">{candidate.reason}</p>
            )}
          </div>

          <footer className="grid grid-cols-[44px_1fr_44px] gap-2 border-t border-border pt-4 sm:grid-cols-[1fr_auto_1fr]">
            <Button
              type="button"
              variant="secondary"
              size="icon"
              aria-label="Candidate sebelumnya"
              disabled={!hasPrevious}
              onClick={() => navigate('previous')}
              className="sm:w-auto sm:px-4"
            >
              <ArrowLeft className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">Sebelumnya</span>
            </Button>
            <Button type="button" onClick={() => void editClip()}>
              <Clapperboard className="size-4" aria-hidden="true" />
              Edit klip
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="icon"
              aria-label="Candidate berikutnya"
              disabled={!hasNext}
              onClick={() => navigate('next')}
              className="sm:ml-auto sm:w-auto sm:px-4"
            >
              <span className="hidden sm:inline">Berikutnya</span>
              <ArrowRight className="size-4" aria-hidden="true" />
            </Button>
          </footer>
        </div>
      </DialogContent>
    </Dialog>
  )
}
