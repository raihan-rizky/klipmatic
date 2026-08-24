// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { useGlobalShortcuts } from '@/components/editor/useGlobalShortcuts'

afterEach(cleanup)

function harness(handlers: Parameters<typeof useGlobalShortcuts>[0]) {
  function Component() {
    useGlobalShortcuts(handlers)
    return null
  }
  render(<Component />)
}

function press(key: string, init: KeyboardEventInit = {}) {
  fireEvent(
    window,
    new KeyboardEvent('keydown', { key, bubbles: true, ...init }),
  )
}

const baseHandlers = () => ({
  onTogglePlay: vi.fn(),
  onSplit: vi.fn(),
  onDeleteSelected: vi.fn(),
  onUndo: vi.fn(),
  onRedo: vi.fn(),
  onStepFrame: vi.fn(),
  onJumpToStart: vi.fn(),
  onJumpToEnd: vi.fn(),
  onShowShortcuts: vi.fn(),
})

test('space memicu toggle play', () => {
  const handlers = baseHandlers()
  harness(handlers)
  press(' ')
  expect(handlers.onTogglePlay).toHaveBeenCalledOnce()
})

test('s memicu split tanpa modifier', () => {
  const handlers = baseHandlers()
  harness(handlers)
  press('s')
  expect(handlers.onSplit).toHaveBeenCalledOnce()
})

test('Delete memicu hapus seleksi', () => {
  const handlers = baseHandlers()
  harness(handlers)
  press('Delete')
  expect(handlers.onDeleteSelected).toHaveBeenCalledOnce()
})

test('ctrl+z undo dan ctrl+shift+z redo', () => {
  const handlers = baseHandlers()
  harness(handlers)
  press('z', { ctrlKey: true })
  expect(handlers.onUndo).toHaveBeenCalledOnce()
  press('z', { ctrlKey: true, shiftKey: true })
  expect(handlers.onRedo).toHaveBeenCalledOnce()
})

test('panah memicu step frame dengan arah dan coarse benar', () => {
  const handlers = baseHandlers()
  harness(handlers)
  press('ArrowLeft')
  press('ArrowRight', { shiftKey: true })
  expect(handlers.onStepFrame).toHaveBeenNthCalledWith(1, -1, false)
  expect(handlers.onStepFrame).toHaveBeenNthCalledWith(2, 1, true)
})

test('Home dan End melompat ke ujung timeline', () => {
  const handlers = baseHandlers()
  harness(handlers)
  press('Home')
  press('End')
  expect(handlers.onJumpToStart).toHaveBeenCalledOnce()
  expect(handlers.onJumpToEnd).toHaveBeenCalledOnce()
})

test('tanda tanya membuka cheat sheet', () => {
  const handlers = baseHandlers()
  harness(handlers)
  press('?')
  expect(handlers.onShowShortcuts).toHaveBeenCalledOnce()
})

test('mengabaikan shortcut saat fokus di input', () => {
  const handlers = baseHandlers()
  document.body.innerHTML = '<input id="field" />'
  harness(handlers)
  const input = document.getElementById('field')!
  input.focus()
  Object.defineProperty(document, 'activeElement', {
    value: input,
    configurable: true,
  })
  press(' ')
  expect(handlers.onTogglePlay).not.toHaveBeenCalled()
})

test('mengabaikan shortcut saat event terjadi di dalam dialog', () => {
  const handlers = baseHandlers()
  document.body.innerHTML = '<div role="dialog"><input id="in-dialog" /></div>'
  harness(handlers)
  const input = document.getElementById('in-dialog')!
  input.focus()
  Object.defineProperty(document, 'activeElement', {
    value: input,
    configurable: true,
  })
  press(' ')
  expect(handlers.onTogglePlay).not.toHaveBeenCalled()
})
