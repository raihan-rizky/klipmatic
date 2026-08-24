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

  expect(screen.getByRole('link', { name: /Klipmatic/i })).toHaveAttribute('href', '/')
  expect(screen.getByRole('navigation', { name: 'Navigasi utama' })).toBeVisible()
  expect(screen.getByRole('link', { name: 'Buat klip' })).toHaveAttribute(
    'aria-label',
    'Buat klip',
  )
  expect(screen.getByRole('link', { name: 'API Key' })).toHaveAttribute(
    'aria-label',
    'API Key',
  )
  expect(screen.getByRole('link', { name: 'Buat klip' })).toHaveAttribute('href', '/')
  expect(screen.getByRole('link', { name: 'API Key' })).toHaveAttribute('href', '/settings/keys')
  expect(screen.getByRole('link', { name: 'Akun' })).toHaveAttribute('href', '/login')
  expect(screen.getByRole('navigation', { name: 'Navigasi utama' })).toHaveClass(
    'pointer-events-auto',
    'relative',
    'z-10',
  )
  expect(screen.getByText('Studio rail')).toBeVisible()
  expect(screen.getByText('Ingest')).toBeVisible()
  expect(screen.getByText('Cut')).toBeVisible()
  expect(screen.getByText('Export')).toBeVisible()
  expect(screen.getByRole('banner')).toHaveClass('motion-shell-enter')
  expect(screen.getByLabelText('Studio rail')).toHaveClass('studio-rail')
  expect(screen.getByLabelText('Studio rail').querySelector('[aria-hidden="true"]')).toHaveClass(
    'studio-rail-signal',
  )
  expect(screen.getByRole('main')).toContainElement(
    screen.getByRole('heading', { name: 'Konten' }),
  )
})
