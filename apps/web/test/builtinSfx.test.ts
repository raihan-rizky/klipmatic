import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test } from 'vitest'

const SFX_DIR = resolve(import.meta.dirname, '../public/presets/sfx')

function readWav(path: string) {
  const bytes = readFileSync(path)
  const channels = bytes.readUInt16LE(22)
  const sampleRate = bytes.readUInt32LE(24)
  const bitsPerSample = bytes.readUInt16LE(34)
  const dataBytes = bytes.readUInt32LE(40)
  return {
    channels,
    sampleRate,
    bitsPerSample,
    duration: dataBytes / (sampleRate * channels * (bitsPerSample / 8)),
  }
}

test.each([
  ['pop.wav', 0.18],
  ['click.wav', 0.08],
  ['bell.wav', 0.8],
  ['whoosh.wav', 0.55],
])('%s is mono 48k PCM near %ss', (name, duration) => {
  const wav = readWav(resolve(SFX_DIR, name))
  expect(wav.sampleRate).toBe(48_000)
  expect(wav.channels).toBe(1)
  expect(wav.bitsPerSample).toBe(16)
  expect(wav.duration).toBeCloseTo(duration, 2)
})
