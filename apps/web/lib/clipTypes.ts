import type { EditSpecV3, TranscriptWord } from '@cheapclipper/engine'
import type { MediaAssetDto } from './mediaAssets'

export type ResolvedMediaAsset = MediaAssetDto

export interface ClipPreviewStatus {
  clipId: string
  status: 'pending' | 'ready' | 'failed'
  url: string | null
  jobId: string | null
  errorCode: string | null
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
    url: string | null
    jobId: string | null
    errorCode: string | null
  }
  assets: ResolvedMediaAsset[]
}
