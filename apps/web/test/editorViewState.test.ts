import { describe, expect, test } from 'vitest'
import { editorViewState } from '@/components/editor/editorViewState'

describe('editorViewState', () => {
  test('shows a fatal load error before payload exists', () => {
    expect(editorViewState(null, null, null, 'Editor gagal dimuat.')).toBe('error')
  })

  test('keeps users informed while the worker prepares a segment', () => {
    expect(
      editorViewState(
        { segment: { status: 'pending', url: null } },
        {},
        null,
        null,
      ),
    ).toBe('preparing')
  })

  test('waits for the browser cache after the segment is ready', () => {
    expect(
      editorViewState(
        { segment: { status: 'ready', url: 'signed' } },
        {},
        null,
        null,
      ),
    ).toBe('caching')
  })

  test('enters the workspace only when payload, spec, and media are ready', () => {
    expect(
      editorViewState(
        { segment: { status: 'ready', url: 'signed' } },
        {},
        'blob:clip',
        null,
      ),
    ).toBe('ready')
  })
})
