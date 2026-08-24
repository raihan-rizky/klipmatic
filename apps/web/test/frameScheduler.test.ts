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
    get now() {
      return time
    },
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
      now: () => clock.now,
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
      now: () => clock.now,
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
      now: () => clock.now,
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
