import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../app/globals.css', import.meta.url)), 'utf8')

test('motion foundation exposes cinematic hooks and reduced-motion escape hatch', () => {
  expect(css).toContain('@keyframes grid-drift')
  expect(css).toContain('@keyframes cinematic-scan')
  expect(css).toContain('@keyframes signal-sweep')
  expect(css).toContain('.motion-grid')
  expect(css).toContain('.motion-reveal')
  expect(css).toContain('.motion-cta')
  expect(css).toContain('@media (prefers-reduced-motion: reduce)')
  expect(css).toContain('animation: none !important')
})
