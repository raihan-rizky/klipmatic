import { expect, test } from 'vitest'
import { PACKAGE_NAME } from '../src/index'

test('paket shared dapat diimpor', () => {
  expect(PACKAGE_NAME).toBe('@klipmatic/shared')
})
