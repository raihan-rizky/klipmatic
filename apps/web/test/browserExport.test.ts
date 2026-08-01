import { expect, test, vi } from 'vitest'
import { applyTimelineCommand, type EditSpecV3, type TranscriptWord } from '@cheapclipper/engine'
import {
  createTimelineExporter,
  type TimelineExportRuntime,
} from '@/lib/browserExport'
import { editorContext, makeEditorSpec } from './editorFixtures'
import type { ResolvedMediaAsset } from '@/lib/clipTypes'

const words: TranscriptWord[] = []

function makeTwentySecondSilentSpec() {
  const source = makeEditorSpec()
  const trimmed = applyTimelineCommand(
    source,
    {
      type: 'trimClip',
      trackId: source.timeline.primaryTrackId,
      clipId: source.timeline.tracks[0]!.clips[0]!.id,
      edge: 'end',
      sourceTime: 20,
    },
    editorContext,
  )
  return {
    ...trimmed,
    timeline: {
      ...trimmed.timeline,
      tracks: trimmed.timeline.tracks.map((track) =>
        track.type === 'audio' ? { ...track, hidden: true } : track,
      ),
    },
  }
}

function fakeRuntime(
  audioChunks: Array<{
    buffer: AudioBuffer
    timestamp: number
    duration: number
  }> = [],
) {
  const addVideoFrame = vi.fn<
    (timestamp: number, duration: number) => Promise<void>
  >(async () => undefined)
  const addAudioBuffer = vi.fn(async () => undefined)
  const readAudioByAsset = new Map<string, ReturnType<typeof vi.fn>>()
  const finalize = vi.fn(async () => new ArrayBuffer(3))
  const renderedAudio = {} as AudioBuffer
  const audioNode = {
    buffer: null as AudioBuffer | null,
    connect: vi.fn(),
    start: vi.fn(),
  }
  const offline = {
    destination: {},
    createBufferSource: vi.fn(() => audioNode),
    startRendering: vi.fn(async () => renderedAudio),
  } as unknown as OfflineAudioContext
  const context = {
    save: vi.fn(),
    restore: vi.fn(),
    fillRect: vi.fn(),
    drawImage: vi.fn(),
    measureText: vi.fn(() => ({ width: 10 })),
    fillText: vi.fn(),
    fillStyle: '',
    font: '',
    textBaseline: 'middle',
    textAlign: 'left',
  } as unknown as CanvasRenderingContext2D

  const runtime = {
    open: vi.fn(async (asset: ResolvedMediaAsset) => {
      const assetReadAudio = vi.fn(async function* () {
        yield* audioChunks
      })
      readAudioByAsset.set(asset.id, assetReadAudio)
      const assetMedia = {
        width: asset.width ?? 1920,
        height: asset.height ?? 1080,
      } as unknown as CanvasImageSource & { width: number; height: number }
      return {
        frameAt: vi.fn(async () => assetMedia),
        readAudio: assetReadAudio,
        close: vi.fn(),
      }
    }),
    createOutput: vi.fn(async () => ({
      context,
      addVideoFrame,
      addAudioBuffer,
      finalize,
    })),
    createOfflineAudioContext: vi.fn(() => offline),
    download: vi.fn(),
  } satisfies TimelineExportRuntime

  return {
    runtime,
    addVideoFrame,
    addAudioBuffer,
    audioNode,
    readAudioByAsset,
    context,
    renderedAudio,
    finalize,
  }
}

test('exports exactly the rippled timeline duration', async () => {
  const { runtime, addVideoFrame, finalize } = fakeRuntime()

  await createTimelineExporter(runtime)({
    assets: [candidateVideo],
    spec: makeTwentySecondSilentSpec(),
    words,
    title: 'hasil',
  })

  expect(addVideoFrame).toHaveBeenCalledTimes(600)
  const finalFrame = addVideoFrame.mock.calls.at(-1)!
  expect(finalFrame[0]).toBeCloseTo(599 / 30)
  expect(finalFrame[1]).toBeCloseTo(1 / 30)
  expect(finalize).toHaveBeenCalled()
})

test('does not read audio when every audio track is hidden', async () => {
  const { runtime, readAudioByAsset } = fakeRuntime()

  await createTimelineExporter(runtime)({
    assets: [candidateVideo],
    spec: makeTwentySecondSilentSpec(),
    words,
    title: 'silent',
  })

  expect(readAudioByAsset.get('asset-candidate')).not.toHaveBeenCalled()
})

test('maps visible audio buffers onto the output timeline', async () => {
  const buffer = {} as AudioBuffer
  const {
    runtime,
    addAudioBuffer,
    audioNode,
    readAudioByAsset,
    renderedAudio,
  } = fakeRuntime([{ buffer, timestamp: 0, duration: 1 }])

  await createTimelineExporter(runtime)({
    assets: [candidateVideo],
    spec: makeEditorSpec(1),
    words,
    title: 'audio',
  })

  expect(readAudioByAsset.get('asset-candidate')).toHaveBeenCalledWith(0, 1)
  expect(audioNode.start).toHaveBeenCalledWith(0, 0, 1)
  expect(addAudioBuffer).toHaveBeenCalledWith(renderedAudio)
})

test('requires explicit confirmation before exporting a black timeline', async () => {
  const { runtime } = fakeRuntime()
  const source = makeEditorSpec(1)
  const spec = {
    ...source,
    timeline: {
      ...source.timeline,
      tracks: source.timeline.tracks.map((track) =>
        track.type === 'video' ? { ...track, hidden: true } : track,
      ),
    },
  }

  await expect(
    createTimelineExporter(runtime)({
      assets: [candidateVideo],
      spec,
      words,
      title: 'black',
    }),
  ).rejects.toThrow('Aktifkan video layer')
  expect(runtime.open).not.toHaveBeenCalled()
})

test('opens each distinct asset and draws transformed image overlay', async () => {
  const { runtime, context } = fakeRuntime()
  const source = makeEditorSpec(1)
  const spec: EditSpecV3 = {
    ...source,
    timeline: {
      ...source.timeline,
      tracks: [
        ...source.timeline.tracks,
        {
          id: 'overlay-track',
          type: 'video',
          name: 'Overlay',
          order: source.timeline.tracks.length,
          hidden: false,
          locked: false,
          clips: [{
            id: 'overlay-image',
            assetId: 'asset-image',
            timelineStart: 0,
            sourceIn: 0,
            sourceOut: 1,
            muted: false,
            transform: { x: 0.2, y: 0.2, width: 0.6, height: 0.6 },
          }],
        },
      ],
    },
  }

  await createTimelineExporter(runtime)({
    assets: [candidateVideo, overlayImage],
    spec,
    words: [],
    title: 'multi-asset',
  })

  expect(runtime.open.mock.calls.map(([asset]) => asset.id)).toEqual([
    'asset-candidate',
    'asset-image',
  ])
  expect(context.drawImage).toHaveBeenCalledWith(
    expect.anything(),
    0,
    0,
    expect.any(Number),
    expect.any(Number),
    216,
    384,
    648,
    1152,
  )
})

test('does not mix a muted linked audio clip', async () => {
  const { runtime, readAudioByAsset } = fakeRuntime()
  const source = makeEditorSpec(1)
  const spec: EditSpecV3 = {
    ...source,
    timeline: {
      ...source.timeline,
      tracks: [
        ...source.timeline.tracks.map((track) =>
          track.type === 'audio' ? { ...track, hidden: true } : track,
        ),
        {
          id: 'uploaded-video',
          type: 'video',
          name: 'Uploaded video',
          order: source.timeline.tracks.length,
          hidden: false,
          locked: false,
          clips: [{
            id: 'uploaded-visual',
            assetId: 'asset-uploaded-video',
            linkGroupId: 'uploaded-link',
            timelineStart: 0,
            sourceIn: 0,
            sourceOut: 1,
            muted: false,
            transform: { x: 0.2, y: 0.2, width: 0.6, height: 0.6 },
          }],
        },
        {
          id: 'uploaded-audio',
          type: 'audio',
          name: 'Uploaded audio',
          order: source.timeline.tracks.length + 1,
          hidden: false,
          locked: false,
          clips: [{
            id: 'uploaded-silent-audio',
            assetId: 'asset-uploaded-video',
            linkGroupId: 'uploaded-link',
            timelineStart: 0,
            sourceIn: 0,
            sourceOut: 1,
            muted: true,
          }],
        },
      ],
    },
  }

  await createTimelineExporter(runtime)({
    assets: [candidateVideo, uploadedVideo],
    spec,
    words: [],
    title: 'silent',
  })

  expect(readAudioByAsset.get('asset-uploaded-video')).not.toHaveBeenCalled()
})

const candidateVideo: ResolvedMediaAsset = {
  id: 'asset-candidate',
  name: 'Candidate.mp4',
  mediaType: 'video',
  status: 'ready',
  url: 'blob:candidate',
  bytes: 1_000,
  width: 1920,
  height: 1080,
  duration: 30,
  hasAudio: true,
  expiresAt: null,
  expiresSoon: false,
}

const overlayImage: ResolvedMediaAsset = {
  ...candidateVideo,
  id: 'asset-image',
  name: 'Portrait.png',
  mediaType: 'image',
  url: '/portrait.png',
  width: 1080,
  height: 1920,
  duration: null,
  hasAudio: false,
}

const uploadedVideo: ResolvedMediaAsset = {
  ...candidateVideo,
  id: 'asset-uploaded-video',
  name: 'Uploaded.mp4',
  url: '/uploaded.mp4',
  duration: 1,
}
