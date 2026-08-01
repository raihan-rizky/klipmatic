import { expect, test, vi } from 'vitest'
import {
  createDefaultEditSpecV3,
  drawTimelineComposite,
  type DrawableMedia,
} from '../src'

function mockContext() {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    fillRect: vi.fn(),
    drawImage: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn(() => ({ width: 10 })),
    fillStyle: '',
    font: '',
    textBaseline: 'alphabetic',
    textAlign: 'start',
    globalAlpha: 1,
  } as unknown as CanvasRenderingContext2D
}

const spec = {
  ...createDefaultEditSpecV3({
    sourceId: 'source',
    candidateAssetId: 'candidate',
    candidateDuration: 10,
    assets: {
      candidate: {
        id: 'candidate',
        mediaType: 'video',
        duration: 10,
        width: 1920,
        height: 1080,
        hasAudio: true,
      },
    },
  }),
  output: { width: 1080, height: 1920, frameRate: 30 } as const,
}

test('non-primary visual uses contain math inside its transform box', () => {
  const context = mockContext()
  const media = { width: 400, height: 200 } as CanvasImageSource & DrawableMedia

  drawTimelineComposite(context, [{
    clipId: 'overlay',
    media,
    order: 1,
    transform: { x: 0.1, y: 0.2, width: 0.5, height: 0.5 },
    opacity: 0.75,
    primary: false,
  }], spec, [], 0)

  expect(context.drawImage).toHaveBeenCalledWith(
    media,
    0,
    0,
    400,
    200,
    108,
    729,
    540,
    270,
  )
  expect(context.save).toHaveBeenCalledTimes(2)
  expect(context.restore).toHaveBeenCalledTimes(2)
})

test('primary visual keeps full-canvas crop behavior', () => {
  const context = mockContext()
  const media = { videoWidth: 1920, videoHeight: 1080 } as CanvasImageSource & DrawableMedia

  drawTimelineComposite(context, [{
    clipId: 'primary',
    media,
    order: 0,
    transform: { x: 0.2, y: 0.2, width: 0.4, height: 0.4 },
    opacity: 1,
    primary: true,
  }], spec, [], 0)

  expect(context.drawImage).toHaveBeenCalledWith(
    media,
    expect.any(Number),
    expect.any(Number),
    expect.any(Number),
    expect.any(Number),
    0,
    0,
    1080,
    1920,
  )
})
