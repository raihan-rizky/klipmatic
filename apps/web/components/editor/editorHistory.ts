import type { EditSpecV3 } from '@klipmatic/engine'

const HISTORY_LIMIT = 100

export interface EditorHistoryState {
  past: EditSpecV3[]
  present: EditSpecV3
  future: EditSpecV3[]
}

export type EditorHistoryAction =
  | { type: 'push'; spec: EditSpecV3 }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'reset'; spec: EditSpecV3 }

export function createEditorHistory(spec: EditSpecV3): EditorHistoryState {
  return { past: [], present: spec, future: [] }
}

export function editorHistoryReducer(
  state: EditorHistoryState,
  action: EditorHistoryAction,
): EditorHistoryState {
  if (action.type === 'push') {
    if (action.spec === state.present) return state
    return {
      past: [...state.past, state.present].slice(-HISTORY_LIMIT),
      present: action.spec,
      future: [],
    }
  }
  if (action.type === 'undo' && state.past.length > 0) {
    return {
      past: state.past.slice(0, -1),
      present: state.past.at(-1)!,
      future: [state.present, ...state.future],
    }
  }
  if (action.type === 'redo' && state.future.length > 0) {
    return {
      past: [...state.past, state.present].slice(-HISTORY_LIMIT),
      present: state.future[0]!,
      future: state.future.slice(1),
    }
  }
  if (action.type === 'reset') return createEditorHistory(action.spec)
  return state
}
