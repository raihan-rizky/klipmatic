# yt-dlp EJS Worker Runtime Design

## Problem

The downloader worker installs FFmpeg at container startup but does not provide
a JavaScript runtime. With `yt-dlp==2026.7.4`, YouTube extraction without a
supported runtime is degraded. The failing project reproduces this as a missing
runtime warning, a Googlevideo HTTP 403, and FFmpeg exit code 1 for every
thumbnail section.

The Python dependency also installs bare `yt-dlp`, so the matching
`yt-dlp-ejs` companion package is not guaranteed to exist. Separately,
per-candidate thumbnail exceptions use ordinary `log.exception`; the safe
structured formatter discards that free-form message and emits an unhelpful
`log.message` event.

## Chosen Approach

Build a dedicated development worker image instead of installing media tools on
every container start. The image will:

- inherit from the existing Python 3.12 `uv` Bookworm image;
- install FFmpeg during image build;
- copy a pinned supported Deno binary from an official Deno image; and
- verify Deno is available while building.

The Compose worker service will build this image and run only
`uv run python -m app.worker`. The Python project will depend on the pinned
`yt-dlp[default]` extra so the compatible EJS package is resolved in `uv.lock`.
Deno needs no yt-dlp command flag because it is the default enabled runtime.

## Failure Classification and Logging

HTTP 403 responses from the media CDN will map to retryable `SOURCE_BLOCKED`
rather than generic `INTERNAL`. A failed candidate will emit a structured
`thumbnail.failed` event containing only safe identifiers, the stable error
code, and exception class. Raw signed media URLs and stderr remain excluded.

The handler keeps its existing best-effort contract: one failed thumbnail does
not cancel the remaining candidates. This change does not redesign job retry or
batch terminal-state semantics.

## Tests

Regression tests will first fail against the current state and then prove:

1. the worker Compose service builds the dedicated Dockerfile and no longer
   installs FFmpeg at runtime;
2. the Dockerfile supplies pinned Deno and validates its availability;
3. the project requests the `yt-dlp[default]` dependency at the existing pinned
   yt-dlp version;
4. yt-dlp HTTP 403 text maps to retryable `SOURCE_BLOCKED`; and
5. candidate failures emit a useful safe structured event.

After unit tests, the worker image will be rebuilt. The exact failing one-second
section will be downloaded inside the rebuilt container to verify the original
403 is gone, followed by the downloader test suite and Ruff validation.

## Scope

This fix changes only worker packaging, yt-dlp dependency/runtime readiness,
403 classification, and thumbnail failure observability. It will preserve all
unrelated working-tree changes and will not alter video format selection,
candidate ranking, storage behavior, or UI behavior.
