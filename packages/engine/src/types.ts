export interface TranscriptWord {
  text: string
  /** Detik relatif terhadap awal media segment. */
  start: number
  end: number
}

export interface EditSpecV1 {
  version: 1
  output: {
    width: 1080
    height: 1920
    frameRate: 30
  }
  crop: {
    mode: 'cover'
    focusX: number
    focusY: number
    zoom: number
  }
  captions: {
    enabled: boolean
    positionY: number
    fontSize: number
    fontFamily: string
    textColor: string
    activeColor: string
    backgroundColor: string
    maxWordsPerLine: number
  }
}

export const DEFAULT_EDIT_SPEC: EditSpecV1 = {
  version: 1,
  output: { width: 1080, height: 1920, frameRate: 30 },
  crop: { mode: 'cover', focusX: 0.5, focusY: 0.5, zoom: 1 },
  captions: {
    enabled: true,
    positionY: 0.78,
    fontSize: 76,
    fontFamily: 'Arial, sans-serif',
    textColor: '#FFFFFF',
    activeColor: '#FFE600',
    backgroundColor: '#000000B3',
    maxWordsPerLine: 5,
  },
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function number(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, min), max) : fallback
}

function color(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value)
    ? value.toUpperCase()
    : fallback
}

export function normalizeEditSpec(input: unknown): EditSpecV1 {
  const root = object(input)
  const crop = object(root.crop)
  const captions = object(root.captions)
  return {
    version: 1,
    output: { ...DEFAULT_EDIT_SPEC.output },
    crop: {
      mode: 'cover',
      focusX: number(crop.focusX, DEFAULT_EDIT_SPEC.crop.focusX, 0, 1),
      focusY: number(crop.focusY, DEFAULT_EDIT_SPEC.crop.focusY, 0, 1),
      zoom: number(crop.zoom, DEFAULT_EDIT_SPEC.crop.zoom, 1, 3),
    },
    captions: {
      enabled:
        typeof captions.enabled === 'boolean'
          ? captions.enabled
          : DEFAULT_EDIT_SPEC.captions.enabled,
      positionY: number(
        captions.positionY,
        DEFAULT_EDIT_SPEC.captions.positionY,
        0.15,
        0.9,
      ),
      fontSize: Math.round(
        number(captions.fontSize, DEFAULT_EDIT_SPEC.captions.fontSize, 32, 140),
      ),
      fontFamily:
        typeof captions.fontFamily === 'string' && captions.fontFamily.trim().length <= 80
          ? captions.fontFamily.trim() || DEFAULT_EDIT_SPEC.captions.fontFamily
          : DEFAULT_EDIT_SPEC.captions.fontFamily,
      textColor: color(captions.textColor, DEFAULT_EDIT_SPEC.captions.textColor),
      activeColor: color(captions.activeColor, DEFAULT_EDIT_SPEC.captions.activeColor),
      backgroundColor: color(
        captions.backgroundColor,
        DEFAULT_EDIT_SPEC.captions.backgroundColor,
      ),
      maxWordsPerLine: Math.round(
        number(
          captions.maxWordsPerLine,
          DEFAULT_EDIT_SPEC.captions.maxWordsPerLine,
          2,
          8,
        ),
      ),
    },
  }
}
