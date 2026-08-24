// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import { EditorToasts } from '@/components/editor/EditorToasts'

afterEach(cleanup)

const toasts = [
  { id: 't1', tone: 'success' as const, message: 'Fokus crop mengikuti wajah.' },
  { id: 't2', tone: 'warning' as const, message: 'logo.png akan dihapus.' },
]

test('merender stack dengan aria-live polite dan tombol tutup per toast', async () => {
  const onDismiss = vi.fn()
  render(<EditorToasts toasts={toasts} onDismiss={onDismiss} />)

  const stack = screen.getByRole('status')
  expect(stack).toHaveAttribute('aria-live', 'polite')
  expect(screen.getByText('Fokus crop mengikuti wajah.')).toBeVisible()

  await userEvent.click(
    screen.getByLabelText('Tutup notifikasi: logo.png akan dihapus.'),
  )
  expect(onDismiss).toHaveBeenCalledWith('t2')
})
