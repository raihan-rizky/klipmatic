import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

export function getDb(url: string) {
  const client = postgres(url, { max: 10, prepare: false })
  return { db: drizzle(client, { schema }), client }
}
