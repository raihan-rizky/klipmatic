import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const SAMPLE_RATE = 48_000
const SEED = 0x43435052

export type WaveFn = (time: number) => number

export function writeMonoPcm16(
  path: string,
  duration: number,
  wave: WaveFn,
): void {
  const sampleCount = Math.round(SAMPLE_RATE * duration)
  const dataBytes = sampleCount * 2
  const wav = Buffer.alloc(44 + dataBytes)

  wav.write('RIFF', 0)
  wav.writeUInt32LE(36 + dataBytes, 4)
  wav.write('WAVE', 8)
  wav.write('fmt ', 12)
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20)
  wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(SAMPLE_RATE, 24)
  wav.writeUInt32LE(SAMPLE_RATE * 2, 28)
  wav.writeUInt16LE(2, 32)
  wav.writeUInt16LE(16, 34)
  wav.write('data', 36)
  wav.writeUInt32LE(dataBytes, 40)

  for (let index = 0; index < sampleCount; index += 1) {
    const sample = Math.max(-1, Math.min(1, wave(index / SAMPLE_RATE)))
    wav.writeInt16LE(Math.round(sample * 32_767), 44 + index * 2)
  }

  writeFileSync(path, wav)
}

function seededNoise(seed = SEED): () => number {
  let state = seed >>> 0
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return ((state >>> 0) / 0xffffffff) * 2 - 1
  }
}

function pop(time: number): number {
  const duration = 0.18
  const phase =
    2 * Math.PI * (180 * time + ((520 - 180) * time * time) / (2 * duration))
  return Math.sin(phase) * Math.exp(-18 * time) * 0.82
}

function click(): WaveFn {
  const noise = seededNoise()
  return (time) => {
    const decay = Math.exp(-55 * time)
    return (noise() * 0.58 + Math.sin(2 * Math.PI * 1_800 * time) * 0.42) * decay
  }
}

function bell(time: number): number {
  const partials =
    Math.sin(2 * Math.PI * 880 * time) * 0.58 +
    Math.sin(2 * Math.PI * 1_320 * time) * 0.28 +
    Math.sin(2 * Math.PI * 1_760 * time) * 0.14
  return partials * Math.exp(-5 * time) * 0.78
}

function whoosh(): WaveFn {
  const duration = 0.55
  const noise = seededNoise()
  let lowPass = 0

  return (time) => {
    const progress = Math.min(1, time / duration)
    const raw = noise()
    const smoothing = 0.025 + progress * 0.32
    lowPass += (raw - lowPass) * smoothing
    const highPass = raw - lowPass
    const swept = lowPass * (1 - progress) + highPass * progress
    return swept * Math.sin(Math.PI * progress) * 0.9
  }
}

export function generateBuiltInSfx(
  outputDir = resolve(import.meta.dirname, '../public/presets/sfx'),
): void {
  mkdirSync(outputDir, { recursive: true })
  writeMonoPcm16(resolve(outputDir, 'pop.wav'), 0.18, pop)
  writeMonoPcm16(resolve(outputDir, 'click.wav'), 0.08, click())
  writeMonoPcm16(resolve(outputDir, 'bell.wav'), 0.8, bell)
  writeMonoPcm16(resolve(outputDir, 'whoosh.wav'), 0.55, whoosh())
}

if (import.meta.main) generateBuiltInSfx()
