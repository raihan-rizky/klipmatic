// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { CaptionControls } from '@/components/editor/CaptionControls'
import { CropControls } from '@/components/editor/CropControls'
import { TimelinePreview } from '@/components/editor/TimelinePreview'
import { makeEditorSpec } from './editorFixtures'

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
      words={[]}
      mediaUrl="/api/clips/clip-1/segment"
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
