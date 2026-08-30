import type { EditSpecV3, TranscriptWord } from '@klipmatic/engine'
import type { MediaAssetDto } from './mediaAssets'

export type ResolvedMediaAsset = MediaAssetDto

export interface ClipPreviewStatus {
  clipId: string
  status: 'pending' | 'rendering' | 'ready' | 'failed'
  url: string | null
  jobId: string | null
  errorCode: string | null
  /** True ketika preview sudah di-render sebagai klip 9:16 oleh worker. */
  prerendered: boolean
}

export interface ClipEditorPayload {
  clip: {
    id: string
    projectId: string
    candidateId: string
    title: string
    durationSec: number
    renderStatus: 'draft' | 'rendering' | 'done' | 'failed'
    editSpec: EditSpecV3
    timingPrecision: 'word' | 'estimated'
  }
  words: TranscriptWord[]
  segment: {
    status: 'pending' | 'ready' | 'failed'
    isFixture?: boolean
    url: string | null
    jobId: string | null
    errorCode: string | null
  }
  assets: ResolvedMediaAsset[]
}
