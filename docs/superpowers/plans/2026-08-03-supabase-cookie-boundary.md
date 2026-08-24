# Supabase Cookie Boundary Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with review checkpoints.

**Goal:** Stop Server Component renders from crashing when Supabase SSR tries to refresh cookies, while persisting refreshed sessions through middleware.

**Architecture:** Keep `supabaseServer()` usable from Server Components, Server Actions, and Route Handlers. Its `setAll` becomes tolerant of the read-only Server Component cookie boundary. Add a Next middleware client that owns session refresh and writes refreshed cookies to the outgoing response.

**Tech Stack:** Next.js 15 App Router, `@supabase/ssr` 0.5.x, TypeScript, Vitest.

## Global Constraints

- Preserve unrelated working-tree changes.
- Do not change login UX, Supabase credentials, auth callback semantics, or database access.
- Production code must be preceded by a failing regression test.
- Run lint/type-check/tests after code changes.

### Task 1: Reproduce the Server Component cookie-write crash

**Files:**
- Create: `apps/web/test/supabaseServer.test.ts`
- Read: `apps/web/lib/supabase/server.ts`

**Interfaces:**
- Consumes: `supabaseServer()` and mocked `next/headers` cookie store.
- Produces: A regression test proving a read-only cookie write must not reject client creation.

- [ ] **Step 1: Write the failing test**

Mock `next/headers.cookies()` to return a store whose `set` method throws Next's read-only cookie error. Mock `createServerClient` so it invokes the supplied `setAll` callback with one rotated cookie, then assert `supabaseServer()` resolves.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `bun x vitest run apps/web/test/supabaseServer.test.ts`

Expected: FAIL because the current `setAll` calls `store.set()` without handling the Server Component error.

### Task 2: Make the shared server client safe across Next contexts

**Files:**
- Modify: `apps/web/lib/supabase/server.ts:1-24`
- Test: `apps/web/test/supabaseServer.test.ts`

**Interfaces:**
- Consumes: The failing cookie-boundary regression test.
- Produces: `supabaseServer()` that still writes cookies where Next permits it and silently ignores the expected read-only boundary during rendering.

- [ ] **Step 1: Implement the minimal safe writer**

Wrap the existing `cookiesToSet.forEach(... store.set(...))` call in `try/catch`. Keep `getAll()` and the existing `CookieOptions` typing unchanged.

- [ ] **Step 2: Run the focused test and verify it passes**

Run: `bun x vitest run apps/web/test/supabaseServer.test.ts`

Expected: PASS with no unhandled cookie exception.

### Task 3: Persist Supabase refresh cookies in middleware

**Files:**
- Create: `apps/web/middleware.ts`
- Create or modify: `apps/web/test/supabaseMiddleware.test.ts`

**Interfaces:**
- Consumes: `NextRequest`, `NextResponse`, Supabase `createServerClient`, and the same public Supabase environment variables.
- Produces: `middleware(request)` that calls `auth.getUser()`, copies refreshed cookies to the response, and skips static assets through `config.matcher`.

- [ ] **Step 1: Write the failing middleware test**

Mock `@supabase/ssr` to invoke the configured `setAll` callback during `auth.getUser()`. Use request/response fakes for `cookies.getAll`, `cookies.set`, and `response.cookies.set`; assert the refreshed cookie is written to both the request snapshot and outgoing response. Import the not-yet-created middleware module so the test fails for the missing implementation.

- [ ] **Step 2: Run the focused middleware test and verify it fails**

Run: `bun x vitest run apps/web/test/supabaseMiddleware.test.ts`

Expected: FAIL because `apps/web/middleware.ts` does not exist yet.

- [ ] **Step 3: Implement middleware session refresh**

Create a Supabase server client using `request.cookies.getAll()`. In `setAll`, update the request cookie snapshot, recreate `NextResponse.next({ request })`, and apply cookie options to `response.cookies.set()`. Await `supabase.auth.getUser()` and return the response. Exclude `_next/static`, `_next/image`, `favicon.ico`, and static image extensions in `config.matcher`.

- [ ] **Step 4: Run the focused middleware test and verify it passes**

Run: `bun x vitest run apps/web/test/supabaseMiddleware.test.ts`

Expected: PASS with the rotated cookie present on the outgoing response.

### Task 4: Validate the complete web change

**Files:**
- Validate: `apps/web/lib/supabase/server.ts`
- Validate: `apps/web/middleware.ts`
- Validate: `apps/web/test/supabaseServer.test.ts`
- Validate: `apps/web/test/supabaseMiddleware.test.ts`

**Interfaces:**
- Consumes: The completed auth cookie boundary implementation.
- Produces: Clean targeted tests, full TypeScript validation, lint/build confidence, and a clean diff limited to the approved scope plus the user's existing edits.

- [ ] **Step 1: Run the auth regression tests**

Run: `bun x vitest run apps/web/test/supabaseServer.test.ts apps/web/test/supabaseMiddleware.test.ts`

- [ ] **Step 2: Run the full test suite**

Run: `bun test`

- [ ] **Step 3: Run web type-check and build**

Run: `bun --cwd=apps/web run typecheck` and `bun --cwd=apps/web run build`

- [ ] **Step 4: Inspect the final diff**

Run: `git diff --check` and `git status --short`; confirm unrelated modified files remain untouched and no secrets are added.
