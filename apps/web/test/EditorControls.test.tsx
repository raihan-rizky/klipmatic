// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import { AssetInspector } from '@/components/editor/AssetInspector'
import { CaptionControls } from '@/components/editor/CaptionControls'
import { CropControls } from '@/components/editor/CropControls'
import { TimelinePreview } from '@/components/editor/TimelinePreview'
import { TransitionInspector } from '@/components/editor/TransitionInspector'
import { makeEditorSpec, makeSpecWithTransition } from './editorFixtures'
import type { ResolvedMediaAsset } from '@/lib/clipTypes'

afterEach(cleanup)

test('crop panel exposes manual and face focus controls', () => {
  render(
    <CropControls
      spec={makeEditorSpec()}
      onCommand={vi.fn()}
      onAutoFocus={vi.fn()}
    />,
  )

  expect(screen.getByLabelText('Fokus horizontal')).toBeVisible()
  expect(screen.getByLabelText('Zoom')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Deteksi wajah' })).toBeVisible()
})

test('caption panel can disable karaoke captions', async () => {
  const user = userEvent.setup()
  const onCommand = vi.fn()
  render(<CaptionControls spec={makeEditorSpec()} onCommand={onCommand} />)

  await user.click(
    screen.getByRole('checkbox', { name: 'Tampilkan caption karaoke' }),
  )

  expect(onCommand).toHaveBeenCalledWith({
    type: 'updateCaptions',
    captions: { enabled: false },
  })
})

test('caption panel updates global horizontal position', () => {
  const onCommand = vi.fn()
  render(<CaptionControls spec={makeEditorSpec()} onCommand={onCommand} />)

  fireEvent.change(screen.getByLabelText('Posisi horizontal'), {
    target: { value: '0.3' },
  })

  expect(onCommand).toHaveBeenCalledWith({
    type: 'updateCaptions',
    captions: { positionX: 0.3 },
  })
})

test('asset inspector edits transform and clip mute', async () => {
  const onCommand = vi.fn()
  render(
    <AssetInspector
      trackId="overlay-track"
      clip={{
        id: 'overlay-clip',
        assetId: 'asset-image',
        timelineStart: 0,
        sourceIn: 0,
        sourceOut: 5,
        muted: false,
        transform: { x: 0.2, y: 0.2, width: 0.6, height: 0.6 },
      }}
      onCommand={onCommand}
    />,
  )

  fireEvent.change(screen.getByLabelText('Posisi X'), { target: { value: '0.3' } })
  expect(onCommand).toHaveBeenCalledWith({
    type: 'updateVisualTransform',
    trackId: 'overlay-track',
    clipId: 'overlay-clip',
    transform: { x: 0.3, y: 0.2, width: 0.6, height: 0.6 },
  })

  await userEvent.click(screen.getByRole('checkbox', { name: 'Bisukan clip' }))
  expect(onCommand).toHaveBeenCalledWith({
    type: 'setClipMuted',
    trackId: 'overlay-track',
    clipId: 'overlay-clip',
    muted: true,
  })
})

test('selected transition inspector edits duration, type, and deletes it', async () => {
  const onCommand = vi.fn()
  const spec = makeSpecWithTransition('cross-dissolve')
  const transitionId = spec.timeline.transitions[0]!.id
  render(
    <TransitionInspector
      spec={spec}
      transitionId={transitionId}
      onCommand={onCommand}
    />,
  )

  fireEvent.change(screen.getByLabelText('Durasi transition'), {
    target: { value: '1.2' },
  })
  expect(onCommand).toHaveBeenCalledWith({
    type: 'updateTransition',
    transitionId,
    patch: { duration: 1.2 },
  })

  await userEvent.selectOptions(screen.getByLabelText('Tipe transition'), 'fade')
  expect(onCommand).toHaveBeenCalledWith({
    type: 'updateTransition',
    transitionId,
    patch: { type: 'fade' },
  })

  await userEvent.click(screen.getByRole('button', { name: 'Hapus transition' }))
  expect(onCommand).toHaveBeenCalledWith({
    type: 'deleteTransition',
    transitionId,
  })
})

test('timeline preview exposes one vertical canvas and transport controls', async () => {
  const onPlayingChange = vi.fn()
  const pause = vi
    .spyOn(HTMLMediaElement.prototype, 'pause')
    .mockImplementation(() => undefined)
  const load = vi
    .spyOn(HTMLMediaElement.prototype, 'load')
    .mockImplementation(() => undefined)
  const { unmount } = render(
    <TimelinePreview
      spec={makeEditorSpec()}
      assets={[candidateVideo]}
      words={[]}
      playhead={0}
      playing={false}
      onPlayheadChange={vi.fn()}
      onPlayingChange={onPlayingChange}
      onStall={vi.fn()}
    />,
  )

  expect(screen.getByLabelText('Preview video vertikal')).toHaveAttribute(
    'width',
    '1080',
  )
  await userEvent.click(screen.getByRole('button', { name: 'Putar preview' }))

  expect(onPlayingChange).toHaveBeenCalledWith(true)
  unmount()
  pause.mockRestore()
  load.mockRestore()
})

test('preview renders distinct image, video, and audio asset elements', () => {
  const source = makeEditorSpec()
  const audioTrack = source.timeline.tracks.find((track) => track.type === 'audio')!
  const spec = {
    ...source,
    timeline: {
      ...source.timeline,
      tracks: [
        ...source.timeline.tracks.map((track) =>
          track.id === audioTrack.id
            ? {
                ...track,
                clips: [{
                  ...track.clips[0]!,
                  id: 'sfx-clip',
                  assetId: 'sfx',
                  sourceOut: 2,
                }],
              }
            : track,
        ),
        {
          id: 'overlay-track',
          type: 'video' as const,
          name: 'Overlay',
          order: source.timeline.tracks.length,
          hidden: false,
          locked: false,
          clips: [{
            id: 'overlay-clip',
            assetId: 'overlay',
            timelineStart: 0,
            sourceIn: 0,
            sourceOut: 5,
            muted: false,
            transform: { x: 0.2, y: 0.2, width: 0.6, height: 0.6 },
          }],
        },
      ],
    },
  }
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined)
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined)

  render(
    <TimelinePreview
      spec={spec}
      assets={[candidateVideo, overlayImage, soundEffect]}
      words={[]}
      playhead={0}
      playing={false}
      onPlayheadChange={vi.fn()}
      onPlayingChange={vi.fn()}
      onStall={vi.fn()}
    />,
  )

  expect(screen.getByTestId('asset-media-candidate')).toHaveAttribute(
    'src',
    candidateVideo.url,
  )
  expect(screen.getByTestId('asset-media-overlay')).toHaveAttribute(
    'src',
    overlayImage.url,
  )
  expect(screen.getByTestId('asset-media-sfx')).toHaveAttribute(
    'src',
    soundEffect.url,
  )
})

test('errorBanner dirender di atas transport', () => {
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined)
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined)

  render(
    <TimelinePreview
      spec={makeEditorSpec()}
      assets={[candidateVideo]}
      words={[]}
      playhead={0}
      playing={false}
      onPlayheadChange={vi.fn()}
      onPlayingChange={vi.fn()}
      onStall={vi.fn()}
      errorBanner={<div role="alert">Ekspor gagal: codec hilang.</div>}
    />,
  )

  expect(screen.getByRole('alert')).toHaveTextContent('Ekspor gagal: codec hilang.')
})

const candidateVideo: ResolvedMediaAsset = {
  id: 'asset-candidate',
  name: 'Candidate.mp4',
  mediaType: 'video',
  status: 'ready',
  url: '/candidate.mp4',
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
  id: 'overlay',
  name: 'Overlay.png',
  mediaType: 'image',
  url: '/overlay.png',
  width: 800,
  height: 600,
  duration: null,
  hasAudio: false,
}

const soundEffect: ResolvedMediaAsset = {
  ...candidateVideo,
  id: 'sfx',
  name: 'Pop.mp3',
  mediaType: 'audio',
  url: '/pop.mp3',
  width: null,
  height: null,
  duration: 2,
  hasAudio: true,
}
