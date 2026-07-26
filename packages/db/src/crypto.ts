import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const ALGO = 'aes-256-gcm'
const IV_BYTES = 12

export interface SealedKey {
  encryptedKey: string
  keyIv: string
  keyTag: string
}

function masterKey(b64: string): Buffer {
  const key = Buffer.from(b64, 'base64')
  if (key.length !== 32) {
    throw new Error('BYOK_MASTER_KEY harus 32 byte dalam base64')
  }
  return key
}

export function sealApiKey(plaintext: string, masterKeyB64: string): SealedKey {
  if (!plaintext) throw new Error('API key tidak boleh kosong')
  const key = masterKey(masterKeyB64)
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGO, key, iv)
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return {
    encryptedKey: enc.toString('base64'),
    keyIv: iv.toString('base64'),
    keyTag: cipher.getAuthTag().toString('base64'),
  }
}

export function openApiKey(sealed: SealedKey, masterKeyB64: string): string {
  const key = masterKey(masterKeyB64)
  const decipher = createDecipheriv(ALGO, key, Buffer.from(sealed.keyIv, 'base64'))
  decipher.setAuthTag(Buffer.from(sealed.keyTag, 'base64'))
  return Buffer.concat([
    decipher.update(Buffer.from(sealed.encryptedKey, 'base64')),
    decipher.final(),
  ]).toString('utf8')
}
