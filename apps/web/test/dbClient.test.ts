import { afterEach, expect, test, vi } from 'vitest'
import type { Sql } from 'postgres'
import { databaseClient } from '../lib/dbClient'

afterEach(() => {
  delete globalThis.__klipmaticSql
})

test('reuses one database client across repeated module initialization', () => {
  const client = {} as Sql
  const factory = vi.fn(() => client)

  expect(databaseClient(factory, 'postgres://example.test/db')).toBe(client)
  expect(databaseClient(factory, 'postgres://example.test/db')).toBe(client)
  expect(factory).toHaveBeenCalledOnce()
  expect(factory).toHaveBeenCalledWith('postgres://example.test/db', {
    max: 5,
    prepare: false,
    idle_timeout: 20,
  })
})
