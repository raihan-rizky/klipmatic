import type { EditSpecV2, TranscriptWord } from '@cheapclipper/engine'

export interface ClipEditorPayload {
  clip: {
    id: string
    projectId: string
    candidateId: string
    title: string
    durationSec: number
    renderStatus: 'draft' | 'rendering' | 'done' | 'failed'
    editSpec: EditSpecV2
    timingPrecision: 'word' | 'estimated'
  }
  words: TranscriptWord[]
  segment: {
    status: 'pending' | 'ready' | 'failed'
    url: string | null
    jobId: string | null
    errorCode: string | null
  }
}
