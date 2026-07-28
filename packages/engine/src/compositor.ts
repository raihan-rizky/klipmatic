import { captionTokensAt } from './captions'
import { coverCrop } from './geometry'
import type { EditSpecV1, TranscriptWord } from './types'

export type CompositeSpec = Pick<EditSpecV1, 'output' | 'crop' | 'captions'>

export interface TimelineVisualLayer {
  media: CanvasImageSource & DrawableMedia
  order: number
}

export interface DrawableMedia {
  readonly videoWidth?: number
  readonly videoHeight?: number
  readonly displayWidth?: number
  readonly displayHeight?: number
  readonly width?: number
  readonly height?: number
}

function dimensions(media: DrawableMedia): { width: number; height: number } {
  return {
    width: media.videoWidth ?? media.displayWidth ?? media.width ?? 1,
    height: media.videoHeight ?? media.displayHeight ?? media.height ?? 1,
  }
}

export function drawCompositeFrame(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  media: CanvasImageSource & DrawableMedia,
  spec: CompositeSpec,
  words: TranscriptWord[],
  time: number,
): void {
  drawTimelineComposite(context, [{ media, order: 0 }], spec, words, time)
}

export function drawTimelineComposite(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  layers: TimelineVisualLayer[],
  spec: CompositeSpec,
  words: TranscriptWord[],
  time: number,
): void {
  const outWidth = spec.output.width
  const outHeight = spec.output.height

  context.save()
  context.fillStyle = '#000000'
  context.fillRect(0, 0, outWidth, outHeight)
  for (const layer of [...layers].sort((left, right) => left.order - right.order)) {
    drawVisualLayer(context, layer.media, spec)
  }
  drawCaptions(context, spec, words, time)
  context.restore()
}

function drawVisualLayer(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  media: CanvasImageSource & DrawableMedia,
  spec: CompositeSpec,
): void {
  const { width, height } = dimensions(media)
  const crop = coverCrop(width, height, spec)
  const outWidth = spec.output.width
  const outHeight = spec.output.height

  context.drawImage(
    media,
    crop.sx,
    crop.sy,
    crop.sw,
    crop.sh,
    0,
    0,
    outWidth,
    outHeight,
  )
}

function drawCaptions(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  spec: CompositeSpec,
  words: TranscriptWord[],
  time: number,
): void {
  const outWidth = spec.output.width
  const outHeight = spec.output.height
  if (spec.captions.enabled) {
    const tokens = captionTokensAt(words, time, spec.captions.maxWordsPerLine)
    if (tokens.length > 0) {
      context.font = `800 ${spec.captions.fontSize}px ${spec.captions.fontFamily}`
      context.textBaseline = 'middle'
      context.textAlign = 'left'
      const gap = spec.captions.fontSize * 0.24
      const widths = tokens.map((token) => context.measureText(token.text).width)
      const total = widths.reduce((sum, value) => sum + value, 0) + gap * (tokens.length - 1)
      const paddingX = spec.captions.fontSize * 0.35
      const paddingY = spec.captions.fontSize * 0.28
      const y = outHeight * spec.captions.positionY
      let x = (outWidth - total) / 2

      context.fillStyle = spec.captions.backgroundColor
      context.fillRect(
        x - paddingX,
        y - spec.captions.fontSize / 2 - paddingY,
        total + paddingX * 2,
        spec.captions.fontSize + paddingY * 2,
      )
      for (let index = 0; index < tokens.length; index += 1) {
        const token = tokens[index]!
        context.fillStyle = token.active
          ? spec.captions.activeColor
          : spec.captions.textColor
        context.fillText(token.text, x, y)
        x += widths[index]! + gap
      }
    }
  }
}
