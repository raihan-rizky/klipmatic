# Preview render MediaPipe runtime fix

## Goal

Make every successfully downloaded candidate preview continue through face focus,
portrait crop, and R2 upload in the downloader worker image.

## Root cause

`render_previews` extracts frames successfully, then MediaPipe initializes its
native bindings. The current Debian worker image does not contain
`libGLESv2.so.2`, so `FaceDetector.create_from_options()` raises `OSError`.
The per-candidate exception handler catches it and marks the preview `failed`.

## Design

1. Install Debian's `libgles2` runtime package in `apps/downloader/Dockerfile`.
   It provides `libGLESv2.so.2`, the native library required by MediaPipe.
2. Add a container-level smoke check that initializes the face detector against
   the vendored model. This protects the actual image boundary rather than only
   the Python code path.
3. Replace the unstructured `log.exception` call in `render_previews` with the
   existing structured observability emitter. Failure events will include the
   candidate ID, stable error code, error class, and safe traceback.

## Non-goals

- Do not alter crop behavior or silently fall back to center cropping.
- Do not change yt-dlp retry or candidate selection behavior.
- Do not expose raw provider stderr, URLs, or filesystem paths in logs.

## Verification

- New regression test fails against the current worker image because the
  detector cannot load `libGLESv2.so.2`.
- After rebuilding, the smoke check initializes the detector successfully.
- The focused downloader test suite remains green and structured failures have
  the expected safe fields.
