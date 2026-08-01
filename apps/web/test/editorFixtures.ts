import {
  createDefaultEditSpecV3,
  type EditSpecV3,
  type TimelineContext,
} from '@cheapclipper/engine'
import type { ClipEditorPayload } from '@/lib/clipTypes'

export const editorContext: TimelineContext = {
  candidateDuration: 30,
  sourceId: 'clip-1',
  candidateAssetId: 'asset-candidate',
  assets: {
    'asset-candidate': {
      id: 'asset-candidate',
      mediaType: 'video',
      duration: 30,
      width: 1920,
      height: 1080,
      hasAudio: true,
    },
  },
}

export function makeEditorSpec(duration = 30): EditSpecV3 {
  return createDefaultEditSpecV3({
    ...editorContext,
    candidateDuration: duration,
    assets: {
      ...editorContext.assets,
      'asset-candidate': {
        ...editorContext.assets['asset-candidate']!,
        duration,
      },
    },
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
    assets: [{
      id: 'asset-candidate',
      name: 'Klip fixture',
      mediaType: 'video',
      status: 'ready',
      url: '/api/clips/clip-1/segment',
      bytes: 1_000,
      width: 1920,
      height: 1080,
      duration: 30,
      hasAudio: true,
      expiresAt: null,
      expiresSoon: false,
    }],
  }
}
