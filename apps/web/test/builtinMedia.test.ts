import { existsSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import { BUILTIN_MEDIA } from '../lib/builtinMedia'

const PUBLIC_DIR = resolve(import.meta.dirname, '../public')

describe('built-in media catalog', () => {
  test('has unique stable IDs and complete license metadata', () => {
    expect(new Set(BUILTIN_MEDIA.map((asset) => asset.id)).size).toBe(
      BUILTIN_MEDIA.length,
    )

    for (const asset of BUILTIN_MEDIA) {
      expect(asset.id).toMatch(
        /^builtin:(sfx|sticker|photo|background):[a-z0-9-]+$/,
      )
      expect(asset.url).toMatch(/^\/presets\//)
      expect(asset.thumbnailUrl).toMatch(/^\/presets\//)
      expect(asset.license).toMatchObject({ commercialUse: true })
      expect(asset.name.trim()).not.toBe('')
    }
  })

  test('every catalog path exists below public presets', () => {
    for (const asset of BUILTIN_MEDIA) {
      expect(existsSync(resolve(PUBLIC_DIR, asset.url.slice(1)))).toBe(true)
      expect(existsSync(resolve(PUBLIC_DIR, asset.thumbnailUrl.slice(1)))).toBe(
        true,
      )
    }
  })

  test('SVG presets are self-contained and script free', () => {
    const svgs = BUILTIN_MEDIA.filter(
      (asset) => asset.mimeType === 'image/svg+xml',
    )

    for (const asset of svgs) {
      const source = readFileSync(resolve(PUBLIC_DIR, asset.url.slice(1)), 'utf8')
      expect(source).toContain('<svg')
      expect(source).not.toMatch(/<script|javascript:|https?:\/\//i)
      expect(source).toMatch(/viewBox=/)
    }
  })

  test('generated photo presets stay mobile-friendly', () => {
    for (const asset of BUILTIN_MEDIA.filter(
      (item) => item.category === 'photo',
    )) {
      const file = resolve(PUBLIC_DIR, asset.url.slice(1))
      expect(statSync(file).size).toBeLessThanOrEqual(1_500_000)
      expect(asset.width).toBe(1080)
      expect(asset.height).toBe(1920)
    }
  })
})
