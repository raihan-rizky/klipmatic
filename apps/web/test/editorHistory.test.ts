import { expect, test } from 'vitest'
import {
  createEditorHistory,
  editorHistoryReducer,
} from '@/components/editor/editorHistory'
import { makeEditorSpec } from './editorFixtures'

const specA = makeEditorSpec()
const specB = { ...specA, crop: { ...specA.crop, focusX: 0.25 } }
const specC = { ...specB, crop: { ...specB.crop, focusX: 0.75 } }

test('push, undo, and redo preserve immutable snapshots', () => {
  const initial = createEditorHistory(specA)
  const edited = editorHistoryReducer(initial, { type: 'push', spec: specB })
  const undone = editorHistoryReducer(edited, { type: 'undo' })
  const redone = editorHistoryReducer(undone, { type: 'redo' })

  expect(undone.present).toEqual(specA)
  expect(redone.present).toEqual(specB)
})

test('a new edit clears the redo stack', () => {
  const state = editorHistoryReducer(
    editorHistoryReducer(
      editorHistoryReducer(
        createEditorHistory(specA),
        { type: 'push', spec: specB },
      ),
      { type: 'undo' },
    ),
    { type: 'push', spec: specC },
  )

  expect(state.present).toEqual(specC)
  expect(state.future).toEqual([])
})
