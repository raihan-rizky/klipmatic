# Next.js Database Connection Lifecycle Design

## Problem

The web process creates a new Postgres.js client whenever `apps/web/lib/db.ts`
is re-evaluated. During Next.js development hot reloads, older module instances
can retain their connection pools. The Supabase session-mode pool is limited to
15 clients, so repeated compilation eventually rejects every new connection
with `EMAXCONNSESSION` and Postgres code `XX000`.

Both candidate-thumbnail reads and clip creation query Postgres before doing
storage or insert work. Pool exhaustion therefore surfaces as thumbnail `502`
and clip-create `500`, even though neither R2 nor the clip transaction is the
root cause.

## Chosen Approach

Store the Postgres.js client on `globalThis` and reuse it whenever the module is
evaluated again in the same process. Configure an idle timeout so unused
sessions are eventually released instead of living for the full dev-server
lifetime.

Keep the existing exported `sql` interface, connection limit, and disabled
prepared statements. No route or domain-service behavior changes.

## Alternatives Rejected

- Switching immediately to Supabase's transaction pooler would also prevent
  session exhaustion, but requires environment and deployment coordination.
- Restarting the dev server releases leaked sessions once, but does not prevent
  the issue from recurring after more hot reloads.

## Testing

Extract client initialization behind a global cache that can be exercised with
an injected factory. A regression test will initialize the module lifecycle
twice and assert that the factory is called once and the same client is reused.
Existing route, integration, type, lint, audit, and build checks remain the
broader safety net.

## Runtime Recovery

After deploying the code change, restart the current Next.js dev process once
to close pools created by old module instances. Future hot reloads will reuse
the cached client, while idle sessions from the new client can expire.
