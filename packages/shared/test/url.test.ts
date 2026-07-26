import { describe, expect, test } from 'vitest'
import { normalizeSourceUrl, UnsupportedUrlError } from '../src/url'

describe('YouTube', () => {
  const ID = 'dQw4w9WgXcQ'
  const variants = [
    `https://www.youtube.com/watch?v=${ID}`,
    `https://youtube.com/watch?v=${ID}&t=42s`,
    `https://m.youtube.com/watch?v=${ID}`,
    `https://youtu.be/${ID}`,
    `https://youtu.be/${ID}?t=42`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://www.youtube.com/live/${ID}`,
    `https://www.youtube.com/embed/${ID}`,
    `youtube.com/watch?v=${ID}`,
  ]

  test.each(variants)('semua varian menghasilkan external_id sama: %s', (url) => {
    const r = normalizeSourceUrl(url)
    expect(r.kind).toBe('youtube')
    expect(r.externalId).toBe(ID)
  })

  test('provisionalPublic true', () => {
    expect(normalizeSourceUrl(variants[0]!).provisionalPublic).toBe(true)
  })

  test('menyimpan URL asli apa adanya', () => {
    const url = `https://youtu.be/${ID}?t=42`
    expect(normalizeSourceUrl(url).urlOriginal).toBe(url)
  })

  test('menolak ID dengan panjang salah', () => {
    expect(() => normalizeSourceUrl('https://youtu.be/tooshort')).toThrow(UnsupportedUrlError)
  })
})

describe('TikTok', () => {
  test('URL lengkap', () => {
    const r = normalizeSourceUrl('https://www.tiktok.com/@user/video/7123456789012345678')
    expect(r.kind).toBe('tiktok')
    expect(r.externalId).toBe('7123456789012345678')
    expect(r.provisionalPublic).toBe(true)
  })

  test('menolak short link karena butuh resolusi jaringan', () => {
    expect(() => normalizeSourceUrl('https://vm.tiktok.com/ZSABCDEF/')).toThrow(UnsupportedUrlError)
  })
})

describe('Google Drive', () => {
  const ID = '1A2b3C4d5E6f7G8h9I0jKlMnOpQrStUv'

  test.each([
    `https://drive.google.com/file/d/${ID}/view?usp=sharing`,
    `https://drive.google.com/open?id=${ID}`,
    `https://drive.google.com/uc?id=${ID}&export=download`,
  ])('varian menghasilkan id sama: %s', (url) => {
    const r = normalizeSourceUrl(url)
    expect(r.kind).toBe('gdrive')
    expect(r.externalId).toBe(ID)
  })

  test('gdrive selalu dianggap privat', () => {
    expect(normalizeSourceUrl(`https://drive.google.com/open?id=${ID}`).provisionalPublic).toBe(
      false,
    )
  })
})

describe('penolakan', () => {
  test.each(['', '   ', 'bukan-url', 'ftp://x.com/a', 'https://example.com/video.mp4'])(
    'menolak %s',
    (url) => {
      expect(() => normalizeSourceUrl(url)).toThrow(UnsupportedUrlError)
    },
  )

  test('error membawa kode SOURCE_UNSUPPORTED', () => {
    try {
      normalizeSourceUrl('bukan-url')
      expect.unreachable('seharusnya melempar')
    } catch (e) {
      expect((e as UnsupportedUrlError).code).toBe('SOURCE_UNSUPPORTED')
    }
  })
})
