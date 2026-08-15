import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test } from 'vitest'

const ROUTES = [
  'app/api/assets/[id]/content/route.ts',
  'app/api/candidates/[id]/thumbnail/route.ts',
  'app/api/clips/route.ts',
  'app/api/clips/[id]/route.ts',
  'app/api/clips/[id]/preview/route.ts',
  'app/api/clips/[id]/segment/route.ts',
  'app/api/keys/route.ts',
  'app/api/keys/[id]/route.ts',
  'app/api/projects/route.ts',
  'app/api/projects/[id]/assets/route.ts',
  'app/api/projects/[id]/assets/[assetId]/route.ts',
  'app/api/projects/[id]/assets/[assetId]/complete/route.ts',
  'app/auth/callback/route.ts',
]

test.each(ROUTES)('%s uses the shared request logger', (route) => {
  const source = readFileSync(resolve(import.meta.dirname, '..', route), 'utf8')
  expect(source).toContain('withRequestLogging')
  expect(source).not.toContain('console.error')
})

test('project server page logs load failures through the shared logger', () => {
  const source = readFileSync(
    resolve(import.meta.dirname, '..', 'app/projects/[id]/page.tsx'),
    'utf8',
  )
  expect(source).toContain("writeEvent('ERROR', 'page.project.failed'")
  expect(source).not.toContain('console.error')
})
