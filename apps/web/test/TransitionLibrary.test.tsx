// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import {
  TransitionLibrary,
  type TransitionDragPayload,
} from '@/components/editor/TransitionLibrary'
import type { TransitionJoint } from '@klipmatic/engine'

afterEach(cleanup)

const joint: TransitionJoint = {
  trackId: 'video',
  fromClipId: 'left',
  toClipId: 'right',
  outputTime: 12,
  maxDuration: 2,
}

function transitionTransfer(type: TransitionDragPayload['type']): DataTransfer {
  const values = new Map<string, string>()
  values.set(
    'application/x-klipmatic-transition',
    JSON.stringify({ type, duration: 0.5 }),
  )
  return {
    effectAllowed: 'copy',
    dropEffect: 'copy',
    files: [] as unknown as FileList,
    items: [] as unknown as DataTransferItemList,
    types: [...values.keys()],
    clearData: (format?: string) => {
      if (format) values.delete(format)
      else values.clear()
    },
    getData: (format: string) => values.get(format) ?? '',
    setData: (format: string, value: string) => { values.set(format, value) },
    setDragImage: () => undefined,
  }
}

test('essential transition cards expose allowlisted drag data', () => {
  const onDragStateChange = vi.fn()
  render(
    <TransitionLibrary
      selectedJoint={null}
      onAdd={vi.fn()}
      onDragStateChange={onDragStateChange}
    />,
  )
  const transfer = transitionTransfer('cross-dissolve')

  fireEvent.dragStart(screen.getByRole('button', { name: 'Cross Dissolve' }), {
    dataTransfer: transfer,
  })

  expect(JSON.parse(transfer.getData('application/x-klipmatic-transition')))
    .toEqual({ type: 'cross-dissolve', duration: 0.5 })
  expect(onDragStateChange).toHaveBeenCalledWith(true)
})

test('selected joint gets keyboard-accessible add actions', async () => {
  const onAdd = vi.fn()
  render(
    <TransitionLibrary
      selectedJoint={joint}
      onAdd={onAdd}
      onDragStateChange={vi.fn()}
    />,
  )

  await userEvent.click(
    screen.getByRole('button', { name: 'Add Cross Dissolve to selected cut' }),
  )

  expect(onAdd).toHaveBeenCalledWith('cross-dissolve', 0.5, joint)
})
