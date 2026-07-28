import { describe, expect, test } from 'vitest'
import {
  DEFAULT_EDIT_SPEC,
  captionTokensAt,
  coverCrop,
  normalizeEditSpec,
} from '../src'

describe('normalizeEditSpec', () => {
  test('menghasilkan default lengkap dari input kosong', () => {
    expect(normalizeEditSpec({})).toEqual(DEFAULT_EDIT_SPEC)
  })

  test('menjepit nilai berbahaya dan menolak warna bebas', () => {
    const spec = normalizeEditSpec({
      crop: { focusX: 9, focusY: -3, zoom: 99 },
      captions: { fontSize: 500, positionY: 0, textColor: 'url(javascript:x)' },
    })
    expect(spec.crop).toMatchObject({ focusX: 1, focusY: 0, zoom: 3 })
    expect(spec.captions.fontSize).toBe(140)
    expect(spec.captions.positionY).toBe(0.15)
    expect(spec.captions.textColor).toBe(DEFAULT_EDIT_SPEC.captions.textColor)
  })
})

describe('coverCrop', () => {
  test('video landscape dipotong horizontal menjadi 9:16', () => {
    const crop = coverCrop(1920, 1080, DEFAULT_EDIT_SPEC)
    expect(crop.sh).toBe(1080)
    expect(crop.sw).toBeCloseTo(607.5)
    expect(crop.sx).toBeCloseTo((1920 - 607.5) / 2)
  })

  test('focusX menggeser crop tanpa keluar frame', () => {
    const left = coverCrop(1920, 1080, normalizeEditSpec({ crop: { focusX: 0 } }))
    const right = coverCrop(1920, 1080, normalizeEditSpec({ crop: { focusX: 1 } }))
    expect(left.sx).toBe(0)
    expect(right.sx + right.sw).toBeCloseTo(1920)
  })
})

describe('captionTokensAt', () => {
  const words = [
    { text: 'satu', start: 0, end: 0.5 },
    { text: 'dua', start: 0.5, end: 1 },
    { text: 'tiga', start: 1, end: 1.5 },
  ]

  test('menandai hanya kata aktif', () => {
    const tokens = captionTokensAt(words, 0.7, 5)
    expect(tokens.map((token) => token.text)).toEqual(['satu', 'dua', 'tiga'])
    expect(tokens.map((token) => token.active)).toEqual([false, true, false])
  })

  test('di luar ucapan tidak menampilkan caption', () => {
    expect(captionTokensAt(words, 3, 5)).toEqual([])
  })

  test('jeda panjang memulai grup caption baru', () => {
    const withPause = [...words, { text: 'baru', start: 5, end: 5.5 }]
    expect(captionTokensAt(withPause, 5.2, 5).map((token) => token.text)).toEqual(['baru'])
  })
})
