# Built-in Media Presets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reusable built-in library of sound effects, stickers, stock-style photos, and backgrounds that users can preview and insert without uploading external files.

**Architecture:** A checked-in, typed manifest is the global read-only built-in catalog. Static same-origin assets are served from `apps/web/public/presets`, merged into the existing Asset Catalog resolver, and referenced by stable `builtin:*` asset IDs in EditSpecV3. The existing insert, canvas, timeline, preview, and export paths handle built-ins exactly like uploaded assets.

**Tech Stack:** TypeScript 5.7, React 19, Next.js 15 static assets, SVG/WebP/WAV, HTML Audio, Vitest, Testing Library, existing CheapClipper engine and Asset Catalog.

## Global Constraints

- Complete `docs/superpowers/plans/2026-08-01-draggable-caption-uploaded-media.md` first.
- Built-in assets are global, read-only, never expire, and never count toward the 300 MB project quota.
- Initial library includes sound effects, stickers/overlays, stock-style photos, and backgrounds.
- Every catalog item has stable ID, category, MIME type, dimensions/duration, source/license metadata, thumbnail URL, and media URL.
- All shipped assets must allow redistribution and commercial output; generated assets are project-owned and deterministic assets are original project output.
- Built-in files are same-origin and never reveal R2 credentials or internal keys.
- Thumbnail loading is lazy; sound preview is user-initiated and stops when selection changes or component unmounts.
- Insert remains accessible through buttons even when drag-and-drop is available.
- Follow strict RED → GREEN → REFACTOR and run focused validation after every production edit.

---

## File Structure

- `apps/web/lib/builtinMedia.ts`: typed manifest, lookup, category filtering, and Asset Catalog conversion.
- `apps/web/test/builtinMedia.test.ts`: stable IDs, metadata, file existence, and license coverage.
- `apps/web/public/presets/stickers/*.svg`: original vector overlays.
- `apps/web/public/presets/backgrounds/*.svg`: original reusable backgrounds.
- `apps/web/public/presets/photos/*.webp`: generated stock-style photos.
- `apps/web/public/presets/sfx/*.wav`: deterministic generated sound effects.
- `apps/web/public/presets/ATTRIBUTIONS.md`: provenance/license record.
- `apps/web/scripts/generateBuiltinSfx.ts`: deterministic PCM/WAV generator.
- `apps/web/test/builtinSfx.test.ts`: generated audio headers and catalog durations.
- `apps/web/lib/mediaAssets.ts`: merge built-ins into resolution and reject mutations.
- `apps/web/test/mediaAssets.test.ts`: built-in authorization/quota/retention tests.
- `apps/web/components/editor/MediaLibrary.tsx`: preset category tabs, search, thumbnails, and sound preview.
- `apps/web/components/editor/PresetCard.tsx`: focused visual/audio card.
- `apps/web/test/MediaLibrary.test.tsx`: preset browsing/preview/insertion.
- `apps/web/test/EditorWorkspace.test.tsx`: refresh and export integration.

---

### Task 1: Define the Typed Built-in Catalog

**Files:**
- Create: `apps/web/lib/builtinMedia.ts`
- Create: `apps/web/test/builtinMedia.test.ts`
- Create: `apps/web/public/presets/ATTRIBUTIONS.md`

**Interfaces:**
- Consumes: core-plan `ResolvedMediaAsset` and `TimelineAssetContext`.
- Produces:
  - `BuiltInCategory`
  - `BuiltInMediaAsset`
  - `BUILTIN_MEDIA`
  - `getBuiltInAsset(id)`
  - `listBuiltInAssets(category?)`

- [ ] **Step 1: Write failing catalog integrity tests**

```ts
test('built-in catalog has unique stable IDs and complete license metadata', () => {
  expect(new Set(BUILTIN_MEDIA.map((asset) => asset.id)).size).toBe(BUILTIN_MEDIA.length)
  for (const asset of BUILTIN_MEDIA) {
    expect(asset.id).toMatch(/^builtin:(sfx|sticker|photo|background):[a-z0-9-]+$/)
    expect(asset.url).toMatch(/^\/presets\//)
    expect(asset.thumbnailUrl).toMatch(/^\/presets\//)
    expect(asset.license).toMatchObject({ commercialUse: true })
    expect(asset.name.trim()).not.toBe('')
  }
})

test('every catalog path exists below public presets', () => {
  for (const asset of BUILTIN_MEDIA) {
    expect(existsSync(resolve(PUBLIC_DIR, asset.url.slice(1)))).toBe(true)
    expect(existsSync(resolve(PUBLIC_DIR, asset.thumbnailUrl.slice(1)))).toBe(true)
  }
})
```

- [ ] **Step 2: Run catalog tests and verify RED**

```bash
bun x vitest run apps/web/test/builtinMedia.test.ts
```

Expected: FAIL because the manifest and preset files do not exist.

- [ ] **Step 3: Define exact catalog contracts and initial inventory**

```ts
export type BuiltInCategory = 'sfx' | 'sticker' | 'photo' | 'background'

export interface BuiltInMediaAsset extends ResolvedMediaAsset {
  source: 'builtin'
  category: BuiltInCategory
  thumbnailUrl: string
  license: {
    name: 'CheapClipper Original' | 'OpenAI Generated'
    source: 'project' | 'openai-imagegen'
    commercialUse: true
  }
  defaultTransform?: VisualTransform
}
```

Create these exact stable IDs:

```ts
const IDS = [
  'builtin:sfx:pop',
  'builtin:sfx:click',
  'builtin:sfx:bell',
  'builtin:sfx:whoosh',
  'builtin:sticker:red-arrow',
  'builtin:sticker:highlight-circle',
  'builtin:sticker:subscribe-badge',
  'builtin:sticker:sparkle-callout',
  'builtin:photo:city-night',
  'builtin:photo:creative-workspace',
  'builtin:photo:mountain-morning',
  'builtin:photo:abstract-neon',
  'builtin:background:sunset-gradient',
  'builtin:background:dark-grid',
] as const
```

Sound effects are `audio/wav`; SVG items are `image/svg+xml`; generated photos are `image/webp`. Backgrounds default to `{ x: 0, y: 0, width: 1, height: 1 }`. Stickers default to `{ x: 0.65, y: 0.08, width: 0.28, height: 0.28 }`. Photos default to `{ x: 0.15, y: 0.2, width: 0.7, height: 0.6 }`.

Add one attribution row per ID with generator/provenance and commercial-use status; no external URL is needed for project-original files.

- [ ] **Step 4: Keep RED for the intended missing-file reason**

```bash
bun x vitest run apps/web/test/builtinMedia.test.ts
```

Expected: FAIL only on missing static asset paths; ID and license assertions pass.

- [ ] **Step 5: Commit the catalog contract**

```bash
git add apps/web/lib/builtinMedia.ts apps/web/test/builtinMedia.test.ts apps/web/public/presets/ATTRIBUTIONS.md
git commit -m "feat(web): define built-in media catalog"
```

---

### Task 2: Create Original Stickers and Backgrounds

**Files:**
- Create: `apps/web/public/presets/stickers/red-arrow.svg`
- Create: `apps/web/public/presets/stickers/highlight-circle.svg`
- Create: `apps/web/public/presets/stickers/subscribe-badge.svg`
- Create: `apps/web/public/presets/stickers/sparkle-callout.svg`
- Create: `apps/web/public/presets/backgrounds/sunset-gradient.svg`
- Create: `apps/web/public/presets/backgrounds/dark-grid.svg`
- Modify: `apps/web/test/builtinMedia.test.ts`

**Interfaces:**
- Consumes: exact manifest paths from Task 1.
- Produces: six original vector assets with 1080 × 1920-safe view boxes.

- [ ] **Step 1: Add failing SVG safety tests**

```ts
test('SVG presets are self-contained and script free', () => {
  const svgs = BUILTIN_MEDIA.filter((asset) => asset.mimeType === 'image/svg+xml')
  for (const asset of svgs) {
    const source = readFileSync(resolve(PUBLIC_DIR, asset.url.slice(1)), 'utf8')
    expect(source).toContain('<svg')
    expect(source).not.toMatch(/<script|javascript:|https?:\/\//i)
    expect(source).toMatch(/viewBox=/)
  }
})
```

- [ ] **Step 2: Run and verify RED**

```bash
bun x vitest run apps/web/test/builtinMedia.test.ts
```

Expected: FAIL because SVG files are absent.

- [ ] **Step 3: Create focused SVG assets**

Use these exact visual constraints:

```text
red-arrow.svg: thick #FF3B30 curved arrow, white outline, transparent canvas
highlight-circle.svg: hand-drawn #FFD60A oval, transparent canvas
subscribe-badge.svg: rounded #FF2D55 pill, white “SUBSCRIBE”, subtle black shadow
sparkle-callout.svg: lime #C7FF45 four-point sparkle cluster, dark outline
sunset-gradient.svg: 1080×1920 coral → purple → navy gradient, no text
dark-grid.svg: 1080×1920 #090B0D base, subtle #293038 grid and lime center glow
```

Every sticker SVG uses a tight view box and `aria-hidden="true"`; backgrounds use `viewBox="0 0 1080 1920"` and `preserveAspectRatio="xMidYMid slice"`.

- [ ] **Step 4: Run catalog tests and inspect render**

```bash
bun x vitest run apps/web/test/builtinMedia.test.ts
```

Expected: only photo/SFX paths remain missing. Open each SVG once in the browser fixture and verify transparent edges are not clipped.

- [ ] **Step 5: Commit vectors**

```bash
git add apps/web/public/presets/stickers apps/web/public/presets/backgrounds apps/web/test/builtinMedia.test.ts
git commit -m "feat(assets): add built-in stickers and backgrounds"
```

---

### Task 3: Generate Stock-style Photos with ImageGen

**Files:**
- Create: `apps/web/public/presets/photos/city-night.webp`
- Create: `apps/web/public/presets/photos/creative-workspace.webp`
- Create: `apps/web/public/presets/photos/mountain-morning.webp`
- Create: `apps/web/public/presets/photos/abstract-neon.webp`
- Modify: `apps/web/public/presets/ATTRIBUTIONS.md`
- Modify: `apps/web/test/builtinMedia.test.ts`

**Interfaces:**
- Consumes: Task 1 manifest paths.
- Produces: four project-owned 1080 × 1920 WebP photos under 1.5 MB each.

- [ ] **Step 1: Add failing dimensions and size tests**

```ts
test('generated photo presets stay mobile-friendly', async () => {
  for (const asset of BUILTIN_MEDIA.filter((item) => item.category === 'photo')) {
    const file = resolve(PUBLIC_DIR, asset.url.slice(1))
    expect(statSync(file).size).toBeLessThanOrEqual(1_500_000)
    expect(asset.width).toBe(1080)
    expect(asset.height).toBe(1920)
  }
})
```

- [ ] **Step 2: Run and verify RED**

```bash
bun x vitest run apps/web/test/builtinMedia.test.ts
```

Expected: FAIL because four WebP files are absent.

- [ ] **Step 3: Use the `imagegen` skill with exact prompts**

Generate one vertical image per prompt, no logos, no readable text, no recognizable public figure:

```text
city-night.webp — Photorealistic vertical cinematic night city street, neon reflections after rain, empty foreground area for captions, deep blue and magenta, 9:16.
creative-workspace.webp — Photorealistic vertical modern creator desk, laptop, microphone and soft practical lights, no visible brand or screen text, warm cinematic lighting, 9:16.
mountain-morning.webp — Photorealistic vertical mountain valley at sunrise, atmospheric mist, clean center composition with caption-safe negative space, 9:16.
abstract-neon.webp — Photorealistic abstract neon light tunnel, cyan and violet gradients, strong depth, uncluttered center, 9:16.
```

Convert each output to lossless-or-quality-85 WebP at exactly 1080 × 1920. Record `OpenAI Generated`, prompt date `2026-08-01`, and commercial-use confirmation in `ATTRIBUTIONS.md`.

- [ ] **Step 4: Run catalog tests and visually inspect contact sheet**

```bash
bun x vitest run apps/web/test/builtinMedia.test.ts
```

Expected: only SFX paths remain missing. Verify no image contains text, logo, watermark, face close-up, or unsafe content.

- [ ] **Step 5: Commit generated photos**

```bash
git add apps/web/public/presets/photos apps/web/public/presets/ATTRIBUTIONS.md apps/web/test/builtinMedia.test.ts
git commit -m "feat(assets): add generated stock photo presets"
```

---

### Task 4: Generate Deterministic Built-in Sound Effects

**Files:**
- Create: `apps/web/scripts/generateBuiltinSfx.ts`
- Create: `apps/web/public/presets/sfx/pop.wav`
- Create: `apps/web/public/presets/sfx/click.wav`
- Create: `apps/web/public/presets/sfx/bell.wav`
- Create: `apps/web/public/presets/sfx/whoosh.wav`
- Create: `apps/web/test/builtinSfx.test.ts`
- Modify: `apps/web/lib/builtinMedia.ts`

**Interfaces:**
- Consumes: stable SFX IDs from Task 1.
- Produces: four mono 48 kHz PCM16 WAV files and a reproducible generator.

- [ ] **Step 1: Write failing WAV header/duration tests**

```ts
function readWav(path: string) {
  const bytes = readFileSync(path)
  const channels = bytes.readUInt16LE(22)
  const sampleRate = bytes.readUInt32LE(24)
  const bitsPerSample = bytes.readUInt16LE(34)
  const dataBytes = bytes.readUInt32LE(40)
  return {
    channels,
    sampleRate,
    bitsPerSample,
    duration: dataBytes / (sampleRate * channels * (bitsPerSample / 8)),
  }
}

test.each([
  ['pop.wav', 0.18],
  ['click.wav', 0.08],
  ['bell.wav', 0.8],
  ['whoosh.wav', 0.55],
])('%s is mono 48k PCM near %ss', (name, duration) => {
  const wav = readWav(resolve(PUBLIC_DIR, 'presets/sfx', name))
  expect(wav.sampleRate).toBe(48_000)
  expect(wav.channels).toBe(1)
  expect(wav.bitsPerSample).toBe(16)
  expect(wav.duration).toBeCloseTo(duration, 2)
})
```

- [ ] **Step 2: Run and verify RED**

```bash
bun x vitest run apps/web/test/builtinSfx.test.ts apps/web/test/builtinMedia.test.ts
```

Expected: FAIL because generator and WAV files are absent.

- [ ] **Step 3: Implement deterministic synthesis**

The generator exports and uses:

```ts
type WaveFn = (time: number) => number
function writeMonoPcm16(path: string, duration: number, wave: WaveFn): void
```

Synthesis recipes:

```text
pop: 180 Hz sine rising to 520 Hz with exponential 18× decay, 0.18s
click: seeded white-noise impulse plus 1.8 kHz sine with 55× decay, 0.08s
bell: 880 Hz + 1320 Hz + 1760 Hz sine partials with 5× decay, 0.80s
whoosh: seeded band-shaped noise, amplitude sin(πt/duration), low-to-high sweep, 0.55s
```

Use a fixed xorshift32 seed `0x43435052` for noise so byte output is stable. Clamp samples to `[-1, 1]`, write RIFF/WAVE headers explicitly, and run the script with:

```bash
bun apps/web/scripts/generateBuiltinSfx.ts
```

- [ ] **Step 4: Run audio and catalog tests**

```bash
bun x vitest run apps/web/test/builtinSfx.test.ts apps/web/test/builtinMedia.test.ts
```

Expected: PASS for all catalog files and WAV durations.

- [ ] **Step 5: Commit SFX assets**

```bash
git add apps/web/scripts/generateBuiltinSfx.ts apps/web/public/presets/sfx apps/web/test/builtinSfx.test.ts apps/web/lib/builtinMedia.ts
git commit -m "feat(assets): add original sound effect presets"
```

---

### Task 5: Merge Built-ins into Asset Authorization and Resolution

**Files:**
- Modify: `apps/web/lib/mediaAssets.ts`
- Modify: `apps/web/lib/clips.ts`
- Modify: `apps/web/test/mediaAssets.test.ts`
- Modify: `apps/web/test/clips.test.ts`

**Interfaces:**
- Consumes: `getBuiltInAsset` and core upload resolver.
- Produces: built-in IDs accepted in V3 without DB rows, quota, touch, expiry, or mutation.

- [ ] **Step 1: Write failing built-in domain tests**

```ts
test('built-in assets resolve without quota or expiry writes', async () => {
  const resolved = await resolveAssetIds(sql, alice, projectId, [
    'builtin:sticker:red-arrow',
    'builtin:sfx:pop',
  ])
  expect(resolved).toEqual([
    expect.objectContaining({ id: 'builtin:sticker:red-arrow', expiresAt: null }),
    expect.objectContaining({ id: 'builtin:sfx:pop', expiresAt: null }),
  ])
  expect(await uploadBytesForProject(sql, projectId)).toBe(0)
})

test('built-in mutation is rejected', async () => {
  await expect(
    deleteProjectUpload(sql, alice, projectId, 'builtin:sfx:pop', deps),
  ).rejects.toMatchObject({ code: 'ASSET_READ_ONLY' })
})
```

- [ ] **Step 2: Run domain tests and verify RED**

```bash
bun x vitest run apps/web/test/mediaAssets.test.ts apps/web/test/clips.test.ts
```

Expected: FAIL because authorization only queries project upload rows.

- [ ] **Step 3: Merge static catalog entries before DB lookup**

Implement:

```ts
export function resolvedBuiltInAsset(asset: BuiltInMediaAsset): ResolvedMediaAsset {
  return {
    ...asset,
    status: 'ready',
    bytes: asset.bytes,
    expiresAt: null,
    expiresSoon: false,
  }
}
```

`resolveAssetIds` partitions IDs by `builtin:` prefix. It resolves built-ins only through exact manifest lookup and queries DB for the remainder with user/project filters. Unknown built-in IDs are unauthorized and dropped by normalization. Create/list/finalize/delete/touch paths reject built-ins with `ASSET_READ_ONLY` or ignore them for touch. Clip payload includes referenced built-ins alongside uploads and candidate media.

- [ ] **Step 4: Run domain tests and typecheck**

```bash
bun x vitest run apps/web/test/mediaAssets.test.ts apps/web/test/clips.test.ts
bun --cwd apps/web run typecheck
```

Expected: PASS with zero DB media rows created for built-ins.

- [ ] **Step 5: Commit resolver integration**

```bash
git add apps/web/lib/mediaAssets.ts apps/web/lib/clips.ts apps/web/test/mediaAssets.test.ts apps/web/test/clips.test.ts
git commit -m "feat(web): resolve built-in media assets"
```

---

### Task 6: Add Preset Browsing, Preview, and Insertion UI

**Files:**
- Create: `apps/web/components/editor/PresetCard.tsx`
- Modify: `apps/web/components/editor/MediaLibrary.tsx`
- Modify: `apps/web/components/ClipEditor.tsx`
- Modify: `apps/web/test/MediaLibrary.test.tsx`
- Modify: `apps/web/test/EditorWorkspace.test.tsx`

**Interfaces:**
- Consumes: catalog list and core `insertAsset.initialTransform` contract.
- Produces: category tabs, sound preview, lazy thumbnails, search, and atomic default transforms.

- [ ] **Step 1: Write failing preset interaction tests**

```ts
test('preset tabs filter stickers photos backgrounds and sound effects', async () => {
  render(<MediaLibrary {...props} builtIns={BUILTIN_MEDIA} />)
  await userEvent.click(screen.getByRole('tab', { name: 'Sound effects' }))
  expect(screen.getByRole('button', { name: 'Preview Pop' })).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Tambahkan Red arrow' })).toBeNull()
})

test('background insert uses full-canvas transform in one command', async () => {
  render(<MediaLibrary {...props} builtIns={BUILTIN_MEDIA} />)
  await userEvent.click(screen.getByRole('button', { name: 'Tambahkan Sunset gradient' }))
  expect(onInsert).toHaveBeenCalledWith(expect.objectContaining({
    id: 'builtin:background:sunset-gradient',
    defaultTransform: { x: 0, y: 0, width: 1, height: 1 },
  }))
})
```

- [ ] **Step 2: Run UI/engine tests and verify RED**

```bash
bun x vitest run apps/web/test/MediaLibrary.test.tsx apps/web/test/EditorWorkspace.test.tsx
```

Expected: FAIL because preset tabs/cards and preset-to-insert wiring do not exist.

- [ ] **Step 3: Implement cards and atomic insert defaults**

Pass each catalog `defaultTransform` through the core plan's
`insertAsset.initialTransform`; the command normalizes and stores it in the
same history entry. `PresetCard` renders `<img loading="lazy">` for visual
thumbnails. SFX cards expose separate Preview/Stop and Insert buttons; only one
preview audio element may play at once. Search matches lowercase name/category.

Tabs are `Uploads`, `Sound effects`, `Stickers`, `Photos`, and `Backgrounds`. Desktop supports drag data; mobile supports tap insert. Preserve asset selection and playhead insertion behavior from the core plan.

- [ ] **Step 4: Run UI/engine tests and typecheck**

```bash
bun x vitest run apps/web/test/MediaLibrary.test.tsx apps/web/test/EditorWorkspace.test.tsx
bun run typecheck
```

Expected: PASS; sound preview stops on unmount and built-in insertion autosaves one command.

- [ ] **Step 5: Commit preset UI**

```bash
git add apps/web/components/editor apps/web/components/ClipEditor.tsx apps/web/test/MediaLibrary.test.tsx apps/web/test/EditorWorkspace.test.tsx
git commit -m "feat(editor): browse and insert built-in media presets"
```

---

### Task 7: Validate Built-in Preview and Export Parity

**Files:**
- Modify: `apps/web/test/EditorWorkspace.test.tsx`
- Modify: `apps/web/test/browserExport.test.ts`
- Modify only production files exposed by failures.

**Interfaces:**
- Consumes: all prior preset tasks and the core multi-asset preview/export.
- Produces: verified built-in asset path from library to MP4.

- [ ] **Step 1: Add failing parity regression tests**

```ts
test('built-in sticker survives refresh and reaches export asset map', async () => {
  render(<ClipEditor clipId="clip-1" />)
  await userEvent.click(screen.getByRole('tab', { name: 'Stickers' }))
  await userEvent.click(screen.getByRole('button', { name: 'Tambahkan Red arrow' }))
  await waitFor(() => {
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH')!
    const body = JSON.parse(String(patch[1]!.body))
    const ids = body.editSpec.timeline.tracks.flatMap(
      (track: { clips: Array<{ assetId: string }> }) =>
        track.clips.map((clip) => clip.assetId),
    )
    expect(ids).toContain('builtin:sticker:red-arrow')
  })
  await userEvent.click(screen.getByRole('button', { name: 'Export MP4' }))
  expect(exportMock).toHaveBeenCalledWith(expect.objectContaining({
    assets: expect.arrayContaining([
      expect.objectContaining({ id: 'builtin:sticker:red-arrow' }),
    ]),
  }))
  expect(payload.assets).toContainEqual(
    expect.objectContaining({ id: 'builtin:sticker:red-arrow' }),
  )
})
```

Hoist `exportMock` at module scope and inject it through the existing
`@/lib/browserExport` module mock so the Export button uses that exact spy.

- [ ] **Step 2: Run parity tests and verify RED for missing wiring**

```bash
bun x vitest run apps/web/test/EditorWorkspace.test.tsx apps/web/test/browserExport.test.ts
```

Expected: FAIL until ClipEditor passes built-in entries to both preview and export.

- [ ] **Step 3: Wire the same resolved built-in array to preview and export**

Use the `payload.assets` array without constructing UI-only URLs. Ensure static same-origin URLs are fetched by the same export runtime. Do not clone a built-in into R2 or `media_assets`.

- [ ] **Step 4: Run full preset quality gate**

```bash
bun x vitest run apps/web/test/builtinMedia.test.ts apps/web/test/builtinSfx.test.ts apps/web/test/mediaAssets.test.ts apps/web/test/MediaLibrary.test.tsx apps/web/test/EditorWorkspace.test.tsx apps/web/test/browserExport.test.ts
bun run test
bun run typecheck
bun run build
```

Expected: PASS.

- [ ] **Step 5: Browser-check and commit validation fixes if required**

At desktop and mobile widths, browse all five tabs, lazy-load thumbnails, preview/stop every SFX, insert one item per category, drag/resize visual presets, move SFX on timeline, refresh, and export. Expected: no missing asset, autoplay violation, layout overflow, or console error.

```bash
git add apps packages
git commit -m "fix: validate built-in media presets"
```

Skip this commit when validation required no changes.
