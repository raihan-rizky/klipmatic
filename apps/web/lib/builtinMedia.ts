import type { VisualTransform } from '@klipmatic/engine'
import type { ResolvedMediaAsset } from './clipTypes'

export type BuiltInCategory = 'sfx' | 'sticker' | 'photo' | 'background'

export interface BuiltInMediaAsset extends ResolvedMediaAsset {
  source: 'builtin'
  category: BuiltInCategory
  mimeType: 'audio/wav' | 'image/svg+xml' | 'image/webp'
  url: string
  status: 'ready'
  expiresAt: null
  expiresSoon: false
  thumbnailUrl: string
  license: {
    name: 'Klipmatic Original' | 'OpenAI Generated'
    source: 'project' | 'openai-imagegen'
    commercialUse: true
  }
  defaultTransform?: VisualTransform
}

const visualDefaults: Record<Exclude<BuiltInCategory, 'sfx'>, VisualTransform> = {
  sticker: { x: 0.65, y: 0.08, width: 0.28, height: 0.28 },
  photo: { x: 0.15, y: 0.2, width: 0.7, height: 0.6 },
  background: { x: 0, y: 0, width: 1, height: 1 },
}

const projectLicense = {
  name: 'Klipmatic Original',
  source: 'project',
  commercialUse: true,
} as const

const generatedLicense = {
  name: 'OpenAI Generated',
  source: 'openai-imagegen',
  commercialUse: true,
} as const

function sound(
  slug: string,
  name: string,
  duration: number,
): BuiltInMediaAsset {
  const url = `/presets/sfx/${slug}.wav`
  return {
    id: `builtin:sfx:${slug}`,
    name,
    source: 'builtin',
    category: 'sfx',
    mediaType: 'audio',
    mimeType: 'audio/wav',
    status: 'ready',
    url,
    thumbnailUrl: url,
    bytes: 0,
    width: null,
    height: null,
    duration,
    hasAudio: true,
    expiresAt: null,
    expiresSoon: false,
    license: projectLicense,
  }
}

function visual(
  category: Exclude<BuiltInCategory, 'sfx'>,
  slug: string,
  name: string,
  dimensions: { width: number; height: number },
): BuiltInMediaAsset {
  const extension = category === 'photo' ? 'webp' : 'svg'
  const folder = category === 'sticker' ? 'stickers' : `${category}s`
  const url = `/presets/${folder}/${slug}.${extension}`
  return {
    id: `builtin:${category}:${slug}`,
    name,
    source: 'builtin',
    category,
    mediaType: 'image',
    mimeType: category === 'photo' ? 'image/webp' : 'image/svg+xml',
    status: 'ready',
    url,
    thumbnailUrl: url,
    bytes: 0,
    width: dimensions.width,
    height: dimensions.height,
    duration: null,
    hasAudio: false,
    expiresAt: null,
    expiresSoon: false,
    license: category === 'photo' ? generatedLicense : projectLicense,
    defaultTransform: visualDefaults[category],
  }
}

export const BUILTIN_MEDIA: readonly BuiltInMediaAsset[] = [
  sound('pop', 'Pop', 0.18),
  sound('click', 'Click', 0.08),
  sound('bell', 'Bell', 0.8),
  sound('whoosh', 'Whoosh', 0.55),
  visual('sticker', 'red-arrow', 'Red arrow', { width: 640, height: 480 }),
  visual('sticker', 'highlight-circle', 'Highlight circle', {
    width: 640,
    height: 420,
  }),
  visual('sticker', 'subscribe-badge', 'Subscribe badge', {
    width: 760,
    height: 280,
  }),
  visual('sticker', 'sparkle-callout', 'Sparkle callout', {
    width: 620,
    height: 620,
  }),
  visual('photo', 'city-night', 'City night', { width: 1080, height: 1920 }),
  visual('photo', 'creative-workspace', 'Creative workspace', {
    width: 1080,
    height: 1920,
  }),
  visual('photo', 'mountain-morning', 'Mountain morning', {
    width: 1080,
    height: 1920,
  }),
  visual('photo', 'abstract-neon', 'Abstract neon', {
    width: 1080,
    height: 1920,
  }),
  visual('background', 'sunset-gradient', 'Sunset gradient', {
    width: 1080,
    height: 1920,
  }),
  visual('background', 'dark-grid', 'Dark grid', {
    width: 1080,
    height: 1920,
  }),
]

const BUILTIN_BY_ID = new Map(BUILTIN_MEDIA.map((asset) => [asset.id, asset]))

export function getBuiltInAsset(id: string): BuiltInMediaAsset | undefined {
  return BUILTIN_BY_ID.get(id)
}

export function listBuiltInAssets(
  category?: BuiltInCategory,
): readonly BuiltInMediaAsset[] {
  return category
    ? BUILTIN_MEDIA.filter((asset) => asset.category === category)
    : BUILTIN_MEDIA
}
