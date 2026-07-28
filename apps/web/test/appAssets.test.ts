import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test } from 'vitest'

test('ships a brand icon for browser tabs', () => {
  expect(existsSync(resolve(process.cwd(), 'apps/web/app/icon.svg'))).toBe(true)
})
