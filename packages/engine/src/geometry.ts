import type { EditSpecV1 } from './types'

export interface CropRectangle {
  sx: number
  sy: number
  sw: number
  sh: number
}

export function coverCrop(
  sourceWidth: number,
  sourceHeight: number,
  spec: EditSpecV1,
): CropRectangle {
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return { sx: 0, sy: 0, sw: 1, sh: 1 }
  }
  const targetAspect = spec.output.width / spec.output.height
  const sourceAspect = sourceWidth / sourceHeight
  let sw: number
  let sh: number
  if (sourceAspect > targetAspect) {
    sh = sourceHeight
    sw = sh * targetAspect
  } else {
    sw = sourceWidth
    sh = sw / targetAspect
  }
  sw /= spec.crop.zoom
  sh /= spec.crop.zoom
  return {
    sx: (sourceWidth - sw) * spec.crop.focusX,
    sy: (sourceHeight - sh) * spec.crop.focusY,
    sw,
    sh,
  }
}
