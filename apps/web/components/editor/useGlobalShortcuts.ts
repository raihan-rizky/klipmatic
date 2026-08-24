'use client'

import { useEffect, useRef } from 'react'

export interface GlobalShortcutHandlers {
  onTogglePlay(): void
  onSplit(): void
  onDeleteSelected(): void
  onUndo(): void
  onRedo(): void
  onStepFrame(direction: -1 | 1, coarse: boolean): void
  onJumpToStart(): void
  onJumpToEnd(): void
  onShowShortcuts(): void
}

const EDITABLE_SELECTOR =
  'input, textarea, select, [contenteditable="true"], [role="dialog"]'

function eventTargetElement(event: KeyboardEvent): Element | null {
  if (event.target instanceof Element) return event.target
  // jsdom/fireEvent dari window tidak mengisi target elemen; pakai focus aktif.
  if (typeof document !== 'undefined' && document.activeElement) {
    return document.activeElement
  }
  return null
}

function shouldIgnore(event: KeyboardEvent): boolean {
  if (event.defaultPrevented) return true
  const target = eventTargetElement(event)
  return target !== null && target.closest(EDITABLE_SELECTOR) !== null
}

export function useGlobalShortcuts(handlers: GlobalShortcutHandlers): void {
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (shouldIgnore(event)) return
      const call = handlersRef.current
      const modifier = event.ctrlKey || event.metaKey
      if (modifier && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) call.onRedo()
        else call.onUndo()
        return
      }
      if (modifier || event.altKey) return
      switch (event.key) {
        case ' ':
          event.preventDefault()
          call.onTogglePlay()
          return
        case 's':
        case 'S':
          event.preventDefault()
          call.onSplit()
          return
        case 'Delete':
        case 'Backspace':
          event.preventDefault()
          call.onDeleteSelected()
          return
        case 'ArrowLeft':
          event.preventDefault()
          call.onStepFrame(-1, event.shiftKey)
          return
        case 'ArrowRight':
          event.preventDefault()
          call.onStepFrame(1, event.shiftKey)
          return
        case 'Home':
          event.preventDefault()
          call.onJumpToStart()
          return
        case 'End':
          event.preventDefault()
          call.onJumpToEnd()
          return
        case '?':
          event.preventDefault()
          call.onShowShortcuts()
          return
        default:
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
