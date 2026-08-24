// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import {
  SHORTCUT_GROUPS,
  ShortcutHelpDialog,
} from '@/components/editor/ShortcutHelpDialog'

afterEach(cleanup)

test('daftar grup shortcut lengkap dan dialog merender itemnya', () => {
  render(<ShortcutHelpDialog open onOpenChange={() => undefined} />)

  const labels = SHORTCUT_GROUPS.map((group) => group.label)
  expect(labels).toEqual(['Pemutaran', 'Editing', 'Bantuan'])

  expect(screen.getByRole('dialog')).toBeVisible()
  expect(screen.getByText('Putar / jeda')).toBeVisible()
  expect(screen.getByText('Split di playhead')).toBeVisible()
  expect(screen.getByText('Undo')).toBeVisible()
})
