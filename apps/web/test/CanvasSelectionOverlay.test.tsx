// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { CanvasSelectionOverlay } from '@/components/editor/CanvasSelectionOverlay'
import {
  moveTransform,
  resizeTransform,
} from '@/components/editor/canvasGeometry'

afterEach(cleanup)

test('drag converts CSS pixel delta into normalized position', () => {
  expect(moveTransform(
    { x: 0.2, y: 0.3, width: 0.4, height: 0.2 },
    { x: 54, y: -96 },
    { width: 540, height: 960 },
  )).toEqual({ x: 0.3, y: 0.2, width: 0.4, height: 0.2 })
})

test('resize preserves media aspect ratio and stays inside canvas', () => {
  const resized = resizeTransform(
    { x: 0.2, y: 0.2, width: 0.4, height: 0.1265625 },
    'se',
    { x: 108, y: 0 },
    { width: 1080, height: 1920 },
    16 / 9,
  )
  expect((resized.width * 1080) / (resized.height * 1920)).toBeCloseTo(16 / 9)
  expect(resized.x + resized.width).toBeLessThanOrEqual(1)
  expect(resized.y + resized.height).toBeLessThanOrEqual(1)
})

test('caption pointer drag commits global X and Y once', () => {
  const onCommit = vi.fn()
  const pointerAt = (clientX: number, clientY: number) => ({
    pointerId: 1,
    clientX,
    clientY,
  })
  render(
    <CanvasSelectionOverlay
      selection={{ kind: 'caption', positionX: 0.5, positionY: 0.5 }}
      bounds={{ width: 400, height: 800 }}
      onCommit={onCommit}
    />,
  )

  fireEvent.pointerDown(screen.getByLabelText('Pindahkan caption'), pointerAt(100, 100))
  fireEvent.pointerMove(window, pointerAt(140, 160))
  expect(onCommit).not.toHaveBeenCalled()
  fireEvent.pointerUp(window, pointerAt(140, 160))

  expect(onCommit).toHaveBeenCalledTimes(1)
  expect(onCommit).toHaveBeenCalledWith({
    kind: 'caption',
    positionX: 0.6,
    positionY: 0.575,
  })
})

test('visual selection has four touch-sized resize handles', () => {
  render(
    <CanvasSelectionOverlay
      selection={{
        kind: 'asset',
        trackId: 'track-image',
        clipId: 'clip-image',
        transform: { x: 0.2, y: 0.2, width: 0.6, height: 0.4 },
        aspectRatio: 1.5,
      }}
      bounds={{ width: 400, height: 800 }}
      onCommit={vi.fn()}
    />,
  )

  for (const corner of ['kiri atas', 'kanan atas', 'kiri bawah', 'kanan bawah']) {
    expect(screen.getByLabelText(`Resize dari ${corner}`)).toHaveClass('size-11')
  }
})
