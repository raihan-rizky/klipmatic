// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { useEditorAutosave } from '@/components/editor/useEditorAutosave'
import { makeEditorSpec } from './editorFixtures'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

test('waits for idle time before saving an edit', async () => {
  vi.useFakeTimers()
  const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  const specA = makeEditorSpec()
  const specB = { ...specA, crop: { ...specA.crop, focusX: 0.25 } }

  const { rerender, result } = renderHook(
    ({ spec }) =>
      useEditorAutosave({ clipId: 'clip-1', spec, delayMs: 1000 }),
    { initialProps: { spec: specA } },
  )
  rerender({ spec: specB })

  expect(result.current.status).toBe('unsaved')
  await act(async () => {
    await vi.advanceTimersByTimeAsync(999)
  })
  expect(fetchMock).not.toHaveBeenCalled()
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1)
  })
  expect(fetchMock).toHaveBeenCalledTimes(1)
  expect(result.current.status).toBe('saved')
})

test('serializes requests and flushes the newest snapshot', async () => {
  vi.useFakeTimers()
  let resolveFirst!: (response: Response) => void
  const first = new Promise<Response>((resolve) => {
    resolveFirst = resolve
  })
  const fetchMock = vi.fn()
    .mockReturnValueOnce(first)
    .mockResolvedValueOnce(new Response('{}', { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  const specA = makeEditorSpec()
  const specB = { ...specA, crop: { ...specA.crop, focusX: 0.25 } }
  const specC = { ...specA, crop: { ...specA.crop, focusX: 0.75 } }

  const { rerender, result } = renderHook(
    ({ spec }) =>
      useEditorAutosave({ clipId: 'clip-1', spec, delayMs: 1000 }),
    { initialProps: { spec: specA } },
  )
  rerender({ spec: specB })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000)
  })
  rerender({ spec: specC })
  resolveFirst(new Response('{}', { status: 200 }))

  await act(async () => {
    await result.current.flush()
  })

  expect(fetchMock).toHaveBeenCalledTimes(2)
  const secondBody = JSON.parse(fetchMock.mock.calls[1]![1]!.body as string)
  expect(secondBody.editSpec.crop.focusX).toBe(0.75)
  expect(result.current.status).toBe('saved')
})

test('keeps the latest edit retryable after a save failure', async () => {
  vi.useFakeTimers()
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(new Response('{}', { status: 500 }))
    .mockResolvedValueOnce(new Response('{}', { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  const specA = makeEditorSpec()
  const specB = { ...specA, crop: { ...specA.crop, focusX: 0.4 } }

  const { rerender, result } = renderHook(
    ({ spec }) =>
      useEditorAutosave({ clipId: 'clip-1', spec, delayMs: 1000 }),
    { initialProps: { spec: specA } },
  )
  rerender({ spec: specB })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000)
  })

  expect(result.current.status).toBe('error')
  await act(async () => {
    await result.current.retry()
  })
  expect(fetchMock).toHaveBeenCalledTimes(2)
  expect(result.current.status).toBe('saved')
})
