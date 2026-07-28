'use client'

import {
  drawCompositeFrame,
  type EditSpecV1,
  type TranscriptWord,
} from '@cheapclipper/engine'

export function browserExportSupport(): { supported: boolean; reason: string | null } {
  if (typeof window === 'undefined') return { supported: false, reason: 'Hanya tersedia di browser.' }
  if (!('VideoEncoder' in window)) {
    return {
      supported: false,
      reason: 'Browser ini belum mendukung WebCodecs VideoEncoder. Gunakan Chrome atau Edge terbaru.',
    }
  }
  if (!('AudioEncoder' in window)) {
    return {
      supported: false,
      reason: 'Browser ini belum mendukung WebCodecs AudioEncoder. Gunakan Chrome atau Edge terbaru.',
    }
  }
  return { supported: true, reason: null }
}

export async function exportClipMp4(args: {
  url: string
  spec: EditSpecV1
  words: TranscriptWord[]
  title: string
  onProgress?: (progress: number) => void
}): Promise<void> {
  const support = browserExportSupport()
  if (!support.supported) throw new Error(support.reason ?? 'Export tidak didukung')

  const response = await fetch(args.url)
  if (!response.ok) throw new Error('Segmen video tidak dapat diunduh. Refresh editor lalu coba lagi.')
  const blob = await response.blob()
  const {
    ALL_FORMATS,
    BlobSource,
    BufferTarget,
    Conversion,
    Input,
    Mp4OutputFormat,
    Output,
    QUALITY_HIGH,
  } = await import('mediabunny')

  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) })
  const target = new BufferTarget()
  const output = new Output({ format: new Mp4OutputFormat(), target })
  const canvas = document.createElement('canvas')
  canvas.width = args.spec.output.width
  canvas.height = args.spec.output.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas 2D tidak tersedia.')

  const conversion = await Conversion.init({
    input,
    output,
    tracks: 'primary',
    video: {
      codec: 'avc',
      bitrate: QUALITY_HIGH,
      frameRate: args.spec.output.frameRate,
      forceTranscode: true,
      processedWidth: args.spec.output.width,
      processedHeight: args.spec.output.height,
      process: (sample) => {
        const image = sample.toCanvasImageSource()
        drawCompositeFrame(
          context,
          image as CanvasImageSource & {
            displayWidth?: number
            displayHeight?: number
            width?: number
            height?: number
          },
          args.spec,
          args.words,
          sample.timestamp,
        )
        return canvas
      },
    },
    audio: { codec: 'aac', bitrate: 160_000 },
  })
  if (!conversion.isValid) {
    throw new Error('Codec video ini tidak dapat dikonversi oleh browser.')
  }
  conversion.onProgress = (progress) => args.onProgress?.(progress)
  await conversion.execute()
  if (!target.buffer) throw new Error('Encoder selesai tanpa menghasilkan file.')

  const outputBlob = new Blob([target.buffer], { type: 'video/mp4' })
  const href = URL.createObjectURL(outputBlob)
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.download = `${args.title.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'clip'}.mp4`
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(href), 30_000)
}
