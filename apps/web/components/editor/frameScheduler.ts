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
