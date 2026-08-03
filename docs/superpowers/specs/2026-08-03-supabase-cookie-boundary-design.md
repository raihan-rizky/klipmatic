# Supabase Cookie Boundary Fix

## Context

`apps/web/lib/supabase/server.ts` is shared by Server Components, Server Actions, and Route Handlers. Supabase SSR may call `setAll` while refreshing a session. Next.js allows cookie writes only from a Server Action or Route Handler, so a Server Component render such as `/login` can currently fail with `Cookies can only be modified...`.

## Design

Keep one shared server client, but make its cookie writer safe in read-only contexts. The `setAll` implementation will attempt to write cookies and ignore the framework error raised when it is invoked during Server Component rendering. This preserves cookie writes in Server Actions and Route Handlers.

Add `apps/web/middleware.ts` as the owner of session refresh. It will create a Supabase server client from the incoming request, call `auth.getUser()`, and copy refreshed cookies onto the outgoing `NextResponse`. The matcher will skip Next internals, favicon, and static image assets.

## Data flow

```text
request
  -> middleware creates Supabase client
  -> auth.getUser() refreshes session when needed
  -> refreshed cookies are copied to NextResponse
  -> Server Component reads cookies without trying to mutate response
```

## Error handling

- A Server Component cookie-write attempt is ignored because middleware owns refresh persistence.
- Cookie writes from Server Actions and Route Handlers continue to propagate normally.
- Auth errors remain handled by the existing login and callback flows; this change does not expose tokens or provider details.

## Testing

Add a regression test for the shared server helper. It will make the mocked Next cookie store throw on `set`, reproduce the Server Component boundary, and assert that creating the Supabase client does not reject. Existing targeted tests, type-checking, linting, and the web build will validate integration.

## Scope

No changes to login UX, Supabase credentials, auth callback semantics, database access, or unrelated working-tree changes.
