// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import { AppShell } from '@/components/AppShell'

test('app shell exposes brand, primary navigation, and content landmark', () => {
  render(
    <AppShell>
      <h1>Konten</h1>
    </AppShell>,
  )

  expect(screen.getByRole('link', { name: /CheapClipper/i })).toHaveAttribute('href', '/')
  expect(screen.getByRole('navigation', { name: 'Navigasi utama' })).toBeVisible()
  expect(screen.getByRole('link', { name: 'Buat klip' })).toHaveAttribute(
    'aria-label',
    'Buat klip',
  )
  expect(screen.getByRole('link', { name: 'API Key' })).toHaveAttribute(
    'aria-label',
    'API Key',
  )
  expect(screen.getByRole('main')).toContainElement(
    screen.getByRole('heading', { name: 'Konten' }),
  )
})
