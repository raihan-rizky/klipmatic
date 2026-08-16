import { expect, test } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { clipCandidates } from '../src/schema'

test('clip candidates expose pre-render preview columns in the Drizzle schema', () => {
  expect(clipCandidates.previewStatus.name).toBe('preview_status')
  expect(clipCandidates.previewR2Key.name).toBe('preview_r2_key')
})

test('preview migration keeps render_previews as an allowed job type', async () => {
  const migration = await readFile(
    resolve(import.meta.dirname, '../migrations/0003_candidate_preview_renders.sql'),
    'utf8',
  )

  expect(migration).toContain("'render_previews'")
})
