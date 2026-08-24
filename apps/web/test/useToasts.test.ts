// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { createElement, StrictMode } from 'react'
import { afterEach, expect, test, vi } from 'vitest'
import { useToasts } from '@/components/editor/useToasts'

afterEach(() => {
  vi.useRealTimers()
})

test('showToast menambah toast dan auto-dismiss sesuai durasi tone', () => {
  vi.useFakeTimers()
  const { result } = renderHook(() => useToasts())

  act(() => result.current.showToast('Tersimpan.', 'success'))
  expect(result.current.toasts).toHaveLength(1)
  expect(result.current.toasts[0]).toMatchObject({
    tone: 'success',
    message: 'Tersimpan.',
  })

  act(() => vi.advanceTimersByTime(4000))
  expect(result.current.toasts).toHaveLength(0)
})

test('warning bertahan lebih lama dari success', () => {
  vi.useFakeTimers()
  const { result } = renderHook(() => useToasts())
  act(() => result.current.showToast('Hampir hapus.', 'warning'))
  act(() => vi.advanceTimersByTime(4000))
  expect(result.current.toasts).toHaveLength(1)
  act(() => vi.advanceTimersByTime(4000))
  expect(result.current.toasts).toHaveLength(0)
})

test('maksimal 3 tampil, sisanya antre lalu muncul setelah slot bebas', () => {
  vi.useFakeTimers()
  const { result } = renderHook(() => useToasts())
  act(() => {
    for (let index = 0; index < 5; index += 1) {
      result.current.showToast(`pesan ${index}`, 'info')
    }
  })
  expect(result.current.toasts).toHaveLength(3)

  act(() => result.current.dismissToast(result.current.toasts[0]!.id))
  expect(result.current.toasts).toHaveLength(3)
  expect(result.current.toasts.map((toast) => toast.message)).toEqual([
    'pesan 1',
    'pesan 2',
    'pesan 3',
  ])
})

test('dismissToast menghapus toast spesifik', () => {
  vi.useFakeTimers()
  const { result } = renderHook(() => useToasts())
  act(() => result.current.showToast('satu', 'info'))
  act(() => result.current.showToast('dua', 'info'))
  const firstId = result.current.toasts[0]!.id
  act(() => result.current.dismissToast(firstId))
  expect(result.current.toasts.map((toast) => toast.message)).toEqual(['dua'])
})

test('StrictMode double-invocation tidak merusak akuntansi slot antrean', () => {
  vi.useFakeTimers()
  const { result } = renderHook(() => useToasts(), {
    wrapper: ({ children }) => createElement(StrictMode, null, children),
  })
  act(() => {
    for (let index = 0; index < 5; index += 1) {
      result.current.showToast(`pesan ${index}`, 'info')
    }
  })
  expect(result.current.toasts).toHaveLength(3)

  act(() => result.current.dismissToast(result.current.toasts[0]!.id))
  expect(result.current.toasts.map((toast) => toast.message)).toEqual([
    'pesan 1',
    'pesan 2',
    'pesan 3',
  ])
})
