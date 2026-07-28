import { expect, test, vi } from 'vitest'
import { applyTimelineCommand, type TranscriptWord } from '@cheapclipper/engine'
import {
  createTimelineExporter,
  type TimelineExportRuntime,
} from '@/lib/browserExport'
import { editorContext, makeEditorSpec } from './editorFixtures'

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
  const readAudio = vi.fn(async function* () {
    yield* audioChunks
  })
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
  const media = {
    width: 1920,
    height: 1080,
  } as unknown as CanvasImageSource & { width: number; height: number }
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
    open: vi.fn(async () => ({
      frameAt: vi.fn(async () => media),
      readAudio,
    })),
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
    readAudio,
    renderedAudio,
    finalize,
  }
}

test('exports exactly the rippled timeline duration', async () => {
  const { runtime, addVideoFrame, finalize } = fakeRuntime()

  await createTimelineExporter(runtime)({
    url: 'blob:clip',
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
  const { runtime, readAudio } = fakeRuntime()

  await createTimelineExporter(runtime)({
    url: 'blob:clip',
    spec: makeTwentySecondSilentSpec(),
    words,
    title: 'silent',
  })

  expect(readAudio).not.toHaveBeenCalled()
})

test('maps visible audio buffers onto the output timeline', async () => {
  const buffer = {} as AudioBuffer
  const {
    runtime,
    addAudioBuffer,
    audioNode,
    readAudio,
    renderedAudio,
  } = fakeRuntime([{ buffer, timestamp: 0, duration: 1 }])

  await createTimelineExporter(runtime)({
    url: 'blob:clip',
    spec: makeEditorSpec(1),
    words,
    title: 'audio',
  })

  expect(readAudio).toHaveBeenCalledWith(0, 1)
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
      url: 'blob:clip',
      spec,
      words,
      title: 'black',
    }),
  ).rejects.toThrow('Aktifkan video layer')
  expect(runtime.open).not.toHaveBeenCalled()
})
