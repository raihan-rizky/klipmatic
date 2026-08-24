import type { Options, Sql } from 'postgres'

type PostgresFactory = (url: string, options: Options<Record<string, never>>) => Sql

declare global {
  var __klipmaticSql: Sql | undefined
}

export function databaseClient(factory: PostgresFactory, url: string): Sql {
  globalThis.__klipmaticSql ??= factory(url, {
    max: 5,
    prepare: false,
    idle_timeout: 20,
  })
  return globalThis.__klipmaticSql
}
