import { randomBytes } from 'node:crypto'
import { describe, expect, test } from 'vitest'
import { openApiKey, sealApiKey } from '../src/crypto'

const MASTER = randomBytes(32).toString('base64')
const SECRET = 'sk-proj-rahasia-sekali-1234567890'

describe('sealApiKey / openApiKey', () => {
  test('round trip mengembalikan nilai asli', () => {
    expect(openApiKey(sealApiKey(SECRET, MASTER), MASTER)).toBe(SECRET)
  })

  test('ciphertext tidak mengandung plaintext', () => {
    const sealed = sealApiKey(SECRET, MASTER)
    const blob = sealed.encryptedKey + sealed.keyIv + sealed.keyTag
    expect(Buffer.from(blob, 'base64').toString('utf8')).not.toContain('rahasia')
    expect(blob).not.toContain(SECRET)
  })

  test('dua enkripsi nilai sama menghasilkan ciphertext berbeda', () => {
    const a = sealApiKey(SECRET, MASTER)
    const b = sealApiKey(SECRET, MASTER)
    expect(a.encryptedKey).not.toBe(b.encryptedKey)
    expect(a.keyIv).not.toBe(b.keyIv)
  })

  test('ciphertext yang diubah ditolak', () => {
    const sealed = sealApiKey(SECRET, MASTER)
    const bytes = Buffer.from(sealed.encryptedKey, 'base64')
    bytes[0] = bytes[0]! ^ 0xff
    expect(() => openApiKey({ ...sealed, encryptedKey: bytes.toString('base64') }, MASTER)).toThrow()
  })

  test('master key salah ditolak', () => {
    const sealed = sealApiKey(SECRET, MASTER)
    expect(() => openApiKey(sealed, randomBytes(32).toString('base64'))).toThrow()
  })

  test('master key dengan panjang salah ditolak saat enkripsi', () => {
    expect(() => sealApiKey(SECRET, randomBytes(16).toString('base64'))).toThrow(/BYOK_MASTER_KEY/)
  })

  test('plaintext kosong ditolak', () => {
    expect(() => sealApiKey('', MASTER)).toThrow(/kosong/)
  })
})
