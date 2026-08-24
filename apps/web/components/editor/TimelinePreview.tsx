'use client'

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Pause, Play } from 'lucide-react'
import {
  drawTimelineComposite,
  evaluateTransitions,
  mapWordsToTimeline,
  type ActiveTimelineItem,
  type EditSpecV3,
  type TimelineContext,
  type TranscriptWord,
  type VisualTransform,
} from '@klipmatic/engine'
import { Button } from '@/components/ui/button'
import type { ResolvedMediaAsset } from '@/lib/clipTypes'
import {
  createTimelinePlaybackController,
  type TimelinePlaybackController,
} from './timelinePlayback'
import {
  createFrameThrottle,
  createRafSink,
  type FrameThrottle,
  type RafSink,
} from './frameScheduler'
import {
  CanvasSelectionOverlay,
  type CanvasSelection,
  type CanvasSelectionCommit,
} from './CanvasSelectionOverlay'

type TimelinePreviewProps = {
  spec: EditSpecV3
  assets: ResolvedMediaAsset[]
  words: TranscriptWord[]
  playhead: number
  playing: boolean
  onPlayheadChange: (outputTime: number) => void
  onPlayingChange: (playing: boolean) => void
  onStall: (message: string) => void
  errorBanner?: ReactNode
  onPrimaryVideoChange?: (video: HTMLVideoElement | null) => void
  canvasSelection?: CanvasSelection | null
  onCanvasCommit?: (commit: CanvasSelectionCommit) => void
  onAssetDrop?: (
    assetId: string,
    placement: { timelineStart?: number; transform?: VisualTransform },
  ) => void
}

function formatTime(value: number): string {
  const totalSeconds = Math.max(0, Math.floor(value))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

export function TimelinePreview({
  spec,
  assets,
  words,
  playhead,
  playing,
  onPlayheadChange,
  onPlayingChange,
  onStall,
  errorBanner = null,
  onPrimaryVideoChange,
  canvasSelection = null,
  onCanvasCommit,
  onAssetDrop,
}: TimelinePreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const mediaPoolRef = useRef(
    new Map<string, HTMLMediaElement | HTMLImageElement>(),
  )
  const controllerRef = useRef<TimelinePlaybackController | null>(null)
  const reportedTimeRef = useRef(playhead)
  const [stalled, setStalled] = useState(false)
  const callbacksRef = useRef({
    onPlayheadChange,
    onPlayingChange,
    onStall,
    onPrimaryVideoChange,
  })
  callbacksRef.current = {
    onPlayheadChange,
    onPlayingChange,
    onStall,
    onPrimaryVideoChange,
  }

  const playingRef = useRef(playing)
  playingRef.current = playing
  const assetsRef = useRef(assets)
  assetsRef.current = assets
  const lastActiveRef = useRef<ActiveTimelineItem[]>([])
  const drawFrameRef = useRef<
    ((active: ActiveTimelineItem[], outputTime: number) => void) | null
  >(null)

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

  const mediaEntries = useMemo(() => {
    const byId = new Map(assets.map((asset) => [asset.id, asset]))
    return spec.timeline.tracks.flatMap((track) =>
      track.type === 'caption'
        ? []
        : track.clips.flatMap((clip) => {
            const asset = byId.get(clip.assetId)
            if (!asset || asset.status !== 'ready' || !asset.url) return []
            return [{
              clipId: clip.id,
              trackType: track.type,
              primary:
                track.type === 'video' &&
                track.id === spec.timeline.primaryTrackId,
              asset,
              muted: clip.muted,
            }]
          }),
    )
  }, [assets, spec])
  const timelineWords = useMemo(
    () => mapWordsToTimeline(words, spec),
    [spec, words],
  )
  const assetContextKey = useMemo(
    () => assets
      .map((asset) =>
        `${asset.id}:${asset.mediaType}:${asset.duration}:${asset.width}:${asset.height}:${asset.hasAudio}`,
      )
      .sort()
      .join('|'),
    [assets],
  )
  const timelineContext = useMemo<TimelineContext>(() => {
    const currentAssets = assetsRef.current
    const primary = spec.timeline.tracks.find(
      (track) => track.id === spec.timeline.primaryTrackId,
    )
    const candidateAssetId = primary?.clips[0]?.assetId ?? currentAssets[0]?.id ?? 'candidate'
    return {
      sourceId: 'preview',
      candidateAssetId,
      candidateDuration:
        currentAssets.find((asset) => asset.id === candidateAssetId)?.duration ??
        spec.timeline.duration,
      assets: Object.fromEntries(currentAssets.map((asset) => [asset.id, {
        id: asset.id,
        mediaType: asset.mediaType,
        duration: asset.duration,
        width: asset.width,
        height: asset.height,
        hasAudio: asset.hasAudio,
      }])),
    }
  }, [assetContextKey, spec.timeline.duration, spec.timeline.primaryTrackId, spec.timeline.tracks])

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

  useEffect(() => {
    // Harus terisi sebelum controller dibuat: seek awal bisa memicu onFrame
    // secara sinkron saat paused sehingga frame pertama tidak hilang.
    drawFrameRef.current = (active, outputTime) => {
      const canvas = canvasRef.current
      if (!canvas) return
      const layers = active
        .filter((item) => item.trackType === 'video')
        .flatMap((item) => {
          const media = mediaPoolRef.current.get(item.clipId)
          if (media instanceof HTMLVideoElement) {
            if (
              media.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
              media.videoWidth === 0
            ) return []
          } else if (media instanceof HTMLImageElement) {
            if (!media.complete || media.naturalWidth === 0) return []
          } else return []
          return [{
            clipId: item.clipId,
            media,
            order: item.order,
            transform: item.transform,
            opacity: 1,
            primary:
              item.trackType === 'video' &&
              item.trackId === spec.timeline.primaryTrackId,
          }]
        })
      if (layers.length === 0) return
      const context = canvas.getContext('2d')
      if (!context) return
      const transitionState = transitionsAt(outputTime)
      drawTimelineComposite(
        context,
        layers,
        spec,
        timelineWords,
        outputTime,
        transitionState,
      )
    }

    const controller = createTimelinePlaybackController({
      spec,
      context: timelineContext,
      mediaForClip: (item) => {
        const media = mediaPoolRef.current.get(item.clipId)
        return media instanceof HTMLMediaElement ? media : null
      },
      onTime: (outputTime) => {
        reportedTimeRef.current = outputTime
        sinkRef.current?.push(outputTime)
      },
      onFrame: (active) => {
        lastActiveRef.current = active
        const outputTime = active[0]?.outputTime ?? reportedTimeRef.current
        if (playingRef.current) {
          drawFrameRef.current?.(active, outputTime)
        } else {
          gateRef.current?.request()
        }
      },
      onStall: (message) => {
        setStalled(true)
        callbacksRef.current.onPlayingChange(false)
        callbacksRef.current.onStall(message)
      },
    })
    controllerRef.current = controller
    void controller.seek(playhead)
    // Kalau controller dibuat ulang saat prop playing masih true (misalnya
    // karena dependensi memo berubah identitas), transport harus mengikuti
    // status yang sedang tampil; tanpa ini playback berhenti diam-diam.
    if (playing) {
      void controller.play().catch(() => undefined)
    }

    return () => {
      controller.dispose()
      controllerRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `playing` sengaja
    // dibaca saat controller dibuat ulang supaya transport tidak berhenti;
    // perubahan playing ditangani efek terpisah di bawah.
  }, [spec, timelineContext, timelineWords])

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

  useEffect(() => {
    if (Math.abs(playhead - reportedTimeRef.current) <= 0.04) return
    void controllerRef.current?.seek(playhead).catch(() => undefined)
  }, [playhead])

  useEffect(
    () => () => {
      for (const media of mediaPoolRef.current.values()) {
        if (media instanceof HTMLMediaElement) {
          media.pause()
          media.removeAttribute('src')
          media.load()
        } else {
          media.removeAttribute('src')
        }
      }
      mediaPoolRef.current.clear()
    },
    [],
  )

  function registerMedia(
    clipId: string,
    media: HTMLMediaElement | HTMLImageElement | null,
    primary: boolean,
  ): void {
    if (media) {
      mediaPoolRef.current.set(clipId, media)
    } else {
      mediaPoolRef.current.delete(clipId)
    }
    if (primary) {
      callbacksRef.current.onPrimaryVideoChange?.(
        media instanceof HTMLVideoElement ? media : null,
      )
    }
  }

  function redrawLoadedFrame(): void {
    gateRef.current?.force()
    void controllerRef.current?.seek(playhead).catch(() => undefined)
  }

  return (
    <section className="flex min-h-0 flex-col bg-black" aria-label="Video preview">
      <div className="flex min-h-0 flex-1 items-center justify-center p-3 sm:p-5">
        <div
          className="relative inline-flex max-h-[56vh] max-w-full"
          onDragOver={(event) => {
            if (event.dataTransfer.types.includes('application/x-klipmatic-asset')) {
              event.preventDefault()
              event.dataTransfer.dropEffect = 'copy'
            }
          }}
          onDrop={(event) => {
            const raw = event.dataTransfer.getData('application/x-klipmatic-asset')
            if (!raw) return
            event.preventDefault()
            try {
              const assetId = (JSON.parse(raw) as { assetId?: unknown }).assetId
              const canvas = canvasRef.current
              if (typeof assetId !== 'string' || !canvas) return
              const rect = canvas.getBoundingClientRect()
              const normalizedX = (event.clientX - rect.left) / Math.max(rect.width, 1)
              const normalizedY = (event.clientY - rect.top) / Math.max(rect.height, 1)
              const round = (value: number) => Math.round(value * 1_000_000) / 1_000_000
              onAssetDrop?.(assetId, {
                timelineStart: playhead,
                transform: {
                  x: round(Math.min(Math.max(normalizedX - 0.3, 0), 0.4)),
                  y: round(Math.min(Math.max(normalizedY - 0.3, 0), 0.4)),
                  width: 0.6,
                  height: 0.6,
                },
              })
            } catch {
              // Ignore drag payloads from outside Klipmatic.
            }
          }}
        >
          <canvas
            ref={canvasRef}
            width={spec.output.width}
            height={spec.output.height}
            aria-label="Preview video vertikal"
            className="max-h-[56vh] w-auto max-w-full rounded-lg bg-black shadow-2xl"
            style={{ aspectRatio: '9 / 16' }}
          />
          <CanvasSelectionOverlay
            selection={canvasSelection}
            onCommit={(commit) => onCanvasCommit?.(commit)}
          />
        </div>
      </div>

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

      <div className="flex items-center gap-3 border-t border-white/10 bg-surface px-3 py-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={playing ? 'Jeda preview' : 'Putar preview'}
          onClick={() => onPlayingChange(!playing)}
        >
          {playing ? (
            <Pause className="size-4" aria-hidden="true" />
          ) : (
            <Play className="size-4" aria-hidden="true" />
          )}
        </Button>
        <span className="min-w-20 text-xs tabular-nums text-muted">
          {formatTime(playhead)} / {formatTime(spec.timeline.duration)}
        </span>
        <input
          type="range"
          aria-label="Posisi playhead"
          min={0}
          max={spec.timeline.duration}
          step={1 / spec.output.frameRate}
          value={Math.min(playhead, spec.timeline.duration)}
          onChange={(event) => {
            const next = Number(event.currentTarget.value)
            const controller = controllerRef.current
            if (controller) {
              void controller.seek(next).catch(() => undefined)
            } else {
              callbacksRef.current.onPlayheadChange(next)
            }
          }}
          className="min-w-0 flex-1 accent-primary"
        />
      </div>

      <div hidden aria-hidden="true">
        {mediaEntries.map((entry) => {
          const testId = `asset-media-${entry.asset.id.replace(/^asset-/, '')}`
          if (entry.asset.mediaType === 'image') {
            return (
              // eslint-disable-next-line @next/next/no-img-element -- hidden decode source for canvas composition.
              <img
                key={entry.clipId}
                ref={(media) => registerMedia(entry.clipId, media, false)}
                src={entry.asset.url!}
                alt=""
                data-testid={testId}
                onLoad={redrawLoadedFrame}
              />
            )
          }
          return entry.trackType === 'video' ? (
            <video
              key={entry.clipId}
              ref={(media) => registerMedia(entry.clipId, media, entry.primary)}
              src={entry.asset.url!}
              preload="auto"
              playsInline
              muted
              tabIndex={-1}
              data-testid={testId}
              onLoadedData={redrawLoadedFrame}
            />
          ) : (
            <audio
              key={entry.clipId}
              ref={(media) => registerMedia(entry.clipId, media, false)}
              src={entry.asset.url!}
              preload="auto"
              muted={entry.muted}
              tabIndex={-1}
              data-testid={testId}
              onLoadedData={redrawLoadedFrame}
            />
          )
        })}
      </div>
    </section>
  )
}
