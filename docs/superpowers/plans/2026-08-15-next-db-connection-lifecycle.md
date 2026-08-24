# Next.js Database Connection Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent Next.js hot reloads from exhausting the Supabase session-mode connection pool.

**Architecture:** A focused client-lifecycle module owns the process-global Postgres.js client. The existing `db.ts` module keeps exporting the same `sql` interface, but obtains it through that lifecycle boundary with an idle timeout.

**Tech Stack:** TypeScript, Postgres.js 3.4, Next.js 15, Vitest 2.1.

## Global Constraints

- Preserve the existing exported `sql` interface.
- Keep the existing maximum connection count of 5.
- Keep prepared statements disabled.
- Release newly idle sessions after 20 seconds.
- Do not change route or domain-service behavior.

---

### Task 1: Reusable Database Client Lifecycle

**Files:**
- Create: `apps/web/lib/dbClient.ts`
- Modify: `apps/web/lib/db.ts`
- Test: `apps/web/test/dbClient.test.ts`

**Interfaces:**
- Consumes: `postgres(url, options)` from Postgres.js.
- Produces: `databaseClient(factory, url): Sql`, backed by `globalThis.__klipmaticSql`.

- [ ] **Step 1: Write the failing regression test**

```ts
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
```

- [ ] **Step 2: Run the regression test and verify RED**

Run: `bun run test apps/web/test/dbClient.test.ts`

Expected: FAIL because `../lib/dbClient` does not exist.

- [ ] **Step 3: Implement the minimal lifecycle boundary**

```ts
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
```

Update `apps/web/lib/db.ts`:

```ts
import postgres from 'postgres'
import { databaseClient } from './dbClient'

export const sql = databaseClient(postgres, process.env.DATABASE_URL!)
```

- [ ] **Step 4: Run targeted tests and verify GREEN**

Run: `bun run test apps/web/test/dbClient.test.ts apps/web/test/candidateThumbnailRoute.test.ts apps/web/test/clips.test.ts`

Expected: all selected tests pass.

- [ ] **Step 5: Run the complete validation suite**

Run:

```powershell
bun run test
bun run typecheck
bun run build
bun audit --audit-level high
```

Expected: every command exits 0.

- [ ] **Step 6: Restart the current Next.js dev process and verify runtime recovery**

Stop only the process listening for this workspace's dev server, restart it with
`bun run dev`, then request one owned thumbnail and create one clip.

Expected: neither request returns `EMAXCONNSESSION`; the thumbnail reaches R2
and clip creation reaches its transaction.

- [ ] **Step 7: Commit only the lifecycle fix**

```powershell
git add apps/web/lib/dbClient.ts apps/web/lib/db.ts apps/web/test/dbClient.test.ts
git commit -m "fix(web): reuse database client across hot reloads"
```
