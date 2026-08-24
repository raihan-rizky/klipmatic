// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import { JointTransitionPopover } from '@/components/editor/JointTransitionPopover'
import type { TransitionJoint } from '@klipmatic/engine'

afterEach(cleanup)

const joint: TransitionJoint = {
  trackId: 'video-primary',
  fromClipId: 'clip-a',
  toClipId: 'clip-b',
  outputTime: 12,
  maxDuration: 1,
}

function renderPopover() {
  const onAdd = vi.fn()
  const onClose = vi.fn()
  render(
    <div className="relative">
      <JointTransitionPopover
        joint={joint}
        left={432}
        frameRate={30}
        onAdd={onAdd}
        onClose={onClose}
      />
    </div>,
  )
  return { onAdd, onClose }
}

test('menampilkan tiga tipe transition dan fade terpilih default', () => {
  renderPopover()
  expect(
    screen.getByRole('dialog', { name: 'Tambahkan transition di cut point' }),
  ).toBeVisible()
  for (const label of ['Fade', 'Cross Dissolve', 'Dip to Black']) {
    expect(screen.getByRole('button', { name: label })).toBeVisible()
  }
  expect(screen.getByRole('button', { name: 'Fade' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
})

test('slider durasi di-clamp ke maxDuration joint', () => {
  renderPopover()
  const slider = screen.getByRole('slider', {
    name: 'Durasi transition popover',
  })
  expect(slider).toHaveAttribute('max', '1')
  expect(slider).toHaveAttribute('step', String(1 / 30))
})

test('ganti tipe lalu Add mengirim payload benar dan menutup', async () => {
  const user = userEvent.setup()
  const { onAdd, onClose } = renderPopover()
  await user.click(screen.getByRole('button', { name: 'Cross Dissolve' }))
  await user.click(screen.getByRole('button', { name: 'Tambahkan transition' }))

  expect(onAdd).toHaveBeenCalledWith('cross-dissolve', 0.5)
  expect(onClose).toHaveBeenCalledOnce()
})

test('Escape menutup tanpa menambah', () => {
  const { onAdd, onClose } = renderPopover()
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
  expect(onClose).toHaveBeenCalledOnce()
  expect(onAdd).not.toHaveBeenCalled()
})
