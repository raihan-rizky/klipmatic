import type { ErrorCode } from './errorCodes'

export type SourceKind = 'youtube' | 'tiktok' | 'gdrive' | 'other'

export interface NormalizedSource {
  kind: SourceKind
  externalId: string
  /**
   * Dugaan awal berdasarkan bentuk URL. Nilai final ditetapkan handler ingest
   * dari metadata yt-dlp (`availability`). Lihat Task 10.
   */
  provisionalPublic: boolean
  urlOriginal: string
}

export class UnsupportedUrlError extends Error {
  readonly code: ErrorCode = 'SOURCE_UNSUPPORTED'
  constructor(raw: string) {
    super(`URL tidak dikenali: ${raw}`)
    this.name = 'UnsupportedUrlError'
  }
}

const YT_ID = /^[A-Za-z0-9_-]{11}$/
const TIKTOK_ID = /^\d{6,25}$/
const GDRIVE_ID = /^[A-Za-z0-9_-]{20,}$/

function parseUrl(raw: string): URL | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    const u = new URL(withScheme)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u : null
  } catch {
    return null
  }
}

function youtubeId(u: URL): string | null {
  const host = u.hostname.replace(/^www\.|^m\./, '')
  if (host === 'youtu.be') {
    return u.pathname.slice(1).split('/')[0] ?? null
  }
  if (host !== 'youtube.com' && host !== 'music.youtube.com') return null
  const v = u.searchParams.get('v')
  if (v) return v
  const segments = u.pathname.split('/').filter(Boolean)
  if (segments.length >= 2 && ['shorts', 'live', 'embed', 'v'].includes(segments[0]!)) {
    return segments[1]!
  }
  return null
}

function tiktokId(u: URL): string | null {
  const host = u.hostname.replace(/^www\./, '')
  // Short link (vm./vt.) memerlukan resolusi HTTP untuk mendapat ID asli.
  // Normalisasi harus murni, jadi bentuk ini ditolak di v1.
  if (host !== 'tiktok.com') return null
  const segments = u.pathname.split('/').filter(Boolean)
  const idx = segments.indexOf('video')
  return idx >= 0 ? (segments[idx + 1] ?? null) : null
}

function gdriveId(u: URL): string | null {
  if (u.hostname.replace(/^www\./, '') !== 'drive.google.com') return null
  const byQuery = u.searchParams.get('id')
  if (byQuery) return byQuery
  const segments = u.pathname.split('/').filter(Boolean)
  const idx = segments.indexOf('d')
  return idx >= 0 ? (segments[idx + 1] ?? null) : null
}

export function normalizeSourceUrl(raw: string): NormalizedSource {
  const u = parseUrl(raw)
  if (!u) throw new UnsupportedUrlError(raw)

  const yt = youtubeId(u)
  if (yt) {
    if (!YT_ID.test(yt)) throw new UnsupportedUrlError(raw)
    return { kind: 'youtube', externalId: yt, provisionalPublic: true, urlOriginal: raw }
  }

  const tt = tiktokId(u)
  if (tt) {
    if (!TIKTOK_ID.test(tt)) throw new UnsupportedUrlError(raw)
    return { kind: 'tiktok', externalId: tt, provisionalPublic: true, urlOriginal: raw }
  }

  const gd = gdriveId(u)
  if (gd) {
    if (!GDRIVE_ID.test(gd)) throw new UnsupportedUrlError(raw)
    return { kind: 'gdrive', externalId: gd, provisionalPublic: false, urlOriginal: raw }
  }

  throw new UnsupportedUrlError(raw)
}
