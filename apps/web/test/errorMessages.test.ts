import { expect, test } from 'vitest'
import { ERROR_CODES } from '@klipmatic/shared'
import { messageFor } from '../lib/errorMessages'

test('setiap kode error punya kalimat Indonesia', () => {
  for (const code of ERROR_CODES) {
    const msg = messageFor(code)
    expect(msg.length).toBeGreaterThan(10)
    expect(msg).not.toBe(code)
  }
})

test('kode tak dikenal jatuh ke pesan umum, bukan melempar', () => {
  expect(messageFor('KODE_ASING' as never)).toContain('kesalahan')
})

test('pesan tidak membocorkan detail teknis', () => {
  for (const code of ERROR_CODES) {
    const msg = messageFor(code)
    expect(msg).not.toMatch(/stderr|traceback|yt-dlp|ffmpeg|null|undefined/i)
  }
})
