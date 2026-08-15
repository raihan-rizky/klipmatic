# Top 10 Candidate Preview

## Context

The project results page currently renders ranked candidate metadata only. A
user must click **Edit klip** before CheapClipper downloads the candidate video
segment, so the user cannot visually compare candidates before committing to
the editor. The source thumbnail already exists in `sources.thumbnail_url`, but
it is shared by every candidate and therefore does not help distinguish the
Top 10 moments.

This change adds a unique thumbnail to each candidate card and a modal video
preview. Thumbnails are prepared before results appear. Full candidate video
segments remain on-demand and reuse the existing clip and `fetch_segments`
pipeline.

## Goals

- Show at most the ten highest-scoring candidates in deterministic rank order.
- Give each candidate a representative, unique 16:9 thumbnail.
- Let users preview the complete candidate range with audio in a modal.
- Keep rank, score, title, hook, reason, and duration visible in the modal.
- Support Previous/Next navigation without fetching unplayed candidates.
- Reuse a prepared preview segment when the user opens the editor.
- Preserve ownership checks, retries, segment retention, and current editor
  behavior.

## Non-goals

- Pre-generating all ten video segments.
- Autoplaying a video after asynchronous preparation.
- Embedding YouTube, TikTok, or Google Drive players.
- Adding a new editing workflow or changing timeline behavior.
- Generating AI-selected thumbnail compositions or text overlays.

## Decisions

### Preview strategy

Opening a preview creates or reuses the candidate's existing draft clip. The
same `fetch_segments` job and `media_segments` row used by the editor prepare
the full candidate range. A candidate can therefore create at most one draft
clip and one active segment job per project, and **Edit clip** navigates to that
same clip.

This deliberately treats the draft clip as the candidate's preview/edit
workspace. A separate preview asset pipeline would duplicate ownership,
polling, retry, storage, and retention logic without improving user-visible
behavior.

### Thumbnail strategy

A new `prepare_thumbnails` job runs after `analyze`. It processes no more than
the ten persisted candidates ordered by score descending and start time
ascending. For each candidate it captures a frame at:

```text
start_sec + min(2 seconds, candidate_duration * 0.20)
```

This avoids many opening black frames while keeping the image representative
of the candidate's beginning. The frame is resized to a bounded 16:9 preview
and encoded as WebP. Exact pixel dimensions and compression quality are
implementation constants covered by output tests, not public API.

The result page waits for `prepare_thumbnails` to reach a terminal state before
reloading. Individual extraction failures do not fail candidate analysis. A
failed candidate uses `sources.thumbnail_url`; if that image is missing or
fails in the browser, the card renders a neutral media placeholder.

The server page also gates results on the latest thumbnail job, not only on
`candidateCount`. This prevents a manual refresh between `analyze` and
`prepare_thumbnails` from revealing the grid early. While the thumbnail job is
queued or running, the page renders pipeline progress. When it is done, failed,
or dead, the page renders results; any candidate still marked `pending` after a
terminal job is treated as `failed` for display and uses the same fallback.

## Data Model

Add these nullable/defaulted columns to `clip_candidates`:

- `thumbnail_status`: `pending | ready | failed`, default `pending`.
- `thumbnail_r2_key`: nullable object key, populated only when status is
  `ready`.

Expand `jobs_type_chk` with `prepare_thumbnails`.

`CandidateView` gains:

- `rank`: one-based rank assigned after the deterministic Top 10 query.
- `thumbnailStatus`.
- `thumbnailUrl`: authenticated candidate thumbnail route when ready, otherwise
  the source thumbnail URL or `null`.

The query keeps its ownership join, orders by score descending then start time
ascending, and applies `limit 10`. Rank is based on this returned order rather
than trusted database input.

## Pipeline And Data Flow

```text
analyze
  -> replace candidate rows
  -> enqueue prepare_thumbnails(project_id, source_id)
  -> analyze completes

prepare_thumbnails
  -> verify project, source, and job ownership context
  -> load the deterministic Top 10
  -> extract and upload each candidate frame
  -> mark each candidate ready or failed
  -> complete job

JobProgress observes prepare_thumbnails terminal state
  -> reload project page
  -> server returns Top 10 with thumbnail URLs/fallbacks

user opens candidate modal
  -> poster and candidate context render immediately
  -> user presses Play
  -> POST /api/clips creates or reuses the draft clip
  -> existing fetch_segments job prepares full candidate range if needed
  -> modal polls lightweight clip preview status
  -> ready state points video at existing same-origin segment route
  -> Edit clip opens the same clip ID
```

`JobProgress` adds a fourth stage, **Siapkan preview**, and includes
`prepare_thumbnails` in its pipeline types. It reloads only when that stage is
done, failed, or dead. A failed/dead thumbnail job still reveals candidates
with fallback images; it does not turn successful analysis into an empty
result.

`projectViewState` therefore receives the latest thumbnail job status in
addition to active pipeline and candidate count. Candidate rows are renderable
only when no thumbnail job is expected for a legacy project or when the latest
thumbnail job is terminal. Legacy projects created before this migration keep
their existing results and use source-thumbnail fallback instead of remaining
stuck behind a missing job.

## Storage And Cleanup

Thumbnail objects use a dedicated prefix and are never exposed through a
permanent public URL. Keys are stored on candidate rows. Before analysis
replaces an existing candidate set, its thumbnail keys are collected for
best-effort deletion after the database update succeeds. Any future explicit
project deletion path must apply the same cleanup. Failed cleanup is logged and
does not roll back a valid analysis result.

Video segments retain the existing seven-day `media_segments` lifecycle. A
cached, unexpired segment makes repeat preview immediate. An expired segment is
prepared again through the same idempotent flow.

## Web API

### Candidate thumbnail

`GET /api/candidates/:id/thumbnail`:

- verifies candidate ownership through its project;
- requires `thumbnail_status = 'ready'` and a key;
- reads the object through a short-lived signed R2 request and proxies it
  same-origin;
- returns 404 for missing, failed, invalid, or unowned candidates;
- returns an image content type and private cache headers appropriate for an
  authenticated asset.

### Clip preview status

Add a lightweight authenticated preview-status endpoint for a clip. It returns
only:

```ts
type ClipPreviewStatus = {
  clipId: string
  status: 'pending' | 'ready' | 'failed'
  url: string | null
  jobId: string | null
  errorCode: string | null
}
```

The ready URL is the existing `/api/clips/:id/segment` route. The endpoint does
not load editor assets, edit specs, or transcript JSON. Ownership rules match
`loadClipEditor` and `loadClipSegment`.

`POST /api/clips` remains the single create/reuse entry point. Concurrent Play
requests must not create duplicate clips or active `fetch_segments` jobs. The
implementation must enforce this at the database/transaction boundary, not
only by disabling the client button.

## Components And Interaction

`CandidateList` becomes the client-owned candidate gallery or delegates its
interactive state to one client child. It owns the active candidate index,
modal state, clip IDs already created during the session, and current preview
request. The server project page still owns authentication and candidate data
loading.

### Candidate card

- Stable 16:9 thumbnail area that cannot resize during load or fallback.
- Centered Play icon button with an accessible label naming the candidate.
- Rank badge at the top-left and duration overlay at the bottom-right.
- Existing score, title, hook, reason, transcript disclosure, and Edit action.
- Clicking the thumbnail or Play button opens the modal; it does not start a
  network-heavy video job until Play is pressed in the modal.

### Preview modal

Use Radix Dialog so focus trapping, Escape handling, accessible naming, and
focus restoration are built into the primitive.

- Header: rank, score, title, and icon-only Close button.
- Media: poster in idle/preparing states and native video controls when ready.
- Context: hook as primary copy and reason as supporting copy.
- Footer: Previous, **Edit clip**, and Next.
- Left/Right arrow keys navigate candidates when focus is not inside a native
  media control.
- Previous is disabled at rank 1; Next is disabled at the last candidate.
- Navigation or close pauses the current video and resets its playback state.
- Moving to another candidate does not prepare video until Play is pressed.
- Async preparation never autoplays. Once ready, the user explicitly starts
  playback so audio is predictable and browser autoplay rules are respected.

Desktop uses a centered 16:9 player with context below it. Mobile uses an
almost full-screen dialog with scrollable context and controls that stay
reachable without overlapping text or media.

## Preview State Machine

- `idle`: poster and Play action.
- `preparing`: poster, progress treatment, disabled duplicate Play action, and
  active Close/Previous/Next actions.
- `ready`: native video controls and enabled Edit action.
- `failed`: actionable message, Retry preview, and Edit action.

Changing candidates aborts client polling for the prior candidate but does not
cancel its server job. Reopening it resumes status lookup. Transient polling
errors retain the last state and retry with bounded backoff; only a terminal job
status enters `failed`.

The modal always pauses and clears the video element when it closes or changes
candidate. This guarantees that only one candidate can produce audio.

## Error Handling

- A failed thumbnail gets source-thumbnail fallback; a failed external image
  gets the neutral placeholder.
- A partial thumbnail batch still marks every candidate `ready` or `failed` so
  no row remains indefinitely pending.
- If the worker dies repeatedly before it can finalize every row, a terminal
  failed/dead job makes remaining `pending` rows display as fallback rather
  than blocking results.
- A terminal segment failure shows Retry and maps its error code through the
  existing user-facing error messages.
- Retry reuses the clip and enqueues a new job only when no queued/running job
  exists and no unexpired segment is available.
- Invalid or unowned IDs return 404 without revealing whether the resource
  belongs to another user.
- Modal failures never remove candidate metadata or block direct editor access.

## Security

- All database reads preserve explicit project-user ownership predicates
  because server and worker connections can bypass RLS.
- R2 keys and signed URLs are not serialized into candidate page props.
- Thumbnail and video bytes are served through authenticated same-origin
  routes.
- Worker payload IDs are untrusted and revalidated against project, source,
  and user relationships before downloads or uploads.
- External fallback thumbnails are display-only and never treated as trusted
  storage input.

## Testing

### Worker tests

- Candidate frame timestamp calculation for short and long candidates.
- Deterministic Top 10 ordering and no processing beyond ten candidates.
- WebP upload and `ready` row update.
- Individual extraction/upload failure and source-thumbnail fallback state.
- Every row reaches `ready` or `failed` after a partial batch.
- Old thumbnail cleanup is attempted only after replacement succeeds.
- Worker registration, job check constraint, retry, and progress updates.

### Data and API tests

- `listCandidates` returns no more than ten ranked rows in stable order.
- A manual refresh during thumbnail preparation stays on pipeline progress;
  terminal success or failure reveals the candidate grid.
- Legacy projects without a thumbnail job remain visible with fallback images.
- Ready thumbnails return bytes only to the owning user.
- Pending, failed, invalid, missing, and unowned thumbnails return 404.
- Preview status does not load transcript/editor payload data.
- Double Play requests reuse one clip and one active segment job.
- Existing unexpired segments return ready immediately.
- Expired segments enqueue a fresh fetch.

### Component tests

- Candidate cards render unique posters, rank, score, hook, and duration.
- Modal receives the exact active candidate context.
- Idle, preparing, ready, polling-retry, and terminal-failure states.
- Retry, Previous/Next buttons, arrow keys, Escape, focus trap, and focus
  restoration.
- Candidate navigation pauses video and does not fetch before Play.
- Only one video can be active.
- Broken thumbnails use the neutral placeholder without layout shift.

### Regression and browser verification

- Existing candidate sorting, transcript accordion, Edit clip, editor segment,
  and refined caption tests remain green.
- Desktop and mobile screenshots verify modal sizing, stable card media,
  readable metadata, and no overlap.
- Keyboard-only verification covers open, navigation, playback controls, Edit,
  and close.

## Acceptance Criteria

Given a project with twelve candidates, the result page shows only ranks 1-10
in deterministic score order. Each card shows its candidate thumbnail or the
defined fallback. Opening rank 3 shows rank 3's score, title, hook, reason, and
duration. Moving to rank 4 does not fetch its video until Play is pressed.

After rank 3's full segment becomes ready, the modal plays it with audio. The
modal does not autoplay after preparation. Clicking **Edit clip** opens the
same clip and segment without a second download job. Closing or navigating
away stops playback. Thumbnail or preview failures remain local to that media
state and never hide the ranked candidate result.
