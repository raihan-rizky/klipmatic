'use client'

import {
  buildFrameSchedule,
  drawTimelineComposite,
  mapOutputTime,
  mapWordsToTimeline,
  type DrawableMedia,
  type EditSpecV3,
  type TranscriptWord,
} from '@cheapclipper/engine'
import type { ResolvedMediaAsset } from './clipTypes'

type ExportArgs = {
  assets: ResolvedMediaAsset[]
  spec: EditSpecV3
  words: TranscriptWord[]
  title: string
  onProgress?: (progress: number) => void
  allowEmptyVisual?: boolean
}

export interface ExportAssetSource {
  frameAt(
    sourceTime: number,
  ): Promise<(CanvasImageSource & DrawableMedia) | null>
  readAudio(start: number, end: number): AsyncIterable<{
    buffer: AudioBuffer
    timestamp: number
    duration: number
  }>
  close?: () => void
}

export interface TimelineExportRuntime {
  open(asset: ResolvedMediaAsset): Promise<ExportAssetSource>
  createOutput(spec: EditSpecV3): Promise<{
    context: CanvasRenderingContext2D
    addVideoFrame(timestamp: number, duration: number): Promise<void>
    addAudioBuffer(buffer: AudioBuffer): Promise<void>
    finalize(): Promise<ArrayBuffer>
  }>
  createOfflineAudioContext(
    channels: number,
    length: number,
    sampleRate: number,
  ): OfflineAudioContext
  download(buffer: ArrayBuffer, filename: string): void
}

export function browserExportSupport(spec?: EditSpecV3): {
  supported: boolean
  reason: string | null
} {
  if (typeof window === 'undefined') {
    return { supported: false, reason: 'Hanya tersedia di browser.' }
  }
  if (!('VideoEncoder' in window)) {
    return {
      supported: false,
      reason:
        'Browser ini belum mendukung WebCodecs VideoEncoder. Gunakan Chrome atau Edge terbaru.',
    }
  }
  const needsAudio =
    !spec ||
    spec.timeline.tracks.some(
      (track) =>
        track.type === 'audio' &&
        !track.hidden &&
        track.clips.some((clip) => !clip.muted),
    )
  if (needsAudio && !('AudioEncoder' in window)) {
    return {
      supported: false,
      reason:
        'Browser ini belum mendukung WebCodecs AudioEncoder. Gunakan Chrome atau Edge terbaru.',
    }
  }
  return { supported: true, reason: null }
}

function safeFilename(title: string): string {
  const slug = title
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '')
  return `${slug || 'clip'}.mp4`
}

export function createTimelineExporter(runtime: TimelineExportRuntime) {
  return async function exportTimeline({
    assets,
    spec,
    words,
    title,
    onProgress,
    allowEmptyVisual = false,
  }: ExportArgs): Promise<void> {
    const visibleVideoTracks = spec.timeline.tracks.filter(
      (track) =>
        track.type === 'video' && !track.hidden && track.clips.length > 0,
    )
    if (visibleVideoTracks.length === 0 && !allowEmptyVisual) {
      throw new Error(
        'Aktifkan video layer atau konfirmasi ekspor layar hitam.',
      )
    }

    const assetById = new Map(assets.map((asset) => [asset.id, asset]))
    const sources = new Map<string, ExportAssetSource>()
    const sourceFor = async (assetId: string): Promise<ExportAssetSource> => {
      const existing = sources.get(assetId)
      if (existing) return existing
      const asset = assetById.get(assetId)
      if (!asset || asset.status !== 'ready' || !asset.url) {
        throw new Error('Ada media timeline yang belum siap atau sudah kedaluwarsa.')
      }
      const source = await runtime.open(asset)
      sources.set(assetId, source)
      return source
    }
    try {
      const output = await runtime.createOutput(spec)
      const schedule = buildFrameSchedule(spec)
      const mappedWords = mapWordsToTimeline(words, spec)

      for (const frame of schedule) {
        const layers = []
        const activeVideo = mapOutputTime(spec, frame.outputTime).filter(
          (item) => item.trackType === 'video',
        )
        for (const item of activeVideo) {
          const media = await (await sourceFor(item.assetId)).frameAt(item.sourceTime)
          if (media) layers.push({
            clipId: item.clipId,
            media,
            order: item.order,
            transform: item.transform,
            opacity: 1,
            primary:
              item.trackType === 'video' &&
              item.trackId === spec.timeline.primaryTrackId,
          })
        }
        drawTimelineComposite(
          output.context,
          layers,
          spec,
          mappedWords,
          frame.outputTime,
        )
        await output.addVideoFrame(frame.outputTime, frame.duration)
        onProgress?.(((frame.index + 1) / Math.max(schedule.length, 1)) * 0.85)
      }

      const audioClips = spec.timeline.tracks
        .filter((track) => track.type === 'audio' && !track.hidden)
        .flatMap((track) => track.clips)
        .filter((clip) => !clip.muted)
      if (audioClips.length > 0) {
        const sampleRate = 48_000
        const offline = runtime.createOfflineAudioContext(
          2,
          Math.ceil(spec.timeline.duration * sampleRate),
          sampleRate,
        )
        for (let clipIndex = 0; clipIndex < audioClips.length; clipIndex += 1) {
          const clip = audioClips[clipIndex]!
          const source = await sourceFor(clip.assetId)
          for await (const wrapped of source.readAudio(
            clip.sourceIn,
            clip.sourceOut,
          )) {
            const intersectionStart = Math.max(
              clip.sourceIn,
              wrapped.timestamp,
            )
            const intersectionEnd = Math.min(
              clip.sourceOut,
              wrapped.timestamp + wrapped.duration,
            )
            if (intersectionEnd <= intersectionStart) continue

            const source = offline.createBufferSource()
            source.buffer = wrapped.buffer
            source.connect(offline.destination)
            source.start(
              clip.timelineStart + intersectionStart - clip.sourceIn,
              intersectionStart - wrapped.timestamp,
              intersectionEnd - intersectionStart,
            )
          }
          onProgress?.(
            0.85 + ((clipIndex + 1) / Math.max(audioClips.length, 1)) * 0.1,
          )
        }
        await output.addAudioBuffer(await offline.startRendering())
      }

      const buffer = await output.finalize()
      onProgress?.(1)
      runtime.download(buffer, safeFilename(title))
    } finally {
      for (const source of sources.values()) source.close?.()
    }
  }
}

function createBrowserRuntime(): TimelineExportRuntime {
  const library = import('mediabunny')

  return {
    async open(asset) {
      if (!asset.url) throw new Error(`${asset.name} belum siap diekspor.`)
      const response = await fetch(asset.url)
      if (!response.ok) {
        throw new Error(
          'Segmen video tidak dapat diunduh. Refresh editor lalu coba lagi.',
        )
      }
      const blob = await response.blob()
      if (asset.mediaType === 'image') {
        if (typeof createImageBitmap !== 'function') {
          throw new Error('Browser ini belum bisa decode gambar untuk ekspor.')
        }
        const bitmap = await createImageBitmap(blob)
        return {
          frameAt: async () => bitmap,
          async *readAudio() {},
          close: () => bitmap.close(),
        }
      }
      const {
        ALL_FORMATS,
        AudioBufferSink,
        BlobSource,
        Input,
        VideoSampleSink,
      } = await library
      const input = new Input({
        formats: ALL_FORMATS,
        source: new BlobSource(blob),
      })
      const videoTrack = await input.getPrimaryVideoTrack()
      const audioTrack = await input.getPrimaryAudioTrack()
      const videoSink = videoTrack ? new VideoSampleSink(videoTrack) : null
      const audioSink = audioTrack ? new AudioBufferSink(audioTrack) : null

      return {
        async frameAt(sourceTime) {
          const sample = await videoSink?.getSample(sourceTime)
          if (!sample) return null
          const rotated = sample.rotation % 180 !== 0
          const width = rotated
            ? sample.squarePixelHeight
            : sample.squarePixelWidth
          const height = rotated
            ? sample.squarePixelWidth
            : sample.squarePixelHeight
          const canvas = new OffscreenCanvas(width, height)
          const context = canvas.getContext('2d')
          if (!context) {
            sample.close()
            throw new Error('Canvas frame video tidak tersedia.')
          }
          sample.draw(context, 0, 0, width, height)
          sample.close()
          return canvas
        },
        async *readAudio(start, end) {
          if (!audioSink) return
          yield* audioSink.buffers(start, end)
        },
        close: () => input.dispose(),
      }
    },
    async createOutput(spec) {
      const {
        AudioBufferSource,
        BufferTarget,
        CanvasSource,
        Mp4OutputFormat,
        Output,
        QUALITY_HIGH,
      } = await library
      const canvas = document.createElement('canvas')
      canvas.width = spec.output.width
      canvas.height = spec.output.height
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Canvas 2D tidak tersedia.')

      const target = new BufferTarget()
      const output = new Output({
        format: new Mp4OutputFormat(),
        target,
      })
      const videoSource = new CanvasSource(canvas, {
        codec: 'avc',
        bitrate: QUALITY_HIGH,
        keyFrameInterval: 2,
      })
      output.addVideoTrack(videoSource)

      const hasAudio = spec.timeline.tracks.some(
        (track) =>
          track.type === 'audio' &&
          !track.hidden &&
          track.clips.some((clip) => !clip.muted),
      )
      const audioSource = hasAudio
        ? new AudioBufferSource({ codec: 'aac', bitrate: 160_000 })
        : null
      if (audioSource) output.addAudioTrack(audioSource)
      await output.start()

      return {
        context,
        addVideoFrame: (timestamp, duration) =>
          videoSource.add(timestamp, duration),
        addAudioBuffer: (buffer) =>
          audioSource ? audioSource.add(buffer) : Promise.resolve(),
        async finalize() {
          await output.finalize()
          if (!target.buffer) {
            throw new Error('Encoder selesai tanpa menghasilkan file.')
          }
          return target.buffer
        },
      }
    },
    createOfflineAudioContext(channels, length, sampleRate) {
      return new OfflineAudioContext(channels, length, sampleRate)
    },
    download(buffer, filename) {
      const blob = new Blob([buffer], { type: 'video/mp4' })
      const href = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = href
      anchor.download = filename
      anchor.click()
      window.setTimeout(() => URL.revokeObjectURL(href), 30_000)
    },
  }
}

export async function exportClipMp4(args: ExportArgs): Promise<void> {
  const support = browserExportSupport(args.spec)
  if (!support.supported) {
    throw new Error(support.reason ?? 'Export tidak didukung')
  }
  await createTimelineExporter(createBrowserRuntime())(args)
}
