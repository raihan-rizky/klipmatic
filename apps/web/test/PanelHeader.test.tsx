// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import { PanelHeader } from '@/components/editor/PanelHeader'

afterEach(cleanup)

test('menampilkan judul, hint opsional, dan slot aksi', () => {
  render(
    <PanelHeader
      title="Media"
      hint="120 KB / 500 MB"
      actions={<button type="button">Upload</button>}
    />,
  )

  expect(screen.getByRole('heading', { name: 'Media' })).toBeVisible()
  expect(screen.getByText('120 KB / 500 MB')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Upload' })).toBeVisible()
})

test('tanpa hint dan aksi tetap valid', () => {
  render(<PanelHeader title="Inspector" />)
  expect(screen.getByRole('heading', { name: 'Inspector' })).toBeVisible()
})
