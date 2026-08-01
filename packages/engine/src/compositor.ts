import { captionTokensAt } from './captions'
import { coverCrop } from './geometry'
import type { VisualTransform } from './timeline'
import type { EditSpecV1, TranscriptWord } from './types'

export interface CompositeSpec extends Pick<EditSpecV1, 'output' | 'crop'> {
  captions: EditSpecV1['captions'] & { positionX?: number }
}

export interface TimelineVisualLayer {
  clipId: string
  media: CanvasImageSource & DrawableMedia
  order: number
  transform?: VisualTransform
  opacity: number
  primary: boolean
}

export interface DrawableMedia {
  readonly videoWidth?: number
  readonly videoHeight?: number
  readonly displayWidth?: number
  readonly displayHeight?: number
  readonly naturalWidth?: number
  readonly naturalHeight?: number
  readonly width?: number
  readonly height?: number
}

function dimensions(media: DrawableMedia): { width: number; height: number } {
  return {
    width: media.videoWidth ?? media.naturalWidth ?? media.displayWidth ?? media.width ?? 1,
    height: media.videoHeight ?? media.naturalHeight ?? media.displayHeight ?? media.height ?? 1,
  }
}

export function drawCompositeFrame(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  media: CanvasImageSource & DrawableMedia,
  spec: CompositeSpec,
  words: TranscriptWord[],
  time: number,
): void {
  drawTimelineComposite(context, [{
    clipId: 'primary',
    media,
    order: 0,
    opacity: 1,
    primary: true,
  }], spec, words, time)
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
    drawVisualLayer(context, layer, spec)
  }
  drawCaptions(context, spec, words, time)
  context.restore()
}

function drawVisualLayer(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  layer: TimelineVisualLayer,
  spec: CompositeSpec,
): void {
  const { media } = layer
  const { width, height } = dimensions(media)
  const outWidth = spec.output.width
  const outHeight = spec.output.height

  context.save()
  context.globalAlpha = Math.min(Math.max(layer.opacity, 0), 1)
  if (layer.primary) {
    const crop = coverCrop(width, height, spec)
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
  } else {
    const transform = layer.transform ?? { x: 0.2, y: 0.2, width: 0.6, height: 0.6 }
    const boxX = transform.x * outWidth
    const boxY = transform.y * outHeight
    const boxWidth = transform.width * outWidth
    const boxHeight = transform.height * outHeight
    const scale = Math.min(boxWidth / width, boxHeight / height)
    const destinationWidth = width * scale
    const destinationHeight = height * scale
    context.drawImage(
      media,
      0,
      0,
      width,
      height,
      boxX + (boxWidth - destinationWidth) / 2,
      boxY + (boxHeight - destinationHeight) / 2,
      destinationWidth,
      destinationHeight,
    )
  }
  context.restore()
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
      let x = Math.min(
        Math.max(outWidth * (spec.captions.positionX ?? 0.5) - total / 2, paddingX),
        outWidth - total - paddingX,
      )

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
