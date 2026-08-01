export type MediaType = 'image' | 'audio' | 'video'

export const MEDIA_LIMITS: Record<MediaType, number> = {
  image: 10 * 1024 * 1024,
  audio: 25 * 1024 * 1024,
  video: 100 * 1024 * 1024,
}

export const PROJECT_MEDIA_QUOTA_BYTES = 300 * 1024 * 1024

export const ALLOWED_MEDIA_MIME = {
  image: ['image/png', 'image/jpeg', 'image/webp'],
  audio: ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4', 'audio/webm'],
  video: ['video/mp4', 'video/webm', 'video/quicktime'],
} as const
