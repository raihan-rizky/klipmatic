// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { normalizeEditSpec } from '@cheapclipper/engine'
import { CaptionControls } from '@/components/editor/CaptionControls'
import { CropControls } from '@/components/editor/CropControls'

test('crop panel exposes manual and face focus controls', () => {
  render(
    <CropControls
      spec={normalizeEditSpec(null)}
      onChange={vi.fn()}
      onAutoFocus={vi.fn()}
    />,
  )

  expect(screen.getByLabelText('Fokus horizontal')).toBeVisible()
  expect(screen.getByLabelText('Zoom')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Deteksi wajah' })).toBeVisible()
})

test('caption panel can disable karaoke captions', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  render(<CaptionControls spec={normalizeEditSpec(null)} onChange={onChange} />)

  await user.click(
    screen.getByRole('checkbox', { name: 'Tampilkan caption karaoke' }),
  )

  expect(onChange).toHaveBeenCalledWith(
    expect.objectContaining({
      captions: expect.objectContaining({ enabled: false }),
    }),
  )
})
