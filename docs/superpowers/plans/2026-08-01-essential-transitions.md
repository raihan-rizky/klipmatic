# Essential Timeline Transitions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add built-in Fade, Cross Dissolve, and Dip to Black transitions with split-first primary-video flow, draggable joint targets, centered transition icons, overlay edge transitions, shared preview/export evaluation, and accessible non-drag controls.

**Architecture:** Transitions are normalized EditSpecV3 timeline objects that reference either one visual clip edge or one adjacent primary-video clip pair. Pure engine validation owns joint eligibility, command mutation, invalid-joint cleanup, timing windows, source-handle mapping, and opacity/black envelopes. Timeline UI renders engine-derived drop targets and icons; preview and export consume the same transition evaluator.

**Tech Stack:** TypeScript 5.7, CheapClipper timeline engine, React 19, Pointer/HTML drag events, HTML Canvas 2D, Mediabunny, Vitest, Testing Library, Playwright CLI.

## Global Constraints

- Complete `docs/superpowers/plans/2026-08-01-draggable-caption-uploaded-media.md` first; the built-in media preset plan may run before or after this plan.
- Essential pack contains exactly Fade, Cross Dissolve, and Dip to Black.
- A primary video must be split before it has a valid between-clips transition target.
- User drops a transition on the joint, and one selectable icon renders centered between the two split clips.
- Overlay image/video supports transition at clip `in` and `out` edges.
- Default duration is 0.5 seconds; maximum duration is 2 seconds and also clamps to adjacent clip lengths.
- Between-clips transition windows are centered on the joint and do not change total output duration.
- Use source media handles when available; hold the nearest boundary frame when a source handle is unavailable.
- Essential transitions affect visuals only; audio crossfade is outside scope.
- Moving, trimming, deleting, or reordering clips removes newly invalid transitions deterministically in the same undoable command.
- Drag has keyboard parity through selectable joints and `Add to selected cut`.
- No custom transitions, rotation, filters, keyframes, or cloud rendering.
- Follow strict RED → GREEN → REFACTOR and run focused validation after every production edit.

---

## File Structure

### Engine

- `packages/engine/src/timeline/transitions.ts`: joint discovery, normalization, reconciliation, timing windows, source mapping, and frame evaluation.
- `packages/engine/src/timeline/types.ts`: transition commands and evaluation interfaces.
- `packages/engine/src/timeline/normalize.ts`: preserve only valid normalized transitions.
- `packages/engine/src/timeline/commands.ts`: add/update/delete/replace plus invalid-joint cleanup.
- `packages/engine/src/timeline/mapping.ts`: include transition participants in centered windows.
- `packages/engine/src/timeline/index.ts`: transition exports.
- `packages/engine/src/compositor.ts`: per-layer opacity and black overlay.
- `packages/engine/test/timelineTransitions.test.ts`: joint/model/command/evaluator tests.
- `packages/engine/test/timelineNormalize.test.ts`: malformed transition repair.
- `packages/engine/test/timelineMapping.test.ts`: source handle and boundary-frame mapping.
- `packages/engine/test/compositor.test.ts`: opacity/black draw order.

### Editor and export

- `apps/web/components/editor/TransitionLibrary.tsx`: Essential transition cards and drag payloads.
- `apps/web/components/editor/TimelineTransitionTarget.tsx`: selectable/drop-enabled joints and overlay edges.
- `apps/web/components/editor/TimelineTransitionIcon.tsx`: centered focusable transition icon.
- `apps/web/components/editor/TransitionInspector.tsx`: type, duration, replace, and delete.
- `apps/web/components/editor/MediaLibrary.tsx`: Transitions tab.
- `apps/web/components/editor/TimelineTrack.tsx`: joint/edge target rendering.
- `apps/web/components/editor/TimelineEditor.tsx`: joint/transition selection and accessible add action.
- `apps/web/components/editor/TimelinePreview.tsx`: transition-aware active layers.
- `apps/web/components/editor/timelinePlayback.ts`: expanded active mapping.
- `apps/web/components/ClipEditor.tsx`: selection and inspector wiring.
- `apps/web/lib/browserExport.ts`: shared transition evaluation during MP4 export.
- `apps/web/test/TransitionLibrary.test.tsx`: library/drop and keyboard paths.
- `apps/web/test/TimelineEditor.test.tsx`: joint/icon/selection interaction.
- `apps/web/test/EditorWorkspace.test.tsx`: integrated split → drop → save flow.
- `apps/web/test/browserExport.test.ts`: output-duration and transition parity.

---

### Task 1: Normalize Valid Transition Targets and Discover Joints

**Files:**
- Create: `packages/engine/src/timeline/transitions.ts`
- Modify: `packages/engine/src/timeline/normalize.ts`
- Modify: `packages/engine/src/timeline/index.ts`
- Modify: `packages/engine/test/timelineFixtures.ts`
- Create: `packages/engine/test/timelineTransitions.test.ts`
- Modify: `packages/engine/test/timelineNormalize.test.ts`

**Interfaces:**
- Consumes: EditSpecV3 transition contract created by the core plan.
- Produces:
  - `findTransitionJoints(spec): TransitionJoint[]`
  - `normalizeTransitions(input, specWithoutTransitions): TimelineTransition[]`
  - `reconcileTransitions(spec): EditSpecV3`

- [ ] **Step 1: Write failing split-first and normalization tests**

```ts
test('an unsplit primary video has no between-clips transition joint', () => {
  expect(findTransitionJoints(spec)).toEqual([])
})

test('split primary video exposes one joint at the cut', () => {
  const split = applyTimelineCommand(spec, {
    type: 'splitClip',
    trackId: primaryTrack.id,
    clipId: primaryClip.id,
    outputTime: 12,
  }, context)
  expect(findTransitionJoints(split)).toEqual([
    expect.objectContaining({
      trackId: primaryTrack.id,
      fromClipId: primaryClip.id,
      toClipId: `${primaryClip.id}:right@12000`,
      outputTime: 12,
    }),
  ])
})

test('normalization drops a transition whose clips are no longer adjacent', () => {
  const normalized = normalizeEditSpecV3(malformedTransitionSpec, context)
  expect(normalized.timeline.transitions).toEqual([])
})

test('overlay visual clip accepts edge transition while primary clip does not', () => {
  expect(normalizeTransitions([overlayFadeIn], specWithOverlay)).toEqual([overlayFadeIn])
  expect(normalizeTransitions([primaryFadeIn], splitSpec)).toEqual([])
})
```

Add deterministic fixtures in `timelineFixtures.ts`:

```ts
export const splitSpec = applyTimelineCommand(spec, {
  type: 'splitClip',
  trackId: primaryTrack.id,
  clipId: primaryClip.id,
  outputTime: 12,
}, context)
export const [left, right] = splitSpec.timeline.tracks
  .find((track) => track.id === splitSpec.timeline.primaryTrackId)!.clips
export const specWithTransition: EditSpecV3 = {
  ...splitSpec,
  timeline: {
    ...splitSpec.timeline,
    transitions: [{
      id: 'transition-1',
      type: 'cross-dissolve',
      duration: 0.5,
      target: {
        kind: 'between-clips',
        trackId: primaryTrack.id,
        fromClipId: left!.id,
        toClipId: right!.id,
      },
    }],
  },
}
export const malformedTransitionSpec = {
  ...specWithTransition,
  timeline: {
    ...specWithTransition.timeline,
    tracks: specWithTransition.timeline.tracks.map((track) =>
      track.id === primaryTrack.id
        ? { ...track, clips: track.clips.map((clip) => clip.id === right!.id ? { ...clip, timelineStart: 14 } : clip) }
        : track,
    ),
  },
}
export const overlayClip: TimelineClip = {
  id: 'overlay-clip',
  assetId: 'asset-overlay',
  timelineStart: 3,
  sourceIn: 0,
  sourceOut: 5,
  muted: false,
  transform: { x: 0.2, y: 0.2, width: 0.6, height: 0.6 },
}
export const specWithOverlay: EditSpecV3 = {
  ...splitSpec,
  timeline: {
    ...splitSpec.timeline,
    tracks: [...splitSpec.timeline.tracks, {
      id: 'overlay-track',
      type: 'video',
      name: 'Overlay',
      order: splitSpec.timeline.tracks.length,
      hidden: false,
      locked: false,
      clips: [overlayClip],
    }],
  },
}
export const overlayFadeIn: TimelineTransition = {
  id: 'overlay-fade-in',
  type: 'fade',
  duration: 0.5,
  target: { kind: 'clip-edge', clipId: overlayClip.id, edge: 'in' },
}
export const primaryFadeIn: TimelineTransition = {
  ...overlayFadeIn,
  id: 'primary-fade-in',
  target: { kind: 'clip-edge', clipId: left!.id, edge: 'in' },
}
```

- [ ] **Step 2: Run engine tests and verify RED**

```bash
bun x vitest run packages/engine/test/timelineTransitions.test.ts packages/engine/test/timelineNormalize.test.ts
```

Expected: FAIL because transition discovery and normalization do not exist.

- [ ] **Step 3: Implement exact joint and normalization contracts**

```ts
export interface TransitionJoint {
  trackId: string
  fromClipId: string
  toClipId: string
  outputTime: number
  maxDuration: number
}

export const TRANSITION_TYPES = [
  'fade',
  'cross-dissolve',
  'dip-to-black',
] as const

export const DEFAULT_TRANSITION_DURATION = 0.5
export const MAX_TRANSITION_DURATION = 2
```

Sort primary video clips by `timelineStart`; a joint exists only when the previous clip end and next clip start differ by at most one output frame. `maxDuration` is `min(2, fromDuration, toDuration)`. An unsplit one-clip track returns no joint. Overlay edge targets are valid only for non-primary visual clips.

Normalization enforces unique IDs, allowlisted type, duration `1/frameRate..maxDuration`, existing target clips, correct track, and adjacency. Duplicate transitions for the same target keep the first deterministic entry.

- [ ] **Step 4: Run tests and typecheck**

```bash
bun x vitest run packages/engine/test/timelineTransitions.test.ts packages/engine/test/timelineNormalize.test.ts
bun --cwd packages/engine run typecheck
```

Expected: PASS and normalizing twice returns the same transition array.

- [ ] **Step 5: Commit transition normalization**

```bash
git add packages/engine/src/timeline/transitions.ts packages/engine/src/timeline/normalize.ts packages/engine/src/timeline/index.ts packages/engine/test/timelineFixtures.ts packages/engine/test/timelineTransitions.test.ts packages/engine/test/timelineNormalize.test.ts
git commit -m "feat(engine): normalize timeline transition targets"
```

---

### Task 2: Add Transition Commands and Invalid-joint Cleanup

**Files:**
- Modify: `packages/engine/src/timeline/types.ts`
- Modify: `packages/engine/src/timeline/commands.ts`
- Modify: `packages/engine/src/timeline/transitions.ts`
- Modify: `packages/engine/test/timelineTransitions.test.ts`
- Modify: `packages/engine/test/timelineCommands.test.ts`

**Interfaces:**
- Consumes: Task 1 joint validation.
- Produces: `addTransition`, `updateTransition`, and `deleteTransition` commands plus post-command reconciliation.

- [ ] **Step 1: Write failing add/update/delete/reconcile tests**

```ts
test('adds cross dissolve only to a valid split joint', () => {
  const next = applyTimelineCommand(splitSpec, {
    type: 'addTransition',
    transition: {
      id: 'transition-1',
      type: 'cross-dissolve',
      duration: 0.5,
      target: {
        kind: 'between-clips',
        trackId: primaryTrack.id,
        fromClipId: left.id,
        toClipId: right.id,
      },
    },
  }, context)
  expect(next.timeline.transitions).toHaveLength(1)
  expect(next.timeline.duration).toBe(splitSpec.timeline.duration)
})

test('moving one joint clip removes its transition in the same command', () => {
  const moved = applyTimelineCommand(specWithTransition, {
    type: 'moveClip',
    trackId: primaryTrack.id,
    clipId: right.id,
    timelineStart: right.timelineStart + 1,
  }, context)
  expect(moved.timeline.transitions).toEqual([])
})
```

- [ ] **Step 2: Run command tests and verify RED**

```bash
bun x vitest run packages/engine/test/timelineTransitions.test.ts packages/engine/test/timelineCommands.test.ts
```

Expected: FAIL because transition commands are not part of the union.

- [ ] **Step 3: Add typed commands and reconcile every structural mutation**

```ts
export type TransitionCommand =
  | { type: 'addTransition'; transition: TimelineTransition }
  | {
      type: 'updateTransition'
      transitionId: string
      patch: { type?: TimelineTransition['type']; duration?: number }
    }
  | { type: 'deleteTransition'; transitionId: string }
```

`addTransition` returns unchanged spec for invalid targets. Adding to an occupied target replaces the existing transition atomically with the new ID/type/duration. `updateTransition` clamps duration through target max. `deleteTransition` is idempotent. Run `reconcileTransitions` after trim, split, delete clip, move clip, delete track, set primary track, and transition mutations. Undo/redo remains handled by the existing whole-spec history reducer.

- [ ] **Step 4: Run command tests and typecheck**

```bash
bun x vitest run packages/engine/test/timelineTransitions.test.ts packages/engine/test/timelineCommands.test.ts
bun --cwd packages/engine run typecheck
```

Expected: PASS; primary duration never changes when a transition is added or removed.

- [ ] **Step 5: Commit transition commands**

```bash
git add packages/engine/src/timeline/types.ts packages/engine/src/timeline/commands.ts packages/engine/src/timeline/transitions.ts packages/engine/test/timelineTransitions.test.ts packages/engine/test/timelineCommands.test.ts
git commit -m "feat(engine): mutate transitions at valid joints"
```

---

### Task 3: Evaluate Transition Windows, Opacity, Black, and Source Handles

**Files:**
- Modify: `packages/engine/src/timeline/transitions.ts`
- Modify: `packages/engine/src/timeline/mapping.ts`
- Modify: `packages/engine/src/timeline/types.ts`
- Modify: `packages/engine/test/timelineTransitions.test.ts`
- Modify: `packages/engine/test/timelineMapping.test.ts`

**Interfaces:**
- Consumes: normalized transitions and asset durations from `TimelineContext`.
- Produces:
  - `transitionWindow(transition, spec): TransitionWindow`
  - `evaluateTransitions(spec, outputTime): TransitionFrameState`
  - transition-expanded `mapOutputTime(spec, outputTime, context?)`.

- [ ] **Step 1: Write failing envelope and source-time tests**

```ts
test('cross dissolve blends both clips across a centered window', () => {
  expect(evaluateTransitions(spec, joint - 0.25)).toMatchObject({
    opacityByClipId: { [left.id]: 1, [right.id]: 0 },
    blackOpacity: 0,
  })
  expect(evaluateTransitions(spec, joint)).toMatchObject({
    opacityByClipId: { [left.id]: 0.5, [right.id]: 0.5 },
  })
  expect(evaluateTransitions(spec, joint + 0.25)).toMatchObject({
    opacityByClipId: { [left.id]: 0, [right.id]: 1 },
  })
})

test('missing source handle holds the boundary frame', () => {
  const active = mapOutputTime(specAtNativeBoundary, joint - 0.2, context)
  const incoming = active.find((item) => item.clipId === right.id)!
  expect(incoming.sourceTime).toBe(right.sourceIn)
  expect(incoming.transitionParticipant).toBe(true)
})
```

- [ ] **Step 2: Run evaluator tests and verify RED**

```bash
bun x vitest run packages/engine/test/timelineTransitions.test.ts packages/engine/test/timelineMapping.test.ts
```

Expected: FAIL because normal mapping returns only one primary clip at a time.

- [ ] **Step 3: Implement deterministic envelopes and transition participants**

```ts
export interface TransitionWindow {
  start: number
  center: number
  end: number
  progress: number
}

export interface TransitionFrameState {
  opacityByClipId: Record<string, number>
  blackOpacity: number
}
```

For a window `[joint - duration/2, joint + duration/2]` and normalized progress `p`:

```text
cross-dissolve: from = 1-p; to = p; black = 0
fade: from = 1-min(2p,1); to = max(2p-1,0); black = 0
dip-to-black: from fades 1→0 over p=0..0.4; black holds at 1 over p=0.4..0.6; to fades 0→1 over p=0.6..1
overlay edge in: opacity = p
overlay edge out: opacity = 1-p
```

During a between-clips window, mapping returns both participants even outside their nominal output interval. Source time remains linear around the joint, clamps to `0..asset.duration`, and therefore holds the nearest boundary frame when handles are absent. Set `transitionParticipant: true` on these extra active items. Outside transition windows, existing mapping remains unchanged.

- [ ] **Step 4: Run evaluator/mapping tests and typecheck**

```bash
bun x vitest run packages/engine/test/timelineTransitions.test.ts packages/engine/test/timelineMapping.test.ts
bun --cwd packages/engine run typecheck
```

Expected: PASS at start, midpoint, end, and one frame outside every window.

- [ ] **Step 5: Commit transition evaluation**

```bash
git add packages/engine/src/timeline/transitions.ts packages/engine/src/timeline/mapping.ts packages/engine/src/timeline/types.ts packages/engine/test/timelineTransitions.test.ts packages/engine/test/timelineMapping.test.ts
git commit -m "feat(engine): evaluate essential transition frames"
```

---

### Task 4: Render the Same Transition in Compositor and Preview

**Files:**
- Modify: `packages/engine/src/compositor.ts`
- Modify: `packages/engine/test/compositor.test.ts`
- Modify: `apps/web/components/editor/TimelinePreview.tsx`
- Modify: `apps/web/components/editor/timelinePlayback.ts`
- Modify: `apps/web/test/EditorControls.test.tsx`
- Modify: `apps/web/test/timelinePlayback.test.ts`

**Interfaces:**
- Consumes: Task 3 transition-expanded active items and frame state.
- Produces: opacity-aware draw order and black overlay matching engine envelopes.

- [ ] **Step 1: Write failing draw-order and preview tests**

```ts
test('compositor applies layer opacity then draws dip black above visuals below captions', () => {
  const alphaValues: number[] = []
  Object.defineProperty(context, 'globalAlpha', {
    configurable: true,
    get: () => alphaValues.at(-1) ?? 1,
    set: (value: number) => alphaValues.push(value),
  })
  drawTimelineComposite(context, layers, spec, words, time, {
    opacityByClipId: { a: 0.25, b: 0.5 },
    blackOpacity: 0.8,
  })
  expect(alphaValues).toEqual(expect.arrayContaining([0.25, 0.5, 0.8]))
  expect(context.drawImage).toHaveBeenCalledTimes(2)
  expect(context.fillText.mock.invocationCallOrder[0]).toBeGreaterThan(
    context.fillRect.mock.invocationCallOrder.at(-1)!,
  )
})

test('preview requests both split clips at transition midpoint', async () => {
  await controller.seek(12)
  expect(mediaForClip).toHaveBeenCalledWith(expect.objectContaining({ clipId: left.id }))
  expect(mediaForClip).toHaveBeenCalledWith(expect.objectContaining({ clipId: right.id }))
})
```

- [ ] **Step 2: Run compositor/preview tests and verify RED**

```bash
bun x vitest run packages/engine/test/compositor.test.ts apps/web/test/EditorControls.test.tsx apps/web/test/timelinePlayback.test.ts
```

Expected: FAIL because compositor ignores opacity/black and playback lacks context-aware mapping.

- [ ] **Step 3: Apply transition state without duplicating formulas**

Add optional `transitionState: TransitionFrameState` to `drawTimelineComposite`. Wrap each layer draw in save/restore and set `globalAlpha` from `opacityByClipId[layer.clipId] ?? 1`. Draw an output-sized black rectangle at `blackOpacity` after visual layers and before captions.

`TimelinePreview` calls `evaluateTransitions(spec, outputTime)` exactly once per frame and passes the result to the compositor. Playback calls context-aware mapping so both video elements seek during the transition, but only normal unmuted audio items play; visual transition participants never create duplicate audio playback.

- [ ] **Step 4: Run tests and typecheck**

```bash
bun x vitest run packages/engine/test/compositor.test.ts apps/web/test/EditorControls.test.tsx apps/web/test/timelinePlayback.test.ts
bun run typecheck
```

Expected: PASS with captions never faded by visual transitions.

- [ ] **Step 5: Commit preview rendering**

```bash
git add packages/engine/src/compositor.ts packages/engine/test/compositor.test.ts apps/web/components/editor/TimelinePreview.tsx apps/web/components/editor/timelinePlayback.ts apps/web/test/EditorControls.test.tsx apps/web/test/timelinePlayback.test.ts
git commit -m "feat(editor): preview essential transitions"
```

---

### Task 5: Build the Transition Library, Joint Drop Targets, and Center Icons

**Files:**
- Create: `apps/web/components/editor/TransitionLibrary.tsx`
- Create: `apps/web/components/editor/TimelineTransitionTarget.tsx`
- Create: `apps/web/components/editor/TimelineTransitionIcon.tsx`
- Modify: `apps/web/components/editor/MediaLibrary.tsx`
- Modify: `apps/web/components/editor/TimelineTrack.tsx`
- Modify: `apps/web/components/editor/TimelineEditor.tsx`
- Create: `apps/web/test/TransitionLibrary.test.tsx`
- Modify: `apps/web/test/TimelineEditor.test.tsx`

**Interfaces:**
- Consumes: engine `findTransitionJoints` and transition commands.
- Produces: drag payload `application/x-cheapclipper-transition`, selectable joints, centered icons, and `Add to selected cut`.

- [ ] **Step 1: Write failing split/drop/icon/accessibility tests**

```ts
test('unsplit video explains that split is required', async () => {
  render(<TimelineEditor {...unsplitProps} />)
  const transfer = transitionTransfer('cross-dissolve')
  fireEvent.dragStart(screen.getByRole('button', { name: 'Cross Dissolve' }), {
    dataTransfer: transfer,
  })
  fireEvent.drop(screen.getByText('Main clip'), { dataTransfer: transfer })
  expect(screen.getByRole('status')).toHaveTextContent('Split clip terlebih dahulu')
  expect(onCommand).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'addTransition' }))
})

test('dropping on a split joint adds transition and centers icon', async () => {
  render(<TimelineEditor {...splitProps} />)
  const joint = screen.getByRole('button', { name: 'Sambungan Clip A dan Clip B' })
  const transfer = transitionTransfer('cross-dissolve')
  fireEvent.dragStart(screen.getByRole('button', { name: 'Cross Dissolve' }), {
    dataTransfer: transfer,
  })
  fireEvent.drop(joint, { dataTransfer: transfer })
  expect(onCommand).toHaveBeenCalledWith(expect.objectContaining({ type: 'addTransition' }))
  expect(screen.getByRole('button', { name: 'Cross Dissolve, 0.5 detik' }))
    .toHaveStyle({ left: `${12 * pixelsPerSecond}px` })
})
```

Define the jsdom drag payload helper in `TransitionLibrary.test.tsx`:

```ts
function transitionTransfer(type: TransitionDragPayload['type']): DataTransfer {
  const values = new Map<string, string>()
  values.set(
    'application/x-cheapclipper-transition',
    JSON.stringify({ type, duration: 0.5 }),
  )
  return {
    effectAllowed: 'copy',
    dropEffect: 'copy',
    files: [] as unknown as FileList,
    items: [] as unknown as DataTransferItemList,
    types: [...values.keys()],
    clearData: (format?: string) => {
      if (format) values.delete(format)
      else values.clear()
    },
    getData: (format: string) => values.get(format) ?? '',
    setData: (format: string, value: string) => { values.set(format, value) },
    setDragImage: () => undefined,
  }
}
```

- [ ] **Step 2: Run timeline UI tests and verify RED**

```bash
bun x vitest run apps/web/test/TransitionLibrary.test.tsx apps/web/test/TimelineEditor.test.tsx
```

Expected: FAIL because transition UI components do not exist.

- [ ] **Step 3: Implement library and engine-derived targets**

Define:

```ts
export type TransitionDragPayload = {
  type: 'fade' | 'cross-dissolve' | 'dip-to-black'
  duration: 0.5
}

export type TimelineSelection =
  | { kind: 'track'; trackId: string }
  | { kind: 'clip'; trackId: string; clipId: string }
  | { kind: 'joint'; joint: TransitionJoint }
  | { kind: 'transition'; transitionId: string }
```

Render a joint button for every `findTransitionJoints` result. It spans at least 44 × 44 CSS pixels but uses a narrow visible guide. Drop reads the allowlisted JSON payload, creates a UUID, and dispatches one `addTransition`. Existing transition icons render at `joint.outputTime * pixelsPerSecond`, offset with `translateX(-50%)`, above both clips. Clicking/focusing an icon selects the transition.

When a joint is selected, Transition Library exposes `Add to selected cut`; it dispatches the same command as drop. Overlay clips expose start/end edge targets only while transition drag is active or the clip is selected.

- [ ] **Step 4: Run UI tests and typecheck**

```bash
bun x vitest run apps/web/test/TransitionLibrary.test.tsx apps/web/test/TimelineEditor.test.tsx
bun --cwd apps/web run typecheck
```

Expected: PASS with one icon per target and no icon for an unsplit video.

- [ ] **Step 5: Commit transition timeline UI**

```bash
git add apps/web/components/editor/TransitionLibrary.tsx apps/web/components/editor/TimelineTransitionTarget.tsx apps/web/components/editor/TimelineTransitionIcon.tsx apps/web/components/editor/MediaLibrary.tsx apps/web/components/editor/TimelineTrack.tsx apps/web/components/editor/TimelineEditor.tsx apps/web/test/TransitionLibrary.test.tsx apps/web/test/TimelineEditor.test.tsx
git commit -m "feat(editor): drag transitions onto split joints"
```

---

### Task 6: Add Transition Inspector and Integrated Autosave Flow

**Files:**
- Create: `apps/web/components/editor/TransitionInspector.tsx`
- Modify: `apps/web/components/ClipEditor.tsx`
- Modify: `apps/web/components/editor/LayerInspector.tsx`
- Modify: `apps/web/test/EditorWorkspace.test.tsx`
- Modify: `apps/web/test/EditorControls.test.tsx`

**Interfaces:**
- Consumes: transition selection and add/update/delete commands.
- Produces: type/duration/replace/delete controls and split → add → autosave integration.

- [ ] **Step 1: Write failing inspector and autosave tests**

```ts
test('selected transition inspector edits duration and deletes it', async () => {
  render(<TransitionInspector spec={specWithTransition} transitionId="transition-1" onCommand={onCommand} />)
  await userEvent.clear(screen.getByLabelText('Durasi transition'))
  await userEvent.type(screen.getByLabelText('Durasi transition'), '1.2')
  expect(onCommand).toHaveBeenCalledWith({
    type: 'updateTransition',
    transitionId: 'transition-1',
    patch: { duration: 1.2 },
  })
  await userEvent.click(screen.getByRole('button', { name: 'Hapus transition' }))
  expect(onCommand).toHaveBeenCalledWith({ type: 'deleteTransition', transitionId: 'transition-1' })
})

test('split then add transition autosaves the joint reference', async () => {
  render(<ClipEditor clipId="clip-1" />)
  await userEvent.click(screen.getByRole('button', { name: 'Split' }))
  await userEvent.click(screen.getByRole('button', { name: /Sambungan/ }))
  await userEvent.click(screen.getByRole('button', { name: 'Add Cross Dissolve to selected cut' }))
  await waitFor(() => {
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH')!
    const body = JSON.parse(String(patch[1]!.body))
    expect(body.editSpec.timeline.transitions).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run integrated tests and verify RED**

```bash
bun x vitest run apps/web/test/EditorControls.test.tsx apps/web/test/EditorWorkspace.test.tsx
```

Expected: FAIL because ClipEditor cannot select or inspect transitions.

- [ ] **Step 3: Wire selection-specific inspector content**

`TransitionInspector` renders an allowlisted type select, numeric/range duration controls bounded by the selected target's `maxDuration`, Replace instructions, and Delete button. Clip/layer/crop/caption controls remain visible only for matching selection kinds. Keep mobile inspector sheet behavior.

When reconciliation removes the selected transition, clear selection after the resulting command. Autosave stores the full normalized V3 transition array; undo restores both clip layout and removed transition from history.

- [ ] **Step 4: Run integrated tests and typecheck**

```bash
bun x vitest run apps/web/test/EditorControls.test.tsx apps/web/test/EditorWorkspace.test.tsx
bun --cwd apps/web run typecheck
```

Expected: PASS for split/add/edit/delete/undo/autosave.

- [ ] **Step 5: Commit inspector integration**

```bash
git add apps/web/components/editor/TransitionInspector.tsx apps/web/components/editor/LayerInspector.tsx apps/web/components/ClipEditor.tsx apps/web/test/EditorControls.test.tsx apps/web/test/EditorWorkspace.test.tsx
git commit -m "feat(editor): inspect and save transitions"
```

---

### Task 7: Render Essential Transitions in Browser Export

**Files:**
- Modify: `apps/web/lib/browserExport.ts`
- Modify: `apps/web/test/browserExport.test.ts`
- Modify: `apps/web/test/editorFixtures.ts`

**Interfaces:**
- Consumes: Task 3 evaluator, Task 4 compositor, and core multi-asset exporter.
- Produces: MP4 frame schedule matching preview without changing total duration.

- [ ] **Step 1: Write failing export parity tests**

```ts
test.each(['fade', 'cross-dissolve', 'dip-to-black'] as const)(
  'exports %s at the same duration and midpoint state as preview',
  async (type) => {
    const spec = makeSpecWithTransition(type, 0.5)
    const { runtime, addVideoFrame, context } = fakeRuntime()
    await createTimelineExporter(runtime)({ assets, spec, words: [], title: type })
    expect(addVideoFrame).toHaveBeenCalledTimes(spec.timeline.duration * 30)
    expect(context.drawImage).toHaveBeenCalled()
    if (type === 'dip-to-black') {
      expect(context.fillRect).toHaveBeenCalledWith(0, 0, 1080, 1920)
    }
  },
)
```

Add `makeSpecWithTransition(type, duration)` to `editorFixtures.ts`; it splits
the primary clip at 12 seconds and returns the same normalized target shape as
the engine `specWithTransition` fixture. Extend the existing export
`fakeRuntime()` return value with its `context` mock.

- [ ] **Step 2: Run export tests and verify RED**

```bash
bun x vitest run apps/web/test/browserExport.test.ts
```

Expected: FAIL because export does not ask for transition participants or state.

- [ ] **Step 3: Use shared mapping/evaluation for every export frame**

For each scheduled output frame, call context-aware `mapOutputTime`, fetch both transition participant frames when active, call `evaluateTransitions` once, and pass its state to `drawTimelineComposite`. Keep audio schedule unchanged. Do not alter `buildFrameSchedule` or `timeline.duration` because transitions are render-only windows.

Close both participant frames/decoders after use according to existing asset source ownership. A missing handle uses the clamped source time already provided by the engine; exporter contains no transition math.

- [ ] **Step 4: Run export and full engine tests**

```bash
bun x vitest run apps/web/test/browserExport.test.ts packages/engine/test
bun run typecheck
```

Expected: PASS for all three transition types and unchanged candidate-only export.

- [ ] **Step 5: Commit export transitions**

```bash
git add apps/web/lib/browserExport.ts apps/web/test/browserExport.test.ts apps/web/test/editorFixtures.ts
git commit -m "feat(export): render essential transitions"
```

---

### Task 8: Run Transition Quality and Browser Gates

**Files:**
- Modify only files exposed by validation failures.

**Interfaces:**
- Consumes: all transition tasks.
- Produces: verified split-first transition flow on desktop/mobile and preview/export parity.

- [ ] **Step 1: Run focused tests**

```bash
bun x vitest run packages/engine/test/timelineTransitions.test.ts packages/engine/test/timelineNormalize.test.ts packages/engine/test/timelineCommands.test.ts packages/engine/test/timelineMapping.test.ts packages/engine/test/compositor.test.ts apps/web/test/TransitionLibrary.test.tsx apps/web/test/TimelineEditor.test.tsx apps/web/test/EditorControls.test.tsx apps/web/test/EditorWorkspace.test.tsx apps/web/test/browserExport.test.ts
```

Expected: PASS without timer, pointer-capture, or React `act()` warnings.

- [ ] **Step 2: Run repository validation**

```bash
bun run test
bun run typecheck
bun run build
```

Expected: PASS.

- [ ] **Step 3: Browser-check the exact approved interaction**

```bash
bun run dev
playwright-cli open http://localhost:3000/dev/editor-fixture
playwright-cli console
```

Verify: long video shows no transition slot; invalid drop says `Split clip terlebih dahulu`; split creates one joint; drag each Essential type to the joint; icon is exactly centered; icon opens inspector; duration clamps; replace/delete/undo/redo work; moving or deleting a participant removes the icon; overlay in/out works; keyboard `Add to selected cut` works; touch targets are usable at mobile width.

- [ ] **Step 4: Export and compare representative frames**

Export each Essential type at 0.5 seconds. Compare frames at window start, center, and end against preview screenshots. Confirm audio is unchanged and output duration/frame count is identical before and after adding the transition.

- [ ] **Step 5: Commit validation-only fixes if required**

```bash
git add packages apps
git commit -m "fix: validate essential transition workflow"
```

Skip this commit when validation required no changes.
