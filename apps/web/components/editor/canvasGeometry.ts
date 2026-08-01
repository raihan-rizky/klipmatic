import type { VisualTransform } from '@cheapclipper/engine'

type Point = { x: number; y: number }
type Bounds = { width: number; height: number }
export type ResizeCorner = 'nw' | 'ne' | 'sw' | 'se'

const round = (value: number) => Math.round(value * 1_000_000) / 1_000_000
const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), Math.max(min, max))

export function moveTransform(
  start: VisualTransform,
  delta: Point,
  bounds: Bounds,
): VisualTransform {
  const width = Math.max(bounds.width, 1)
  const height = Math.max(bounds.height, 1)
  return {
    ...start,
    x: round(clamp(start.x + delta.x / width, 0, 1 - start.width)),
    y: round(clamp(start.y + delta.y / height, 0, 1 - start.height)),
  }
}

export function resizeTransform(
  start: VisualTransform,
  corner: ResizeCorner,
  delta: Point,
  bounds: Bounds,
  aspectRatio: number,
): VisualTransform {
  const canvasWidth = Math.max(bounds.width, 1)
  const canvasHeight = Math.max(bounds.height, 1)
  const ratio = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1
  const east = corner.endsWith('e')
  const south = corner.startsWith('s')
  const horizontal = (east ? 1 : -1) * delta.x
  const verticalAsWidth = (south ? 1 : -1) * delta.y * ratio
  const startWidth = start.width * canvasWidth
  const candidateWidth = startWidth + (
    Math.abs(horizontal) >= Math.abs(verticalAsWidth)
      ? horizontal
      : verticalAsWidth
  )

  const anchorX = (east ? start.x : start.x + start.width) * canvasWidth
  const anchorY = (south ? start.y : start.y + start.height) * canvasHeight
  const horizontalRoom = east ? canvasWidth - anchorX : anchorX
  const verticalRoom = south ? canvasHeight - anchorY : anchorY
  const minimumWidth = Math.min(Math.max(44, 44 * ratio), horizontalRoom, verticalRoom * ratio)
  const maximumWidth = Math.max(minimumWidth, Math.min(horizontalRoom, verticalRoom * ratio))
  const width = clamp(candidateWidth, minimumWidth, maximumWidth)
  const height = width / ratio
  const x = east ? anchorX : anchorX - width
  const y = south ? anchorY : anchorY - height

  return {
    x: round(x / canvasWidth),
    y: round(y / canvasHeight),
    width: round(width / canvasWidth),
    height: round(height / canvasHeight),
  }
}
