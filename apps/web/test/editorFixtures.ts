import {
  createDefaultEditSpecV2,
  type EditSpecV2,
  type TimelineContext,
} from '@cheapclipper/engine'
import type { ClipEditorPayload } from '@/lib/clipTypes'

export const editorContext: TimelineContext = {
  candidateDuration: 30,
  sourceId: 'clip-1',
}

export function makeEditorSpec(duration = 30): EditSpecV2 {
  return createDefaultEditSpecV2({
    ...editorContext,
    candidateDuration: duration,
  })
}

export function makeReadyPayload(): ClipEditorPayload {
  return {
    clip: {
      id: 'clip-1',
      projectId: 'project-1',
      candidateId: 'candidate-1',
      title: 'Klip fixture',
      durationSec: 30,
      renderStatus: 'draft',
      editSpec: makeEditorSpec(),
      timingPrecision: 'word',
    },
    words: [{ text: 'halo', start: 1, end: 1.5 }],
    segment: {
      status: 'ready',
      url: '/api/clips/clip-1/segment',
      jobId: null,
      errorCode: null,
    },
  }
}
