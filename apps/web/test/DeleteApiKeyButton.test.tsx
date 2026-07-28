// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { DeleteApiKeyButton } from '@/components/settings/DeleteApiKeyButton'

const refresh = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}))

vi.mock('@/lib/apiKeyForm', () => ({
  requestDeleteKey: vi.fn().mockResolvedValue({ ok: true }),
}))

test('explains irreversible deletion before calling the API', async () => {
  const user = userEvent.setup()
  render(<DeleteApiKeyButton id="key-1" label="Nebius utama" />)

  await user.click(screen.getByRole('button', { name: 'Hapus key Nebius utama' }))
  expect(screen.getByRole('alertdialog')).toHaveTextContent('tidak dapat dipulihkan')
  await user.click(screen.getByRole('button', { name: 'Hapus permanen' }))

  expect(refresh).toHaveBeenCalledOnce()
})
