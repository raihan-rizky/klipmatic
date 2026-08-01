'use client'

import { useEffect, useMemo, useRef } from 'react'
import { Pause, Play } from 'lucide-react'
import {
  drawTimelineComposite,
  mapWordsToTimeline,
  type ActiveTimelineItem,
  type EditSpecV3,
  type TranscriptWord,
  type VisualTransform,
} from '@cheapclipper/engine'
import { Button } from '@/components/ui/button'
import type { ResolvedMediaAsset } from '@/lib/clipTypes'
import {
  createTimelinePlaybackController,
  type TimelinePlaybackController,
} from './timelinePlayback'
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

  useEffect(() => {
    function drawFrame(active: ActiveTimelineItem[], outputTime: number): void {
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
      drawTimelineComposite(context, layers, spec, timelineWords, outputTime)
    }

    const controller = createTimelinePlaybackController({
      spec,
      mediaForClip: (item) => {
        const media = mediaPoolRef.current.get(item.clipId)
        return media instanceof HTMLMediaElement ? media : null
      },
      onTime: (outputTime) => {
        reportedTimeRef.current = outputTime
        callbacksRef.current.onPlayheadChange(outputTime)
      },
      onFrame: (active) =>
        drawFrame(active, active[0]?.outputTime ?? reportedTimeRef.current),
      onStall: (message) => {
        callbacksRef.current.onPlayingChange(false)
        callbacksRef.current.onStall(message)
      },
    })
    controllerRef.current = controller
    void controller.seek(playhead)

    return () => {
      controller.dispose()
      controllerRef.current = null
    }
  }, [spec, timelineWords])

  useEffect(() => {
    const controller = controllerRef.current
    if (!controller) return
    if (playing) {
      void controller.play().catch(() => undefined)
    } else {
      controller.pause()
    }
  }, [playing])

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
    void controllerRef.current?.seek(playhead).catch(() => undefined)
  }

  return (
    <section className="flex min-h-0 flex-col bg-black" aria-label="Video preview">
      <div className="flex min-h-0 flex-1 items-center justify-center p-3 sm:p-5">
        <div
          className="relative inline-flex max-h-[56vh] max-w-full"
          onDragOver={(event) => {
            if (event.dataTransfer.types.includes('application/x-cheapclipper-asset')) {
              event.preventDefault()
              event.dataTransfer.dropEffect = 'copy'
            }
          }}
          onDrop={(event) => {
            const raw = event.dataTransfer.getData('application/x-cheapclipper-asset')
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
              // Ignore drag payloads from outside Cheapclipper.
            }
          }}
        >
          <canvas
            ref={canvasRef}
            width={spec.output.width}
            height={spec.output.height}
            aria-label="Preview video vertikal"
            className="max-h-[56vh] w-auto max-w-full rounded-xl bg-black shadow-2xl"
            style={{ aspectRatio: '9 / 16' }}
          />
          <CanvasSelectionOverlay
            selection={canvasSelection}
            onCommit={(commit) => onCanvasCommit?.(commit)}
          />
        </div>
      </div>

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
          onChange={(event) =>
            onPlayheadChange(Number(event.currentTarget.value))
          }
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
