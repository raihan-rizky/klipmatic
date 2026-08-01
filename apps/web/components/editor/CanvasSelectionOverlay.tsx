'use client'

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { VisualTransform } from '@cheapclipper/engine'
import { moveTransform, resizeTransform, type ResizeCorner } from './canvasGeometry'

type Bounds = { width: number; height: number }

export type CanvasSelection =
  | { kind: 'caption'; positionX: number; positionY: number }
  | {
      kind: 'asset'
      trackId: string
      clipId: string
      transform: VisualTransform
      aspectRatio: number
    }

export type CanvasSelectionCommit =
  | { kind: 'caption'; positionX: number; positionY: number }
  | {
      kind: 'asset'
      trackId: string
      clipId: string
      transform: VisualTransform
    }

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max)
const round = (value: number) => Math.round(value * 1_000_000) / 1_000_000

export function CanvasSelectionOverlay({
  selection,
  bounds,
  onCommit,
}: {
  selection: CanvasSelection | null
  bounds?: Bounds
  onCommit: (commit: CanvasSelectionCommit) => void
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const cleanupGesture = useRef<(() => void) | null>(null)
  const [display, setDisplay] = useState(selection)

  useEffect(() => setDisplay(selection), [selection])
  useEffect(() => () => cleanupGesture.current?.(), [])

  function beginGesture(
    event: ReactPointerEvent<HTMLElement>,
    mode: 'move' | ResizeCorner,
  ) {
    if (!display) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    cleanupGesture.current?.()
    const pointerId = event.pointerId
    const startPoint = { x: event.clientX, y: event.clientY }
    const startSelection = display
    const rect = rootRef.current?.getBoundingClientRect()
    const gestureBounds = bounds ?? {
      width: rect?.width || 1,
      height: rect?.height || 1,
    }
    let current = startSelection

    const update = (pointer: PointerEvent) => {
      if (pointer.pointerId !== pointerId) return
      const delta = {
        x: pointer.clientX - startPoint.x,
        y: pointer.clientY - startPoint.y,
      }
      if (startSelection.kind === 'caption') {
        current = {
          kind: 'caption',
          positionX: round(clamp(
            startSelection.positionX + delta.x / gestureBounds.width,
            0.05,
            0.95,
          )),
          positionY: round(clamp(
            startSelection.positionY + delta.y / gestureBounds.height,
            0.05,
            0.95,
          )),
        }
      } else {
        current = {
          ...startSelection,
          transform: mode === 'move'
            ? moveTransform(startSelection.transform, delta, gestureBounds)
            : resizeTransform(
                startSelection.transform,
                mode,
                delta,
                gestureBounds,
                startSelection.aspectRatio,
              ),
        }
      }
      setDisplay(current)
    }
    const cleanup = () => {
      window.removeEventListener('pointermove', update)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', cancel)
      cleanupGesture.current = null
    }
    const commitCurrent = () => {
      if (current.kind === 'caption') onCommit(current)
      else onCommit({
        kind: 'asset',
        trackId: current.trackId,
        clipId: current.clipId,
        transform: current.transform,
      })
    }
    const finish = (pointer: PointerEvent) => {
      if (pointer.pointerId !== pointerId) return
      update(pointer)
      cleanup()
      commitCurrent()
    }
    const cancel = (pointer: PointerEvent) => {
      if (pointer.pointerId !== pointerId) return
      cleanup()
      commitCurrent()
    }
    cleanupGesture.current = cleanup
    window.addEventListener('pointermove', update)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', cancel)
  }

  if (!display) return null

  if (display.kind === 'caption') {
    return (
      <div ref={rootRef} className="pointer-events-none absolute inset-0">
        <button
          type="button"
          aria-label="Pindahkan caption"
          className="pointer-events-auto absolute h-20 w-4/5 -translate-x-1/2 -translate-y-1/2 cursor-move rounded-xl border-2 border-dashed border-primary bg-primary/10 touch-none"
          style={{ left: `${display.positionX * 100}%`, top: `${display.positionY * 100}%` }}
          onPointerDown={(event) => beginGesture(event, 'move')}
        />
      </div>
    )
  }

  const corners = [
    ['nw', 'kiri atas', '-left-5 -top-5 cursor-nwse-resize'],
    ['ne', 'kanan atas', '-right-5 -top-5 cursor-nesw-resize'],
    ['sw', 'kiri bawah', '-bottom-5 -left-5 cursor-nesw-resize'],
    ['se', 'kanan bawah', '-bottom-5 -right-5 cursor-nwse-resize'],
  ] as const

  return (
    <div ref={rootRef} className="pointer-events-none absolute inset-0">
      <div
        className="pointer-events-auto absolute cursor-move border-2 border-primary bg-primary/5 touch-none"
        style={{
          left: `${display.transform.x * 100}%`,
          top: `${display.transform.y * 100}%`,
          width: `${display.transform.width * 100}%`,
          height: `${display.transform.height * 100}%`,
        }}
        aria-label="Pindahkan media"
        onPointerDown={(event) => beginGesture(event, 'move')}
      >
        {corners.map(([corner, label, position]) => (
          <button
            key={corner}
            type="button"
            aria-label={`Resize dari ${label}`}
            className={`absolute size-11 rounded-full border-2 border-white bg-primary shadow-lg touch-none ${position}`}
            onPointerDown={(event) => beginGesture(event, corner)}
          />
        ))}
      </div>
    </div>
  )
}
