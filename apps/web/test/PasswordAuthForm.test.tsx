// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { PasswordAuthForm } from '@/components/PasswordAuthForm'

const signInWithPassword = vi.fn()
const signUp = vi.fn()

vi.mock('@/lib/supabase/client', () => ({
  supabaseBrowser: () => ({ auth: { signInWithPassword, signUp } }),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

test('rejects invalid email and mismatched passwords', async () => {
  render(<PasswordAuthForm initialMessage={null} />)

  fireEvent.change(screen.getByLabelText('Alamat email'), {
    target: { value: 'nama@domain' },
  })
  fireEvent.change(screen.getByLabelText('Password'), {
    target: { value: 'password-123' },
  })
  fireEvent.change(screen.getByLabelText('Konfirmasi password'), {
    target: { value: 'password-456' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Daftar' }))

  expect(await screen.findByRole('status')).toHaveTextContent('Masukkan alamat email yang valid.')
  expect(signUp).not.toHaveBeenCalled()
})

test('registers with email and password, then redirects home', async () => {
  signUp.mockResolvedValue({ data: { session: {} }, error: null })
  render(<PasswordAuthForm initialMessage={null} />)

  fireEvent.change(screen.getByLabelText('Alamat email'), {
    target: { value: 'nama@example.com' },
  })
  fireEvent.change(screen.getByLabelText('Password'), {
    target: { value: 'password-123' },
  })
  fireEvent.change(screen.getByLabelText('Konfirmasi password'), {
    target: { value: 'password-123' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Daftar' }))

  await waitFor(() => expect(signUp).toHaveBeenCalledWith({ email: 'nama@example.com', password: 'password-123' }))
  expect(await screen.findByRole('status')).toHaveTextContent('Akun berhasil dibuat.')
})

test('logs in with email and password', async () => {
  signInWithPassword.mockResolvedValue({ data: { session: {} }, error: null })
  render(<PasswordAuthForm initialMessage={null} />)

  fireEvent.click(screen.getByRole('button', { name: 'Sudah punya akun? Masuk' }))
  fireEvent.change(screen.getByLabelText('Alamat email'), {
    target: { value: 'nama@example.com' },
  })
  fireEvent.change(screen.getByLabelText('Password'), {
    target: { value: 'password-123' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Masuk' }))

  await waitFor(() =>
    expect(signInWithPassword).toHaveBeenCalledWith({
      email: 'nama@example.com',
      password: 'password-123',
    }),
  )
})
