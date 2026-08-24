# Video Editor Timeline Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mengubah editor clip menjadi workspace video editor multi-track dengan trim, split, auto-ripple, undo/redo, autosave, playback sinkron, dan export timeline-aware.

**Architecture:** `EditSpecV2` menjadi source of truth tunggal. Pure functions di `@klipmatic/engine` menangani migrasi, normalization, command, ripple, dan time mapping; React hanya mengelola interaction/history/autosave, sedangkan preview dan export mengonsumsi mapping engine yang sama.

**Tech Stack:** TypeScript 5.7, React 19, Next.js 15, Vitest 2, Testing Library, Tailwind CSS 4, Radix Dialog, Mediabunny 1.51, WebCodecs, Web Audio API.

## Global Constraints

- Trim hanya boleh berada di dalam candidate segment yang sudah tersedia.
- Primary video structural edit memakai auto-ripple.
- Full editing harus usable pada desktop, tablet, dan mobile.
- Touch target minimum `44 × 44px`.
- Autosave dimulai setelah user idle sekitar satu detik.
- Undo/redo hanya hidup selama tab aktif dan reset setelah refresh.
- Spec v1 harus terbuka dan bermigrasi tanpa kehilangan crop/caption styling.
- Preview dan export wajib memakai timeline mapping yang sama.
- Fase ini tidak menambah upload, asset library, transitions, effects, keyframes, cloud render, atau realtime collaboration.
- Copy user-facing tetap memakai Bahasa Indonesia.

---

## Planned File Structure

### Engine

- `packages/engine/src/timeline/types.ts`: kontrak v2, commands, dan context.
- `packages/engine/src/timeline/defaults.ts`: factory spec v2 dari candidate.
- `packages/engine/src/timeline/normalize.ts`: migrasi v1 dan normalization v2.
- `packages/engine/src/timeline/commands.ts`: trim, split, delete/ripple, move, dan layer commands.
- `packages/engine/src/timeline/mapping.ts`: output/source mapping serta frame/audio schedules.
- `packages/engine/src/timeline/index.ts`: public timeline exports.
- `packages/engine/test/timelineFixtures.ts`: deterministic timeline fixtures.
- `packages/engine/test/timelineNormalize.test.ts`: migrasi dan validation.
- `packages/engine/test/timelineCommands.test.ts`: command dan ripple.
- `packages/engine/test/timelineMapping.test.ts`: playback/export mapping.

### Web state and persistence

- `apps/web/components/editor/editorHistory.ts`: undo/redo reducer.
- `apps/web/components/editor/useEditorAutosave.ts`: serialized one-second autosave queue.
- `apps/web/test/editorHistory.test.ts`: history behavior.
- `apps/web/test/useEditorAutosave.test.tsx`: debounce, retry, flush, dan unload guard.
- `apps/web/test/editorFixtures.ts`: shared v2 payload dan spec fixtures.
- `apps/web/lib/clipTypes.ts`: payload memakai `EditSpecV2`.
- `apps/web/lib/clips.ts`: normalize v2 berdasarkan candidate duration.
- `apps/web/test/clips.test.ts`: API/data regression untuk v1 dan v2.

### Timeline UI and playback

- `apps/web/components/ui/sheet.tsx`: Radix Dialog bottom sheet.
- `apps/web/components/editor/TimelineEditor.tsx`: timeline coordinator.
- `apps/web/components/editor/TimelineToolbar.tsx`: transport, split, history, zoom, snap.
- `apps/web/components/editor/TimelineTrack.tsx`: row dan layer controls.
- `apps/web/components/editor/TimelineClip.tsx`: clip, selection, drag, trim sliders.
- `apps/web/components/editor/LayerInspector.tsx`: properties desktop/mobile.
- `apps/web/components/editor/TimelinePreview.tsx`: preview canvas dan hidden media pool.
- `apps/web/components/editor/timelinePlayback.ts`: transport controller dan media sync.
- `apps/web/test/TimelineEditor.test.tsx`: pointer/keyboard/accessibility behavior.
- `apps/web/test/timelinePlayback.test.ts`: cut crossing dan stall behavior.

### Workspace and export

- `apps/web/components/ClipEditor.tsx`: orchestrator tipis untuk load, state, autosave, export.
- `apps/web/components/editor/EditorWorkspace.tsx`: responsive preview/inspector/timeline layout.
- `apps/web/components/editor/EditorHeader.tsx`: back, title, save status, export.
- `apps/web/components/editor/EditorActionBar.tsx`: diperkecil menjadi export progress/fallback.
- `apps/web/components/editor/EditorPreview.tsx`: diganti oleh `TimelinePreview`.
- `apps/web/lib/browserExport.ts`: timeline-aware CanvasSource/AudioBufferSource export.
- `apps/web/test/EditorWorkspace.test.tsx`: layout states dan save/export integration.
- `apps/web/test/browserExport.test.ts`: schedule, output duration, dan capability errors.

## Task 1: Add EditSpecV2, deterministic migration, and normalization

**Files:**

- Create: `packages/engine/src/timeline/types.ts`
- Create: `packages/engine/src/timeline/defaults.ts`
- Create: `packages/engine/src/timeline/normalize.ts`
- Create: `packages/engine/src/timeline/index.ts`
- Modify: `packages/engine/src/index.ts`
- Modify: `packages/engine/src/compositor.ts`
- Test: `packages/engine/test/timelineNormalize.test.ts`

**Interfaces:**

- Produces: `EditSpecV2`, `TimelineTrack`, `TimelineClip`, `TimelineCommand`, `TimelineContext`.
- Produces: `createDefaultEditSpecV2(context): EditSpecV2`.
- Produces: `normalizeEditSpecV2(input, context): EditSpecV2`.
- Produces: `drawTimelineComposite(context, layers, spec, words, outputTime): void`.
- Consumes: existing `EditSpecV1`, `normalizeEditSpec`, crop, and caption defaults.

- [ ] **Step 1: Write failing migration and validation tests**

```ts
import { describe, expect, test } from 'vitest'
import {
  normalizeEditSpec,
  normalizeEditSpecV2,
  type TimelineContext,
} from '../src'

const context: TimelineContext = {
  candidateDuration: 30,
  sourceId: 'clip-1',
}

describe('normalizeEditSpecV2', () => {
  test('migrates v1 into linked video audio and caption tracks', () => {
    const legacy = normalizeEditSpec({
      crop: { focusX: 0.25 },
      captions: { fontSize: 88 },
    })
    const spec = normalizeEditSpecV2(legacy, context)

    expect(spec.version).toBe(2)
    expect(spec.crop.focusX).toBe(0.25)
    expect(spec.captions.fontSize).toBe(88)
    expect(spec.timeline.duration).toBe(30)
    expect(spec.timeline.tracks.map((track) => track.type)).toEqual([
      'video',
      'audio',
      'caption',
    ])
    expect(spec.timeline.tracks.flatMap((track) => track.clips))
      .toHaveLength(3)
    expect(new Set(
      spec.timeline.tracks.flatMap((track) =>
        track.clips.map((clip) => clip.linkGroupId),
      ),
    )).toEqual(new Set(['candidate-main']))
  })

  test('clamps source range and recomputes derived duration', () => {
    const spec = normalizeEditSpecV2({
      version: 2,
      timeline: {
        primaryTrackId: 'video',
        duration: 999,
        tracks: [{
          id: 'video',
          type: 'video',
          name: 'Video',
          order: 0,
          hidden: false,
          locked: false,
          clips: [{
            id: 'clip',
            sourceId: 'clip-1',
            linkGroupId: 'candidate-main',
            timelineStart: -4,
            sourceIn: -2,
            sourceOut: 80,
          }],
        }],
      },
    }, context)

    expect(spec.timeline.duration).toBe(30)
    expect(spec.timeline.tracks[0]!.clips[0]).toMatchObject({
      timelineStart: 0,
      sourceIn: 0,
      sourceOut: 30,
    })
  })
})
```

- [ ] **Step 2: Run the new test and verify red state**

Run:

```powershell
bunx vitest run packages/engine/test/timelineNormalize.test.ts
```

Expected: FAIL because timeline modules and exports do not exist.

- [ ] **Step 3: Implement v2 contracts and deterministic defaults**

```ts
export type TrackType = 'video' | 'audio' | 'caption'

export interface TimelineClip {
  id: string
  sourceId: string
  linkGroupId?: string
  timelineStart: number
  sourceIn: number
  sourceOut: number
}

export interface TimelineTrack {
  id: string
  type: TrackType
  name: string
  order: number
  hidden: boolean
  locked: boolean
  clips: TimelineClip[]
}

export interface TimelineContext {
  candidateDuration: number
  sourceId: string
}

export interface EditSpecV2 {
  version: 2
  output: EditSpecV1['output']
  crop: EditSpecV1['crop']
  captions: EditSpecV1['captions']
  timeline: {
    primaryTrackId: string
    duration: number
    tracks: TimelineTrack[]
  }
}
```

Implement `createDefaultEditSpecV2` with stable IDs:

```ts
export function createDefaultEditSpecV2(
  context: TimelineContext,
  legacy: EditSpecV1 = DEFAULT_EDIT_SPEC,
): EditSpecV2 {
  const makeTrack = (
    type: TrackType,
    order: number,
    clip: TimelineClip,
  ): TimelineTrack => ({
    id: `${context.sourceId}:${type}`,
    type,
    name: type === 'video' ? 'Video' : type === 'audio' ? 'Audio' : 'Caption',
    order,
    hidden: false,
    locked: false,
    clips: [clip],
  })
  const linkedClip = (suffix: string): TimelineClip => ({
    id: `${context.sourceId}:${suffix}:clip`,
    sourceId: context.sourceId,
    linkGroupId: 'candidate-main',
    timelineStart: 0,
    sourceIn: 0,
    sourceOut: context.candidateDuration,
  })

  return {
    version: 2,
    output: legacy.output,
    crop: legacy.crop,
    captions: legacy.captions,
    timeline: {
      primaryTrackId: `${context.sourceId}:video`,
      duration: context.candidateDuration,
      tracks: [
        makeTrack('video', 0, linkedClip('video')),
        makeTrack('audio', 1, linkedClip('audio')),
        makeTrack('caption', 2, linkedClip('caption')),
      ],
    },
  }
}
```

- [ ] **Step 4: Implement normalization and compositor structural compatibility**

```ts
export function normalizeEditSpecV2(
  input: unknown,
  context: TimelineContext,
): EditSpecV2 {
  if (!isVersionTwo(input)) {
    return createDefaultEditSpecV2(context, normalizeEditSpec(input))
  }

  const tracks = normalizeTracks(input.timeline?.tracks, context)
  const primary = selectValidPrimaryTrack(
    tracks,
    input.timeline?.primaryTrackId,
    context,
  )
  const normalized = normalizeEditSpec(input)

  return {
    version: 2,
    output: normalized.output,
    crop: normalized.crop,
    captions: normalized.captions,
    timeline: {
      primaryTrackId: primary.id,
      duration: primary.clips.reduce(
        (end, clip) =>
          Math.max(end, clip.timelineStart + clip.sourceOut - clip.sourceIn),
        0,
      ),
      tracks,
    },
  }
}
```

Change `drawCompositeFrame` to consume a narrow `CompositeSpec` containing
`output`, `crop`, and `captions`, so both v1 and v2 remain structurally valid.
Factor the canvas behavior into:

```ts
export function drawTimelineComposite(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  layers: Array<{ media: CanvasImageSource & DrawableMedia; order: number }>,
  spec: CompositeSpec,
  words: TranscriptWord[],
  outputTime: number,
): void {
  clearOutput(context, spec.output)
  for (const layer of [...layers].sort((a, b) => a.order - b.order)) {
    drawVisualLayer(context, layer.media, spec)
  }
  drawCaptions(context, spec, words, outputTime)
}
```

- [ ] **Step 5: Run engine regression and typecheck**

Run:

```powershell
bunx vitest run packages/engine/test/timelineNormalize.test.ts packages/engine/test/engine.test.ts
bun --cwd=packages/engine run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit task 1**

```powershell
git add packages/engine/src/compositor.ts packages/engine/src/index.ts packages/engine/src/timeline/types.ts packages/engine/src/timeline/defaults.ts packages/engine/src/timeline/normalize.ts packages/engine/src/timeline/index.ts packages/engine/test/timelineNormalize.test.ts
git commit -m "feat(engine): add timeline edit spec v2"
```

## Task 2: Implement timeline commands, ripple, and shared time mapping

**Files:**

- Create: `packages/engine/src/timeline/commands.ts`
- Create: `packages/engine/src/timeline/mapping.ts`
- Create: `packages/engine/test/timelineFixtures.ts`
- Modify: `packages/engine/src/timeline/types.ts`
- Modify: `packages/engine/src/timeline/index.ts`
- Test: `packages/engine/test/timelineCommands.test.ts`
- Test: `packages/engine/test/timelineMapping.test.ts`

**Interfaces:**

- Consumes: `EditSpecV2`, `TimelineContext`.
- Produces: `applyTimelineCommand(spec, command, context): EditSpecV2`.
- Produces: `mapOutputTime(spec, outputTime): ActiveTimelineItem[]`.
- Produces: `buildFrameSchedule(spec): FrameScheduleItem[]`.
- Produces: `buildAudioSchedule(spec): AudioScheduleItem[]`.
- Produces: `mapWordsToTimeline(words, spec): TranscriptWord[]`.

- [ ] **Step 1: Write failing trim, split, ripple, lock, and mapping tests**

```ts
import {
  context,
  primaryClip,
  primaryTrack,
  spec,
  withTrack,
} from './timelineFixtures'

test('deleting a primary range ripples linked tracks', () => {
  const split = applyTimelineCommand(spec, {
    type: 'splitClip',
    trackId: spec.timeline.primaryTrackId,
    clipId: primaryClip.id,
    outputTime: 10,
  }, context)
  const right = split.timeline.tracks[0]!.clips[1]!
  const result = applyTimelineCommand(split, {
    type: 'deleteClip',
    trackId: split.timeline.primaryTrackId,
    clipId: right.id,
  }, context)

  expect(result.timeline.duration).toBe(10)
  expect(result.timeline.tracks
    .filter((track) => track.type !== 'video')
    .every((track) => track.clips.every((clip) =>
      clip.timelineStart + clip.sourceOut - clip.sourceIn <= 10,
    ))).toBe(true)
})

test('locked track rejects trim', () => {
  const locked = withTrack(spec, primaryTrack.id, { locked: true })
  expect(applyTimelineCommand(locked, {
    type: 'trimClip',
    trackId: primaryTrack.id,
    clipId: primaryClip.id,
    edge: 'start',
    sourceTime: 4,
  }, context)).toEqual(locked)
})

test('maps output time through a trimmed clip', () => {
  const trimmed = applyTimelineCommand(spec, {
    type: 'trimClip',
    trackId: primaryTrack.id,
    clipId: primaryClip.id,
    edge: 'start',
    sourceTime: 4,
  }, context)

  expect(mapOutputTime(trimmed, 7)[0]).toMatchObject({
    sourceTime: 11,
    outputTime: 7,
  })
})

test('builds gapless linked audio ranges after ripple', () => {
  const splitAtTen = applyTimelineCommand(spec, {
    type: 'splitClip',
    trackId: primaryTrack.id,
    clipId: primaryClip.id,
    outputTime: 10,
  }, context)
  const middleClip = splitAtTen.timeline.tracks[0]!.clips[1]!
  const splitAtTwenty = applyTimelineCommand(splitAtTen, {
    type: 'splitClip',
    trackId: primaryTrack.id,
    clipId: middleClip.id,
    outputTime: 20,
  }, context)
  const rippleSpec = applyTimelineCommand(splitAtTwenty, {
    type: 'deleteClip',
    trackId: primaryTrack.id,
    clipId: splitAtTwenty.timeline.tracks[0]!.clips[1]!.id,
  }, context)
  const schedule = buildAudioSchedule(rippleSpec)
  expect(schedule.map((item) => ({
    outputStart: item.outputStart,
    sourceIn: item.sourceIn,
    sourceOut: item.sourceOut,
  }))).toEqual([
    { outputStart: 0, sourceIn: 0, sourceOut: 10 },
    { outputStart: 10, sourceIn: 20, sourceOut: 30 },
  ])
})
```

Create the fixture with exported, concrete values:

```ts
export const context: TimelineContext = {
  candidateDuration: 30,
  sourceId: 'clip-1',
}
export const spec = createDefaultEditSpecV2(context)
export const primaryTrack = spec.timeline.tracks.find(
  (track) => track.id === spec.timeline.primaryTrackId,
)!
export const primaryClip = primaryTrack.clips[0]!
export function withTrack(
  input: EditSpecV2,
  trackId: string,
  patch: Partial<TimelineTrack>,
): EditSpecV2 {
  return {
    ...input,
    timeline: {
      ...input.timeline,
      tracks: input.timeline.tracks.map((track) =>
        track.id === trackId ? { ...track, ...patch } : track,
      ),
    },
  }
}
```

- [ ] **Step 2: Verify command tests fail**

Run:

```powershell
bunx vitest run packages/engine/test/timelineCommands.test.ts packages/engine/test/timelineMapping.test.ts
```

Expected: FAIL because command and mapping functions do not exist.

- [ ] **Step 3: Implement the command union and immutable dispatcher**

```ts
export type TimelineCommand =
  | { type: 'trimClip'; trackId: string; clipId: string; edge: 'start' | 'end'; sourceTime: number }
  | { type: 'splitClip'; trackId: string; clipId: string; outputTime: number }
  | { type: 'deleteClip'; trackId: string; clipId: string }
  | { type: 'moveClip'; trackId: string; clipId: string; timelineStart: number }
  | { type: 'addTrack'; trackType: TrackType; id: string; name: string }
  | { type: 'renameTrack'; trackId: string; name: string }
  | { type: 'reorderTrack'; trackId: string; order: number }
  | { type: 'setTrackHidden'; trackId: string; hidden: boolean }
  | { type: 'setTrackLocked'; trackId: string; locked: boolean }
  | { type: 'duplicateTrack'; trackId: string; newTrackId: string; clipIds: string[] }
  | { type: 'deleteTrack'; trackId: string }
  | { type: 'setPrimaryTrack'; trackId: string }
  | { type: 'updateCrop'; crop: Partial<EditSpecV2['crop']> }
  | { type: 'updateCaptions'; captions: Partial<EditSpecV2['captions']> }

export function applyTimelineCommand(
  spec: EditSpecV2,
  command: TimelineCommand,
  context: TimelineContext,
): EditSpecV2 {
  const changed = commandReducer(spec, command)
  return changed === spec ? spec : normalizeEditSpecV2(changed, context)
}
```

Implement split with matching `linkGroupId` propagation and one-frame minimum.
Implement delete ripple only when the deleted clip belongs to
`primaryTrackId`; non-primary deletion must leave primary duration unchanged.

- [ ] **Step 4: Implement shared output/source mapping**

```ts
export function mapOutputTime(
  spec: EditSpecV2,
  outputTime: number,
): ActiveTimelineItem[] {
  return spec.timeline.tracks
    .filter((track) => !track.hidden)
    .flatMap((track) =>
      track.clips.flatMap((clip) => {
        const duration = clip.sourceOut - clip.sourceIn
        if (
          outputTime < clip.timelineStart ||
          outputTime >= clip.timelineStart + duration
        ) return []
        return [{
          trackId: track.id,
          trackType: track.type,
          clipId: clip.id,
          sourceId: clip.sourceId,
          outputTime,
          sourceTime: clip.sourceIn + outputTime - clip.timelineStart,
          order: track.order,
        }]
      }),
    )
    .sort((left, right) => left.order - right.order)
}
```

`buildFrameSchedule` must produce exactly
`Math.ceil(duration * frameRate)` items with timestamps `frame / frameRate`.
`buildAudioSchedule` must return visible audio ranges ordered by
`timelineStart`, clipped to timeline duration, and without adding gaps.
`mapWordsToTimeline` must clip and rebase words for every visible caption clip.

- [ ] **Step 5: Run all engine tests and typecheck**

Run:

```powershell
bunx vitest run packages/engine/test
bun --cwd=packages/engine run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit task 2**

```powershell
git add packages/engine/src/timeline/types.ts packages/engine/src/timeline/commands.ts packages/engine/src/timeline/mapping.ts packages/engine/src/timeline/index.ts packages/engine/test/timelineFixtures.ts packages/engine/test/timelineCommands.test.ts packages/engine/test/timelineMapping.test.ts
git commit -m "feat(engine): add timeline editing commands"
```

## Task 3: Persist and serve normalized EditSpecV2

**Files:**

- Modify: `apps/web/lib/clipTypes.ts`
- Modify: `apps/web/lib/clips.ts`
- Modify: `apps/web/app/api/clips/[id]/route.ts`
- Test: `apps/web/test/clips.test.ts`

**Interfaces:**

- Consumes: `normalizeEditSpecV2(input, { candidateDuration, sourceId })`.
- Produces: `ClipEditorPayload.clip.editSpec: EditSpecV2`.
- Produces: `updateClip(...): { editSpec: EditSpecV2; renderStatus: string }`.

- [ ] **Step 1: Update data tests to expect v2 load, migration, and save**

```ts
test('editor migrates stored v1 into normalized v2', async () => {
  await sql`
    update clips
       set edit_spec = ${sql.json(DEFAULT_EDIT_SPEC)}
     where id = ${clipId}`

  const payload = await loadClipEditor(sql, alice, clipId)
  expect(payload.clip.editSpec.version).toBe(2)
  expect(payload.clip.editSpec.timeline.duration).toBe(70)
  expect(payload.clip.editSpec.timeline.tracks).toHaveLength(3)
})

test('update rejects out-of-candidate timeline values through normalization', async () => {
  const payload = await loadClipEditor(sql, alice, clipId)
  const result = await updateClip(sql, alice, clipId, {
    editSpec: {
      ...payload.clip.editSpec,
      timeline: {
        ...payload.clip.editSpec.timeline,
        duration: 999,
        tracks: payload.clip.editSpec.timeline.tracks.map((track, index) =>
          index === 0
            ? {
                ...track,
                clips: track.clips.map((clip) => ({
                  ...clip,
                  sourceOut: 999,
                })),
              }
            : track,
        ),
      },
    },
  })
  expect(result.editSpec.timeline.duration).toBe(70)
})
```

- [ ] **Step 2: Run the focused database test**

Run:

```powershell
bunx vitest run apps/web/test/clips.test.ts
```

Expected: FAIL because the payload still returns v1.

- [ ] **Step 3: Normalize with candidate context on load and update**

Change the owned clip query used by update to also return candidate start/end.
Build one helper and use it in both code paths:

```ts
function timelineContext(row: {
  id: unknown
  start_sec: unknown
  end_sec: unknown
}): TimelineContext {
  return {
    sourceId: String(row.id),
    candidateDuration: Number(row.end_sec) - Number(row.start_sec),
  }
}

const editSpec = normalizeEditSpecV2(row.edit_spec, timelineContext(row))
```

Keep ownership filtering in SQL before normalization and storage access.
No database migration is needed because `clips.edit_spec` is already JSONB.

- [ ] **Step 4: Run API/data regression**

Run:

```powershell
bunx vitest run apps/web/test/clips.test.ts apps/web/test/segmentRoute.test.ts
bun --cwd=apps/web run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit task 3**

```powershell
git add apps/web/lib/clipTypes.ts apps/web/lib/clips.ts apps/web/app/api/clips/[id]/route.ts apps/web/test/clips.test.ts
git commit -m "feat(web): persist timeline edit specs"
```

## Task 4: Add undo/redo history and serialized autosave

**Files:**

- Create: `apps/web/components/editor/editorHistory.ts`
- Create: `apps/web/components/editor/useEditorAutosave.ts`
- Create: `apps/web/test/editorFixtures.ts`
- Test: `apps/web/test/editorHistory.test.ts`
- Test: `apps/web/test/useEditorAutosave.test.tsx`

**Interfaces:**

- Produces: `editorHistoryReducer(state, action): EditorHistoryState`.
- Produces: `useEditorAutosave({ clipId, spec, delayMs }): AutosaveController`.
- Produces: `AutosaveController = { status, error, retry, flush }`.

- [ ] **Step 1: Write failing history tests**

```ts
import { makeEditorSpec } from './editorFixtures'

const specA = makeEditorSpec(30)
const specB = {
  ...specA,
  crop: { ...specA.crop, focusX: 0.25 },
}
const specC = {
  ...specB,
  crop: { ...specB.crop, focusX: 0.75 },
}

test('push, undo, and redo preserve normalized snapshots', () => {
  const initial = createHistory(specA)
  const edited = editorHistoryReducer(initial, { type: 'push', spec: specB })
  const undone = editorHistoryReducer(edited, { type: 'undo' })
  const redone = editorHistoryReducer(undone, { type: 'redo' })

  expect(undone.present).toEqual(specA)
  expect(redone.present).toEqual(specB)
})

test('new edit clears redo stack', () => {
  const undone = editorHistoryReducer(
    editorHistoryReducer(
      editorHistoryReducer(createHistory(specA), { type: 'push', spec: specB }),
      { type: 'undo' },
    ),
    { type: 'push', spec: specC },
  )
  expect(undone.future).toEqual([])
})
```

- [ ] **Step 2: Write failing autosave tests with fake timers**

```tsx
test('serializes saves and flushes the newest snapshot', async () => {
  function deferred<T>() {
    let resolve!: (value: T) => void
    const promise = new Promise<T>((done) => { resolve = done })
    return { promise, resolve }
  }

  vi.useFakeTimers()
  const first = deferred<Response>()
  const fetchMock = vi.fn()
    .mockReturnValueOnce(first.promise)
    .mockResolvedValueOnce(new Response('{}', { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)

  const { rerender, result } = renderHook(
    ({ spec }) => useEditorAutosave({ clipId: 'clip-1', spec, delayMs: 1000 }),
    { initialProps: { spec: specA } },
  )
  rerender({ spec: specB })
  await vi.advanceTimersByTimeAsync(1000)
  rerender({ spec: specC })
  first.resolve(new Response('{}', { status: 200 }))
  await act(() => result.current.flush())

  expect(fetchMock).toHaveBeenCalledTimes(2)
  expect(JSON.parse(fetchMock.mock.calls[1]![1].body).editSpec).toEqual(specC)
  expect(result.current.status).toBe('saved')
})
```

- [ ] **Step 3: Implement bounded history reducer**

```ts
const HISTORY_LIMIT = 100

export function editorHistoryReducer(
  state: EditorHistoryState,
  action: EditorHistoryAction,
): EditorHistoryState {
  if (action.type === 'push') {
    if (action.spec === state.present) return state
    return {
      past: [...state.past, state.present].slice(-HISTORY_LIMIT),
      present: action.spec,
      future: [],
    }
  }
  if (action.type === 'undo' && state.past.length > 0) {
    return {
      past: state.past.slice(0, -1),
      present: state.past.at(-1)!,
      future: [state.present, ...state.future],
    }
  }
  if (action.type === 'redo' && state.future.length > 0) {
    return {
      past: [...state.past, state.present].slice(-HISTORY_LIMIT),
      present: state.future[0]!,
      future: state.future.slice(1),
    }
  }
  if (action.type === 'reset') return createHistory(action.spec)
  return state
}
```

- [ ] **Step 4: Implement debounced serialized autosave**

Use refs for `latest`, `saved`, and `inFlight`. `flush()` loops until the saved
snapshot equals the latest snapshot:

```ts
const flush = useCallback(async () => {
  if (inFlight.current) return inFlight.current
  inFlight.current = (async () => {
    while (saved.current !== latest.current) {
      const snapshot = latest.current
      setStatus('saving')
      const response = await fetch(`/api/clips/${clipId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ editSpec: snapshot, renderStatus: 'draft' }),
      })
      if (!response.ok) throw new Error('Perubahan gagal disimpan.')
      saved.current = snapshot
    }
    setStatus('saved')
  })()
  try {
    await inFlight.current
  } catch (cause) {
    setStatus('error')
    setError(cause instanceof Error ? cause.message : 'Perubahan gagal disimpan.')
    throw cause
  } finally {
    inFlight.current = null
  }
}, [clipId])
```

Register `beforeunload` only while status is `unsaved`, `saving`, or `error`.

Create shared fixtures without network or database dependencies:

```ts
export const editorContext: TimelineContext = {
  candidateDuration: 30,
  sourceId: 'clip-1',
}
export function makeEditorSpec(duration = 30): EditSpecV2 {
  return createDefaultEditSpecV2({
    ...editorContext,
    candidateDuration: duration,
  })
}
export function makeReadyPayload(): ClipEditorPayload {
  return {
    clip: {
      id: 'clip-1',
      projectId: 'project-1',
      candidateId: 'candidate-1',
      title: 'Klip fixture',
      durationSec: 30,
      renderStatus: 'draft',
      editSpec: makeEditorSpec(),
      timingPrecision: 'word',
    },
    words: [{ text: 'halo', start: 1, end: 1.5 }],
    segment: {
      status: 'ready',
      url: '/api/clips/clip-1/segment',
      jobId: null,
      errorCode: null,
    },
  }
}
```

- [ ] **Step 5: Run state tests and web typecheck**

Run:

```powershell
bunx vitest run apps/web/test/editorHistory.test.ts apps/web/test/useEditorAutosave.test.tsx
bun --cwd=apps/web run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit task 4**

```powershell
git add apps/web/components/editor/editorHistory.ts apps/web/components/editor/useEditorAutosave.ts apps/web/test/editorFixtures.ts apps/web/test/editorHistory.test.ts apps/web/test/useEditorAutosave.test.tsx
git commit -m "feat(web): add editor history and autosave"
```

## Task 5: Build accessible timeline components and mobile sheet

**Files:**

- Modify: `apps/web/package.json`
- Modify: `bun.lock`
- Create: `apps/web/components/ui/sheet.tsx`
- Create: `apps/web/components/editor/TimelineToolbar.tsx`
- Create: `apps/web/components/editor/TimelineClip.tsx`
- Create: `apps/web/components/editor/TimelineTrack.tsx`
- Create: `apps/web/components/editor/TimelineEditor.tsx`
- Create: `apps/web/components/editor/LayerInspector.tsx`
- Test: `apps/web/test/TimelineEditor.test.tsx`

**Interfaces:**

- Consumes: `EditSpecV2`, `TimelineCommand`, `TranscriptWord[]`.
- Produces: `onCommand(command: TimelineCommand): void`.
- Produces: selection `{ trackId: string; clipId?: string } | null`.

- [ ] **Step 1: Install Radix Dialog for the non-destructive mobile sheet**

Run:

```powershell
bun --cwd=apps/web add @radix-ui/react-dialog@^1.1.15
```

Expected: `apps/web/package.json` and `bun.lock` change.

- [ ] **Step 2: Write failing accessible timeline tests**

```tsx
const spec = makeEditorSpec()
const onCommand = vi.fn()
const props = {
  spec,
  candidateDuration: 30,
  playhead: 10,
  selected: {
    trackId: spec.timeline.primaryTrackId,
    clipId: spec.timeline.tracks[0]!.clips[0]!.id,
  },
  onPlayheadChange: vi.fn(),
  onSelectionChange: vi.fn(),
  onCommand,
  canUndo: false,
  canRedo: false,
  onUndo: vi.fn(),
  onRedo: vi.fn(),
}
const lockedProps = {
  ...props,
  spec: {
    ...spec,
    timeline: {
      ...spec.timeline,
      tracks: spec.timeline.tracks.map((track) =>
        track.id === spec.timeline.primaryTrackId
          ? { ...track, locked: true }
          : track,
      ),
    },
  },
}

test('trim handles expose numeric slider alternatives', () => {
  render(<TimelineEditor {...props} />)

  expect(screen.getByRole('slider', { name: 'Trim awal Video' }))
    .toHaveAttribute('aria-valuemin', '0')
  expect(screen.getByRole('slider', { name: 'Trim akhir Video' }))
    .toHaveAttribute('aria-valuemax', '30')
})

test('locked track disables destructive actions', async () => {
  render(<TimelineEditor {...lockedProps} />)
  await userEvent.click(screen.getByText('Video'))

  expect(screen.getByRole('button', { name: 'Split' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Hapus' })).toBeDisabled()
})

test('keyboard shortcut dispatches split at playhead', async () => {
  render(<TimelineEditor {...props} playhead={10} />)
  await userEvent.keyboard('s')
  expect(props.onCommand).toHaveBeenCalledWith(expect.objectContaining({
    type: 'splitClip',
    outputTime: 10,
  }))
})
```

- [ ] **Step 3: Verify timeline component tests fail**

Run:

```powershell
bunx vitest run apps/web/test/TimelineEditor.test.tsx
```

Expected: FAIL because timeline components do not exist.

- [ ] **Step 4: Implement Sheet and timeline component contracts**

`Sheet` wraps Radix Dialog with a bottom-anchored content panel. `TimelineClip`
uses pointer capture and keeps the accessible range inputs as the semantic
controls:

```tsx
<input
  type="range"
  aria-label={`Trim awal ${track.name}`}
  min={0}
  max={candidateDuration}
  step={1 / spec.output.frameRate}
  value={clip.sourceIn}
  disabled={track.locked}
  onChange={(event) => onCommand({
    type: 'trimClip',
    trackId: track.id,
    clipId: clip.id,
    edge: 'start',
    sourceTime: Number(event.currentTarget.value),
  })}
/>
```

Pointer drag converts pixels through
`seconds = pixels / pixelsPerSecond`; snapping chooses the closest clip edge
or playhead within eight CSS pixels.

- [ ] **Step 5: Implement layer actions and primary-track guard**

```tsx
<Button
  type="button"
  variant="ghost"
  aria-pressed={track.locked}
  aria-label={track.locked ? `Buka kunci ${track.name}` : `Kunci ${track.name}`}
  onClick={() => onCommand({
    type: 'setTrackLocked',
    trackId: track.id,
    locked: !track.locked,
  })}
>
  {track.locked ? <Lock /> : <Unlock />}
</Button>
```

Disable deleting the final video track and show:
`"Buat video layer lain sebelum menghapus primary layer."`

- [ ] **Step 6: Run timeline tests, all web component tests, and typecheck**

Run:

```powershell
bunx vitest run apps/web/test/TimelineEditor.test.tsx apps/web/test/EditorControls.test.tsx
bun --cwd=apps/web run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit task 5**

```powershell
git add apps/web/package.json bun.lock apps/web/components/ui/sheet.tsx apps/web/components/editor/TimelineToolbar.tsx apps/web/components/editor/TimelineClip.tsx apps/web/components/editor/TimelineTrack.tsx apps/web/components/editor/TimelineEditor.tsx apps/web/components/editor/LayerInspector.tsx apps/web/test/TimelineEditor.test.tsx
git commit -m "feat(web): add responsive timeline controls"
```

## Task 6: Add timeline playback controller and canvas preview

**Files:**

- Create: `apps/web/components/editor/timelinePlayback.ts`
- Create: `apps/web/components/editor/TimelinePreview.tsx`
- Test: `apps/web/test/timelinePlayback.test.ts`
- Modify: `apps/web/test/EditorControls.test.tsx`

**Interfaces:**

- Consumes: `mapOutputTime(spec, playhead)`.
- Produces: `createTimelinePlaybackController(options): TimelinePlaybackController`.
- Produces: controller methods `play()`, `pause()`, `seek(outputTime)`, `dispose()`.
- Produces: controller callbacks `onTime`, `onFrame`, `onStall`.

- [ ] **Step 1: Write failing playback transition tests**

```ts
const spec = makeEditorSpec()
const cutSpec = normalizeEditSpecV2({
  ...spec,
  timeline: {
    ...spec.timeline,
    tracks: spec.timeline.tracks.map((track) =>
      track.id === spec.timeline.primaryTrackId
        ? {
            ...track,
            clips: [
              { ...track.clips[0]!, id: 'left', sourceOut: 10 },
              {
                ...track.clips[0]!,
                id: 'right',
                timelineStart: 10,
                sourceIn: 20,
                sourceOut: 30,
              },
            ],
          }
        : track,
    ),
  },
}, editorContext)

interface PlaybackMedia {
  currentTime: number
  paused: boolean
  muted: boolean
  play(): Promise<void>
  pause(): void
}

function fakeMediaElement(fails = false): PlaybackMedia {
  return {
    currentTime: 0,
    paused: true,
    muted: false,
    play: vi.fn(async () => {
      if (fails) throw new Error('stalled')
    }),
    pause: vi.fn(),
  }
}

test('seeks to the next source range when playhead crosses a cut', async () => {
  const media = fakeMediaElement()
  const controller = createTimelinePlaybackController({
    spec: cutSpec,
    mediaForClip: (item) =>
      item.trackType === 'video' ? media : fakeMediaElement(),
    onTime: vi.fn(),
    onFrame: vi.fn(),
    onStall: vi.fn(),
  })

  await controller.seek(9.9)
  await controller.seek(10)

  expect(media.currentTime).toBe(20)
})

test('stalls pause transport without mutating the spec', async () => {
  const onStall = vi.fn()
  const controller = createTimelinePlaybackController({
    spec,
    mediaForClip: () => fakeMediaElement(true),
    onTime: vi.fn(),
    onFrame: vi.fn(),
    onStall,
  })

  await expect(controller.play()).rejects.toThrow()
  expect(onStall).toHaveBeenCalledWith('Video berhenti merespons.')
})
```

- [ ] **Step 2: Verify playback tests fail**

Run:

```powershell
bunx vitest run apps/web/test/timelinePlayback.test.ts
```

Expected: FAIL because the controller does not exist.

- [ ] **Step 3: Implement output-clock playback**

Use `performance.now()` as the output clock, not `video.currentTime`.
On each animation frame:

```ts
const elapsed = (performance.now() - startedAt) / 1000
const outputTime = Math.min(startOutputTime + elapsed, spec.timeline.duration)
const active = mapOutputTime(spec, outputTime)
await syncActiveMedia(active, mediaForClip)
onTime(outputTime)
onFrame(active)
```

`syncActiveMedia` must seek when drift exceeds `0.08` seconds, play active
audio media after a user-initiated play call, pause inactive media, and apply
mute from hidden audio tracks.

- [ ] **Step 4: Implement TimelinePreview**

Render only the 9:16 canvas plus transport controls. Keep a media element pool
keyed by clip ID, mark elements `aria-hidden`, and draw active visual items in
track order:

```tsx
<canvas
  ref={canvasRef}
  width={spec.output.width}
  height={spec.output.height}
  aria-label="Preview video vertikal"
  className="max-h-[56vh] w-auto max-w-full bg-black"
/>
```

Call `drawTimelineComposite` once with every active visual frame and mapped
caption words. Close or detach pooled media in the effect cleanup.

- [ ] **Step 5: Run playback/component tests and typecheck**

Run:

```powershell
bunx vitest run apps/web/test/timelinePlayback.test.ts apps/web/test/EditorControls.test.tsx
bun --cwd=apps/web run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit task 6**

```powershell
git add apps/web/components/editor/timelinePlayback.ts apps/web/components/editor/TimelinePreview.tsx apps/web/test/timelinePlayback.test.ts apps/web/test/EditorControls.test.tsx
git commit -m "feat(web): add timeline-aware preview playback"
```

## Task 7: Integrate the responsive editor workspace and autosave

**Files:**

- Create: `apps/web/components/editor/EditorHeader.tsx`
- Create: `apps/web/components/editor/EditorWorkspace.tsx`
- Modify: `apps/web/components/ClipEditor.tsx`
- Modify: `apps/web/components/editor/CropControls.tsx`
- Modify: `apps/web/components/editor/CaptionControls.tsx`
- Modify: `apps/web/components/editor/EditorActionBar.tsx`
- Delete: `apps/web/components/editor/EditorPreview.tsx`
- Test: `apps/web/test/EditorWorkspace.test.tsx`

**Interfaces:**

- Consumes: history reducer, autosave controller, timeline commands, preview.
- Produces: `EditorWorkspaceProps = { header; preview; inspector; timeline }`.
- Produces: one `ClipEditor` orchestration path for loading, ready, save error,
  playback stall, and export states.

- [ ] **Step 1: Write failing workspace integration tests**

```tsx
const readyPayloadV2 = makeReadyPayload()
const workspaceProps: EditorWorkspaceProps = {
  header: <div>Header</div>,
  preview: <div>Preview</div>,
  inspector: <div>Inspector content</div>,
  timeline: <div>Timeline</div>,
}
function mockClipLoad(payload: ClipEditorPayload) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.endsWith('/segment')) {
      return new Response(new Blob(['media'], { type: 'video/mp4' }))
    }
    return Response.json(payload)
  }))
}

test('renders preview inspector and layer timeline in ready state', async () => {
  mockClipLoad(readyPayloadV2)
  render(<ClipEditor clipId="clip-1" />)

  expect(await screen.findByLabelText('Preview video vertikal')).toBeVisible()
  expect(screen.getByRole('region', { name: 'Timeline editor' })).toBeVisible()
  expect(screen.getByRole('complementary', { name: 'Inspector' })).toBeVisible()
})

test('autosave status changes after a timeline command', async () => {
  vi.useFakeTimers()
  mockClipLoad(readyPayloadV2)
  render(<ClipEditor clipId="clip-1" />)

  await userEvent.click(await screen.findByRole('button', { name: 'Split' }))
  expect(screen.getByText('Belum tersimpan')).toBeVisible()
  await vi.advanceTimersByTimeAsync(1000)
  expect(screen.getByText('Tersimpan')).toBeVisible()
})

test('mobile inspector opens as a sheet', async () => {
  render(<EditorWorkspace {...workspaceProps} />)
  await userEvent.click(screen.getByRole('button', { name: 'Buka inspector' }))
  expect(screen.getByRole('dialog', { name: 'Inspector' })).toBeVisible()
})
```

- [ ] **Step 2: Verify workspace tests fail**

Run:

```powershell
bunx vitest run apps/web/test/EditorWorkspace.test.tsx
```

Expected: FAIL because the new workspace does not exist.

- [ ] **Step 3: Refactor ClipEditor into state orchestration**

Keep load/cache/error logic, replace direct `spec` state with history state,
and route every edit through one dispatcher:

```ts
const dispatchCommand = useCallback((command: TimelineCommand) => {
  const next = applyTimelineCommand(
    history.present,
    command,
    timelineContext,
  )
  if (next !== history.present) {
    historyDispatch({ type: 'push', spec: next })
  }
}, [history.present, timelineContext])
```

Pass `history.present` to `useEditorAutosave`. Crop and caption controls emit
`updateCrop` and `updateCaptions` commands instead of replacing spec directly.

- [ ] **Step 4: Implement responsive workspace layout**

Use desktop grid with preview and inspector above a full-width timeline:

```tsx
export interface EditorWorkspaceProps {
  header: ReactNode
  preview: ReactNode
  inspector: ReactNode
  timeline: ReactNode
}

<section className="editor-workspace -mx-4 sm:-mx-6 lg:-mx-8">
  {header}
  <div className="grid min-h-0 lg:grid-cols-[minmax(0,1fr)_20rem]">
    {preview}
    <aside aria-label="Inspector" className="hidden border-l lg:block">
      {inspector}
    </aside>
  </div>
  {timeline}
</section>
```

At widths below `1024px`, render the inspector trigger and Radix Sheet.
Timeline track canvas uses horizontal overflow; controls remain sticky left.

- [ ] **Step 5: Connect autosave, unload guard, retry, and export flush**

Show `Belum tersimpan`, `Menyimpan…`, `Tersimpan`, or `Gagal menyimpan`.
Retry calls `autosave.retry()`. `runExport` must call:

```ts
await autosave.flush()
await markRenderStatus('rendering')
await exportClipMp4(exportArgs)
await markRenderStatus('done')
```

Render-status PATCHes must include the current `editSpec` so they cannot reset
the normalized timeline.

- [ ] **Step 6: Run workspace and existing editor regressions**

Run:

```powershell
bunx vitest run apps/web/test/EditorWorkspace.test.tsx apps/web/test/EditorControls.test.tsx apps/web/test/editorViewState.test.ts
bun --cwd=apps/web run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit task 7**

```powershell
git add apps/web/components/ClipEditor.tsx apps/web/components/editor/EditorHeader.tsx apps/web/components/editor/EditorWorkspace.tsx apps/web/components/editor/CropControls.tsx apps/web/components/editor/CaptionControls.tsx apps/web/components/editor/EditorActionBar.tsx apps/web/components/editor/EditorPreview.tsx apps/web/test/EditorWorkspace.test.tsx
git commit -m "feat(web): integrate layered editor workspace"
```

## Task 8: Replace continuous conversion with timeline-aware export

**Files:**

- Modify: `apps/web/lib/browserExport.ts`
- Test: `apps/web/test/browserExport.test.ts`

**Interfaces:**

- Consumes: `EditSpecV2`, `buildFrameSchedule`, `mapOutputTime`,
  `mapWordsToTimeline`.
- Produces: `exportClipMp4({ url, spec, words, title, onProgress }): Promise<void>`.
- Produces: `createTimelineExporter(runtime): typeof exportClipMp4` for
  deterministic tests.
- Produces: `TimelineExportRuntime` as the Mediabunny/Web Audio adapter
  boundary.

```ts
export interface TimelineExportRuntime {
  open(url: string): Promise<{
    frameAt(sourceTime: number): Promise<CanvasImageSource | null>
    readAudio(start: number, end: number): AsyncIterable<{
      buffer: AudioBuffer
      timestamp: number
      duration: number
    }>
  }>
  createOutput(spec: EditSpecV2): Promise<{
    context: CanvasRenderingContext2D
    addVideoFrame(timestamp: number, duration: number): Promise<void>
    addAudioBuffer(buffer: AudioBuffer): Promise<void>
    finalize(): Promise<ArrayBuffer>
  }>
  createOfflineAudioContext(
    channels: number,
    length: number,
    sampleRate: number,
  ): OfflineAudioContext
  download(buffer: ArrayBuffer, filename: string): void
}
```

- [ ] **Step 1: Write failing export schedule tests**

```ts
const words: TranscriptWord[] = []
const sourceSpec = makeEditorSpec()
const trimmedTwentySecondSpec = applyTimelineCommand(sourceSpec, {
  type: 'trimClip',
  trackId: sourceSpec.timeline.primaryTrackId,
  clipId: sourceSpec.timeline.tracks[0]!.clips[0]!.id,
  edge: 'end',
  sourceTime: 20,
}, editorContext)
const twentySecondCutSpec = {
  ...trimmedTwentySecondSpec,
  timeline: {
    ...trimmedTwentySecondSpec.timeline,
    tracks: trimmedTwentySecondSpec.timeline.tracks.map((track) =>
      track.type === 'audio' ? { ...track, hidden: true } : track,
    ),
  },
}
const mutedSpec = {
  ...sourceSpec,
  timeline: {
    ...sourceSpec.timeline,
    tracks: sourceSpec.timeline.tracks.map((track) =>
      track.type === 'audio' ? { ...track, hidden: true } : track,
    ),
  },
}

test('exports exactly the rippled timeline duration', async () => {
  const { runtime, addVideoFrame, finalize } = fakeRuntime()
  const exportWithRuntime = createTimelineExporter(runtime)

  await exportWithRuntime({
    url: 'blob:clip',
    spec: twentySecondCutSpec,
    words,
    title: 'hasil',
  })

  expect(addVideoFrame).toHaveBeenCalledTimes(600)
  const finalFrame = addVideoFrame.mock.calls.at(-1)!
  expect(finalFrame[0]).toBeCloseTo(599 / 30)
  expect(finalFrame[1]).toBeCloseTo(1 / 30)
  expect(finalize).toHaveBeenCalled()
})

test('does not create an audio source when every audio track is hidden', async () => {
  const { runtime, readAudio } = fakeRuntime()
  await createTimelineExporter(runtime)({
    url: 'blob:clip',
    spec: mutedSpec,
    words,
    title: 'silent',
  })
  expect(readAudio).not.toHaveBeenCalled()
})
```

Define the fake in the same test file:

```ts
function fakeRuntime() {
  const addVideoFrame = vi.fn(async () => undefined)
  const readAudio = vi.fn(async function* () {})
  const finalize = vi.fn(async () => new ArrayBuffer(3))
  const canvas = document.createElement('canvas')
  return {
    addVideoFrame,
    readAudio,
    finalize,
    runtime: {
      open: vi.fn(async () => ({
        frameAt: vi.fn(async () => canvas),
        readAudio,
      })),
      createOutput: vi.fn(async () => ({
        context: canvas.getContext('2d')!,
        addVideoFrame,
        addAudioBuffer: vi.fn(async () => undefined),
        finalize,
      })),
      createOfflineAudioContext: vi.fn(),
      download: vi.fn(),
    } satisfies TimelineExportRuntime,
  }
}
```

- [ ] **Step 2: Verify export tests fail**

Run:

```powershell
bunx vitest run apps/web/test/browserExport.test.ts
```

Expected: FAIL because current Conversion exports the full input duration.

- [ ] **Step 3: Implement frame rendering with Mediabunny sinks and sources**

Follow Mediabunny 1.51 public APIs:

- `VideoSampleSink.getSample(sourceTime)` for decoded source frames;
- `CanvasSource.add(outputTime, frameDuration)` for encoded canvas frames;
- `AudioBufferSink.buffers(start, end)` for decoded audio chunks;
- `AudioBufferSource.add(renderedAudioBuffer)` for final mixed audio.

Reference:

- <https://mediabunny.dev/api/VideoSampleSink>
- <https://mediabunny.dev/api/CanvasSource>
- <https://mediabunny.dev/guide/media-sinks>
- <https://mediabunny.dev/api/AudioBufferSource>

Core video loop:

```ts
const schedule = buildFrameSchedule(spec)
for (const frame of schedule) {
  const layers = []
  for (const item of mapOutputTime(spec, frame.outputTime)
    .filter((active) => active.trackType === 'video')) {
    const media = await input.frameAt(item.sourceTime)
    if (media) layers.push({ media, order: item.order })
  }
  drawTimelineComposite(
    output.context,
    layers,
    spec,
    mappedWords,
    frame.outputTime,
  )
  await output.addVideoFrame(frame.outputTime, frame.duration)
  onProgress?.((frame.index + 1) / schedule.length * 0.85)
}
```

Implement the production `TimelineExportRuntime` with `Input`, `BlobSource`,
`VideoSampleSink`, `CanvasSource`, `AudioBufferSink`, `AudioBufferSource`,
`Output`, `Mp4OutputFormat`, and `BufferTarget`. Keep Mediabunny imports inside
the browser runtime factory so capability checks run before decoding.

- [ ] **Step 4: Implement cut-aware audio mix**

Create an `OfflineAudioContext` with
`length = Math.ceil(spec.timeline.duration * sampleRate)`. For each visible
audio clip, iterate intersecting `AudioBufferSink.buffers(sourceIn, sourceOut)`,
schedule only the intersection, and map it to output time:

```ts
const node = offline.createBufferSource()
node.buffer = wrapped.buffer
node.connect(offline.destination)
node.start(
  clip.timelineStart + intersectionStart - clip.sourceIn,
  intersectionStart - wrapped.timestamp,
  intersectionEnd - intersectionStart,
)
```

After `await offline.startRendering()`, add the result once through
`AudioBufferSource`, close both sources, finalize output, and download the
buffer. Update progress from `0.85` to `1`.

- [ ] **Step 5: Preserve capability and empty-visual safeguards**

Keep VideoEncoder/AudioEncoder checks. If no visible video clips exist, render
black frames only after a confirmed `allowEmptyVisual: true`; otherwise throw:
`"Aktifkan video layer atau konfirmasi ekspor layar hitam."`

- [ ] **Step 6: Run export tests, typecheck, and engine mapping regression**

Run:

```powershell
bunx vitest run apps/web/test/browserExport.test.ts packages/engine/test/timelineMapping.test.ts
bun --cwd=apps/web run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit task 8**

```powershell
git add apps/web/lib/browserExport.ts apps/web/test/browserExport.test.ts
git commit -m "feat(web): export timeline edits in browser"
```

## Task 9: Cross-device accessibility, regression, and documentation

**Files:**

- Modify: `apps/web/app/globals.css`
- Modify: `README.md`
- Create: `apps/web/app/dev/editor-fixture/page.tsx`
- Create: `apps/web/components/editor/EditorFixture.tsx`
- Modify: `apps/web/test/TimelineEditor.test.tsx`
- Modify: `apps/web/test/EditorWorkspace.test.tsx`

**Interfaces:**

- Consumes: completed editor behavior from tasks 1–8.
- Produces: verified keyboard, touch, responsive, and reduced-motion behavior.

- [ ] **Step 1: Add reduced-motion and timeline range styling**

```css
.timeline-scroll {
  overscroll-behavior-inline: contain;
  touch-action: pan-x pinch-zoom;
}

.timeline-trim-handle {
  min-width: 44px;
  min-height: 44px;
}

@media (prefers-reduced-motion: reduce) {
  .editor-workspace *,
  .editor-workspace *::before,
  .editor-workspace *::after {
    scroll-behavior: auto !important;
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

- [ ] **Step 2: Add final accessibility assertions**

```tsx
test('all gesture actions have named button or range alternatives', () => {
  render(<TimelineEditor {...props} />)
  expect(screen.getByRole('button', { name: 'Split' })).toBeVisible()
  expect(screen.getByRole('button', { name: 'Hapus' })).toBeVisible()
  expect(screen.getByRole('slider', { name: /Trim awal/ })).toBeVisible()
  expect(screen.getByRole('slider', { name: /Trim akhir/ })).toBeVisible()
})

test('save states are announced without relying on color', () => {
  const headerProps = {
    title: 'Klip fixture',
    onBack: vi.fn(),
    onExport: vi.fn(),
    exporting: false,
  }
  render(<EditorHeader saveStatus="error" {...headerProps} />)
  expect(screen.getByRole('status')).toHaveTextContent('Gagal menyimpan')
  expect(screen.getByRole('button', { name: 'Coba simpan lagi' })).toBeVisible()
})
```

- [ ] **Step 3: Document the v2 editor and browser requirements**

Update README editor section with exact behavior:

```markdown
Editor memakai timeline multi-track dengan trim, split, auto-ripple,
undo/redo selama tab aktif, dan autosave. Candidate segment tetap menjadi
batas source fase ini; upload media, transitions, dan effects belum tersedia.

Preview dapat dipakai pada browser modern. Export MP4 membutuhkan WebCodecs
VideoEncoder dan AudioEncoder; Chrome atau Edge terbaru tetap menjadi target
utama.
```

- [ ] **Step 4: Add a development-only deterministic browser fixture**

```tsx
// apps/web/app/dev/editor-fixture/page.tsx
import { notFound } from 'next/navigation'
import { EditorFixture } from '@/components/editor/EditorFixture'

export default function EditorFixturePage() {
  if (process.env.NODE_ENV !== 'development') notFound()
  return <EditorFixture />
}
```

`EditorFixture` owns a `createDefaultEditSpecV2` state and wires the real
`EditorWorkspace`, `TimelineEditor`, `LayerInspector`, and command engine. It
uses a labeled 9:16 fixture canvas instead of network media, so responsive,
keyboard, pointer, touch, sheet, ripple, and history checks are deterministic.
The route returns 404 in production.

- [ ] **Step 5: Run full automated quality gates**

Run:

```powershell
bun run test
bun run typecheck
bun run build
Set-Location apps/downloader
uv run pytest -v
Set-Location ../..
```

Expected: all commands exit `0`.

- [ ] **Step 6: Run browser validation at three viewports**

Start the app:

```powershell
bun run dev
```

Open `http://localhost:3000/dev/editor-fixture` and verify:

```text
Desktop 1440×900:
- preview, inspector, and timeline visible together
- mouse trim, split shortcut, undo, redo, autosave, export

Tablet 834×1194:
- timeline scrolls horizontally
- inspector opens and closes without trapping focus
- touch-sized trim handles remain reachable

Mobile 390×844:
- preview remains visible
- bottom-sheet inspector works
- trim, split, delete, undo, redo, and zoom have non-hover controls
- no page-level horizontal overflow
```

Expected: no new console errors, focus traps, clipped actions, or inaccessible
controls. Capture one screenshot per viewport for review evidence.

- [ ] **Step 7: Commit task 9**

```powershell
git add apps/web/app/globals.css apps/web/app/dev/editor-fixture/page.tsx apps/web/components/editor/EditorFixture.tsx apps/web/test/TimelineEditor.test.tsx apps/web/test/EditorWorkspace.test.tsx README.md
git commit -m "test(web): validate timeline editor experience"
```

- [ ] **Step 8: Confirm final repository state**

Run:

```powershell
git status --short
git log -9 --oneline
```

Expected: only pre-existing unrelated user changes remain; the nine task
commits are present and no intended timeline file is unstaged.
