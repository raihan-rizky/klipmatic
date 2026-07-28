// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import { ImplicitMagicLinkForm } from '@/components/ImplicitMagicLinkForm'

test('rejects an invalid email with a clear status message', () => {
  render(<ImplicitMagicLinkForm initialMessage={null} />)

  fireEvent.change(screen.getByLabelText('Alamat email'), {
    target: { value: 'nama@domain' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Kirim magic link' }))

  expect(screen.getByRole('status')).toHaveTextContent(
    'Masukkan alamat email yang valid.',
  )
})
