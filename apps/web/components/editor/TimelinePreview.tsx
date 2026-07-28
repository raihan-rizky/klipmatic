'use client'

import { useEffect, useMemo, useRef } from 'react'
import { Pause, Play } from 'lucide-react'
import {
  drawTimelineComposite,
  mapWordsToTimeline,
  type ActiveTimelineItem,
  type EditSpecV2,
  type TranscriptWord,
} from '@cheapclipper/engine'
import { Button } from '@/components/ui/button'
import {
  createTimelinePlaybackController,
  type TimelinePlaybackController,
} from './timelinePlayback'

type TimelinePreviewProps = {
  spec: EditSpecV2
  words: TranscriptWord[]
  mediaUrl: string
  playhead: number
  playing: boolean
  onPlayheadChange: (outputTime: number) => void
  onPlayingChange: (playing: boolean) => void
  onStall: (message: string) => void
}

function formatTime(value: number): string {
  const totalSeconds = Math.max(0, Math.floor(value))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

export function TimelinePreview({
  spec,
  words,
  mediaUrl,
  playhead,
  playing,
  onPlayheadChange,
  onPlayingChange,
  onStall,
}: TimelinePreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const mediaPoolRef = useRef(new Map<string, HTMLMediaElement>())
  const controllerRef = useRef<TimelinePlaybackController | null>(null)
  const reportedTimeRef = useRef(playhead)
  const callbacksRef = useRef({
    onPlayheadChange,
    onPlayingChange,
    onStall,
  })
  callbacksRef.current = { onPlayheadChange, onPlayingChange, onStall }

  const mediaEntries = useMemo(
    () =>
      spec.timeline.tracks.flatMap((track) =>
        track.type === 'caption'
          ? []
          : track.clips.map((clip) => ({
              clipId: clip.id,
              trackType: track.type,
            })),
      ),
    [spec],
  )
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
          if (
            !(media instanceof HTMLVideoElement) ||
            media.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
            media.videoWidth === 0
          ) return []
          return [{ media, order: item.order }]
        })
      if (layers.length === 0) return

      const context = canvas.getContext('2d')
      if (!context) return
      drawTimelineComposite(context, layers, spec, timelineWords, outputTime)
    }

    const controller = createTimelinePlaybackController({
      spec,
      mediaForClip: (item) => mediaPoolRef.current.get(item.clipId) ?? null,
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
        media.pause()
        media.removeAttribute('src')
        media.load()
      }
      mediaPoolRef.current.clear()
    },
    [],
  )

  function registerMedia(clipId: string, media: HTMLMediaElement | null): void {
    if (media) {
      mediaPoolRef.current.set(clipId, media)
    } else {
      mediaPoolRef.current.delete(clipId)
    }
  }

  function redrawLoadedFrame(): void {
    void controllerRef.current?.seek(playhead).catch(() => undefined)
  }

  return (
    <section className="flex min-h-0 flex-col bg-black" aria-label="Video preview">
      <div className="flex min-h-0 flex-1 items-center justify-center p-3 sm:p-5">
        <canvas
          ref={canvasRef}
          width={spec.output.width}
          height={spec.output.height}
          aria-label="Preview video vertikal"
          className="max-h-[56vh] w-auto max-w-full rounded-xl bg-black shadow-2xl"
          style={{ aspectRatio: '9 / 16' }}
        />
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
        {mediaEntries.map((entry) =>
          entry.trackType === 'video' ? (
            <video
              key={entry.clipId}
              ref={(media) => registerMedia(entry.clipId, media)}
              src={mediaUrl}
              preload="auto"
              playsInline
              muted
              tabIndex={-1}
              onLoadedData={redrawLoadedFrame}
            />
          ) : (
            <audio
              key={entry.clipId}
              ref={(media) => registerMedia(entry.clipId, media)}
              src={mediaUrl}
              preload="auto"
              tabIndex={-1}
              onLoadedData={redrawLoadedFrame}
            />
          ),
        )}
      </div>
    </section>
  )
}
