export type EditorViewState =
  | 'loading'
  | 'error'
  | 'failed'
  | 'preparing'
  | 'caching'
  | 'ready'

type StatePayload = {
  segment: {
    status: 'pending' | 'ready' | 'failed'
    url: string | null
  }
}

export function editorViewState(
  payload: StatePayload | null,
  spec: object | null,
  mediaUrl: string | null,
  fatalError: string | null,
): EditorViewState {
  if (fatalError && !payload) return 'error'
  if (!payload || !spec) return 'loading'
  if (payload.segment.status === 'failed') return 'failed'
  if (payload.segment.status === 'pending' || !payload.segment.url) return 'preparing'
  if (!mediaUrl) return 'caching'
  return 'ready'
}
