import {
  mapOutputTime,
  type ActiveTimelineItem,
  type EditSpecV3,
  type TimelineContext,
} from '@klipmatic/engine'

export interface PlaybackMedia {
  currentTime: number
  readonly paused: boolean
  muted: boolean
  play(): Promise<void>
  pause(): void
}

export interface TimelinePlaybackController {
  play(): Promise<void>
  pause(): void
  seek(outputTime: number): Promise<void>
  dispose(): void
}

type PlaybackOptions = {
  spec: EditSpecV3
  context?: TimelineContext
  mediaForClip: (item: ActiveTimelineItem) => PlaybackMedia | null
  onTime: (outputTime: number) => void
  onFrame: (active: ActiveTimelineItem[]) => void
  onStall: (message: string) => void
  now?: () => number
  requestFrame?: (callback: FrameRequestCallback) => number
  cancelFrame?: (handle: number) => void
}

const DRIFT_TOLERANCE_SECONDS = 0.08

function defaultRequestFrame(callback: FrameRequestCallback): number {
  if (typeof requestAnimationFrame === 'function') {
    return requestAnimationFrame(callback)
  }
  return setTimeout(() => callback(performance.now()), 16) as unknown as number
}

function defaultCancelFrame(handle: number): void {
  if (typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(handle)
    return
  }
  clearTimeout(handle)
}

export function createTimelinePlaybackController({
  spec,
  context,
  mediaForClip,
  onTime,
  onFrame,
  onStall,
  now = () => performance.now(),
  requestFrame = defaultRequestFrame,
  cancelFrame = defaultCancelFrame,
}: PlaybackOptions): TimelinePlaybackController {
  const knownMedia = new Set<PlaybackMedia>()
  let outputTime = 0
  let startedAt = 0
  let startedOutputTime = 0
  let frameHandle: number | null = null
  let playing = false
  let disposed = false
  let syncing = false

  function stopMedia(): void {
    for (const media of knownMedia) {
      media.pause()
    }
  }

  function stopTransport(): void {
    playing = false
    if (frameHandle !== null) {
      cancelFrame(frameHandle)
      frameHandle = null
    }
    stopMedia()
  }

  async function sync(time: number, shouldPlay: boolean): Promise<void> {
    const active = mapOutputTime(spec, time, context)
    const activeMedia = new Map<PlaybackMedia, ActiveTimelineItem>()

    for (const item of active) {
      if (item.trackType === 'caption') continue
      const media = mediaForClip(item)
      if (!media) continue
      knownMedia.add(media)
      activeMedia.set(media, item)
    }

    for (const media of knownMedia) {
      const item = activeMedia.get(media)
      if (!item) {
        media.muted = true
        media.pause()
        continue
      }

      media.muted = item.trackType !== 'audio' || item.muted
      if (item.trackType === 'audio' && item.muted) media.pause()
      if (Math.abs(media.currentTime - item.sourceTime) > DRIFT_TOLERANCE_SECONDS) {
        media.currentTime = item.sourceTime
      }
    }

    if (shouldPlay) {
      await Promise.all(
        [...activeMedia.entries()].map(([media, item]) =>
          item.trackType === 'audio' && item.muted
            ? Promise.resolve()
            : media.paused
              ? media.play()
              : Promise.resolve(),
        ),
      )
    }

    outputTime = time
    onTime(time)
    onFrame(active)
  }

  function handleStall(error: unknown): never {
    stopTransport()
    onStall('Video berhenti merespons.')
    throw error
  }

  function scheduleFrame(): void {
    if (!playing || disposed || frameHandle !== null) return
    frameHandle = requestFrame(() => {
      frameHandle = null
      if (!playing || disposed || syncing) {
        scheduleFrame()
        return
      }

      syncing = true
      const nextTime = Math.min(
        startedOutputTime + (now() - startedAt) / 1000,
        spec.timeline.duration,
      )
      void sync(nextTime, true)
        .then(() => {
          if (nextTime >= spec.timeline.duration) stopTransport()
        })
        .catch((error: unknown) => {
          try {
            handleStall(error)
          } catch {
            // The animation loop reports stalls through onStall.
          }
        })
        .finally(() => {
          syncing = false
          scheduleFrame()
        })
    })
  }

  return {
    async play() {
      if (disposed || playing) return
      try {
        await sync(outputTime, true)
      } catch (error) {
        handleStall(error)
      }
      playing = true
      startedAt = now()
      startedOutputTime = outputTime
      scheduleFrame()
    },
    pause() {
      stopTransport()
    },
    async seek(nextOutputTime) {
      if (disposed) return
      const clamped = Math.max(
        0,
        Math.min(nextOutputTime, spec.timeline.duration),
      )
      if (playing) {
        startedAt = now()
        startedOutputTime = clamped
      }
      try {
        await sync(clamped, playing)
      } catch (error) {
        handleStall(error)
      }
    },
    dispose() {
      disposed = true
      stopTransport()
      knownMedia.clear()
    },
  }
}
