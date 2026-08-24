# Cross-Stack Optimization Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and run a reproducible, zero-paid-API benchmark funnel that measures Klipmatic's developer loop, web/editor runtime, database path, and mocked worker pipeline, then selects the evidence-backed top three bottlenecks for separate optimization plans.

**Architecture:** A private `@klipmatic/benchmarks` workspace package owns shared metric contracts, statistics, process execution, ranking, and report generation. Each subsystem exposes a narrow benchmark adapter that writes the same JSON metric shape; the root CLI merges valid runs, marks noisy or invalid measurements explicitly, and generates the reviewable Markdown scorecard. This plan stops after top-three selection because the approved design forbids prescribing fixes before profiling evidence exists.

**Tech Stack:** Bun 1.3+, TypeScript 5.7, Vitest 2.1, Next.js 15, React 19, Playwright test runner with Chromium, Postgres 16 via `postgres`, Python 3.11+, pytest 8.3, psycopg 3.2.

## Global Constraints

- Production user impact is the primary ranking signal; local developer experience remains in scope.
- Changes are balanced: configuration, caching, query, rendering, and targeted refactors are allowed; framework or architecture replacement is not.
- Only three bottlenecks may advance from this audit into optimization packages.
- Quantitative metrics target about 20% improvement in later packages; reliability findings use eliminated failure, retry, teardown, duplicate work, or rework.
- Transcription and LLM providers must use deterministic fixtures or mocks; no paid external API call is permitted.
- Before and after measurements must use the same fixture, command, dependency state, and environment.
- Run cold and warm cases separately and use the median of at least three valid runs.
- After one complete retry, coefficient of variation above 15% makes a metric `inconclusive`.
- A candidate needs confidence 2 or 3 before it can enter the top three.
- Existing tests, typecheck, production build, and functional output are hard gates.
- Raw artifacts live under ignored `output/benchmarks/`; the reviewed scorecard lives under `docs/performance/`.

---

## File Structure

### New benchmark package

- `packages/benchmarks/package.json`: private workspace scripts and dependencies.
- `packages/benchmarks/tsconfig.json`: strict no-emit TypeScript config.
- `packages/benchmarks/src/contracts.ts`: shared metric, run, finding, and score types.
- `packages/benchmarks/src/statistics.ts`: median, mean, standard deviation, and coefficient of variation.
- `packages/benchmarks/src/ranking.ts`: approved 1-3 scoring formula and deterministic tie-breaks.
- `packages/benchmarks/src/process.ts`: timed child-process execution and environment-failure classification.
- `packages/benchmarks/src/report.ts`: JSON merge and Markdown scorecard rendering.
- `packages/benchmarks/src/cli.ts`: `developer`, `database`, `worker`, `merge`, and `rank` commands.
- `packages/benchmarks/src/lanes/developer.ts`: build, typecheck, test, and bundle collectors.
- `packages/benchmarks/src/lanes/database.ts`: seeded Postgres query benchmark for candidate and clip-editor paths.
- `packages/benchmarks/test/*.test.ts`: focused unit/integration coverage for the package.

### Web/editor benchmark adapter

- `apps/web/playwright.config.ts`: local benchmark server and Chromium configuration.
- `apps/web/e2e/editor-performance.spec.ts`: navigation, interaction, frame, and heap proxy collection.
- `apps/web/components/editor/performanceProbe.ts`: benchmark-only counter adapter.
- `apps/web/components/editor/TimelinePreview.tsx`: emit draw, controller-create, and controller-dispose events to the adapter.
- `apps/web/components/editor/EditorFixture.tsx`: expose a deterministic preview scenario and stable benchmark controls.
- `apps/web/public/benchmark/editor-fixture.mp4`: deterministic local media; no network fetch.
- `apps/web/test/performanceProbe.test.ts`: prove the adapter is inert unless enabled and resets deterministically.
- `apps/web/package.json`: add Playwright dev dependency and `benchmark:editor` script.

### Worker benchmark adapter

- `apps/downloader/scripts/benchmark_pipeline.py`: deterministic mocked stage runner that writes the shared JSON shape.
- `apps/downloader/tests/test_benchmark_pipeline.py`: statistics, no-network, cold/warm, and output-contract tests.

### Root orchestration and reports

- `package.json`: add `benchmark`, `benchmark:developer`, `benchmark:editor`, `benchmark:database`, and `benchmark:worker` scripts.
- `docs/performance/2026-08-25-cross-stack-baseline.md`: generated baseline, ranked findings, top three, and backlog.

## Task 1: Shared Metric Contract, Statistics, and Ranking

**Files:**
- Create: `packages/benchmarks/package.json`
- Create: `packages/benchmarks/tsconfig.json`
- Create: `packages/benchmarks/src/contracts.ts`
- Create: `packages/benchmarks/src/statistics.ts`
- Create: `packages/benchmarks/src/ranking.ts`
- Create: `packages/benchmarks/test/statistics.test.ts`
- Create: `packages/benchmarks/test/ranking.test.ts`

**Interfaces:**
- Consumes: no earlier task interfaces.
- Produces: `MetricSample`, `MetricSummary`, `FindingScore`, `RankedFinding`, `summarizeSamples(samples)`, and `rankFindings(findings)` for every later task.

- [ ] **Step 1: Add the private workspace package and strict config**

```json
// packages/benchmarks/package.json
{
  "name": "@klipmatic/benchmarks",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "benchmark": "bun run src/cli.ts"
  },
  "dependencies": {
    "@klipmatic/engine": "workspace:*",
    "postgres": "^3.4.5"
  },
  "devDependencies": {
    "@types/node": "^26.1.1",
    "typescript": "^5.7.0",
    "vitest": "^2.1.0"
  }
}
```

```json
// packages/benchmarks/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022", "DOM"],
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

- [ ] **Step 2: Write failing statistics and ranking tests**

```ts
// packages/benchmarks/test/statistics.test.ts
import { describe, expect, test } from 'vitest'
import { summarizeSamples } from '../src/statistics'

describe('summarizeSamples', () => {
  test('uses the median and reports coefficient of variation', () => {
    expect(summarizeSamples([10, 12, 100])).toEqual({
      count: 3,
      median: 12,
      mean: 40.666666666666664,
      standardDeviation: 41.96294661828324,
      coefficientOfVariation: 1.031876,
    })
  })

  test('rejects fewer than three finite non-negative samples', () => {
    expect(() => summarizeSamples([10, 11])).toThrow('at least three valid samples')
    expect(() => summarizeSamples([10, Number.NaN, 12])).toThrow('finite non-negative')
  })
})
```

```ts
// packages/benchmarks/test/ranking.test.ts
import { expect, test } from 'vitest'
import { rankFindings } from '../src/ranking'

test('filters low-confidence findings and applies deterministic tie-breaks', () => {
  const ranked = rankFindings([
    { id: 'dev', metricId: 'dev.test.warm_ms', title: 'tests', impact: 1, frequency: 3, confidence: 3, risk: 1 },
    { id: 'editor', metricId: 'editor.draw.count', title: 'draws', impact: 3, frequency: 3, confidence: 3, risk: 2 },
    { id: 'guess', metricId: 'worker.unknown', title: 'guess', impact: 3, frequency: 3, confidence: 1, risk: 1 },
  ])
  expect(ranked.map((finding) => finding.id)).toEqual(['editor', 'dev'])
  expect(ranked[0]?.priority).toBe(13.5)
})
```

- [ ] **Step 3: Run the focused tests and confirm they fail**

Run: `bunx vitest run packages/benchmarks/test/statistics.test.ts packages/benchmarks/test/ranking.test.ts`

Expected: FAIL because `statistics.ts` and `ranking.ts` do not exist.

- [ ] **Step 4: Implement the contracts and statistics**

```ts
// packages/benchmarks/src/contracts.ts
export type Lane = 'developer' | 'editor' | 'database' | 'worker'
export type RunKind = 'cold' | 'warm'
export type MetricStatus = 'valid' | 'invalid' | 'inconclusive'

export interface MetricSample {
  metricId: string
  lane: Lane
  kind: RunKind
  unit: 'ms' | 'bytes' | 'count' | 'ratio'
  value: number
  run: number
  status: Exclude<MetricStatus, 'inconclusive'>
  reason?: string
}

export interface MetricSummary {
  count: number
  median: number
  mean: number
  standardDeviation: number
  coefficientOfVariation: number
}

export interface FindingScore {
  id: string
  metricId: string
  title: string
  impact: 1 | 2 | 3
  frequency: 1 | 2 | 3
  confidence: 1 | 2 | 3
  risk: 1 | 2 | 3
}

export interface RankedFinding extends FindingScore {
  priority: number
}
```

```ts
// packages/benchmarks/src/statistics.ts
import type { MetricSummary } from './contracts'

export function summarizeSamples(values: number[]): MetricSummary {
  if (values.length < 3) throw new Error('at least three valid samples are required')
  if (values.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error('samples must be finite non-negative numbers')
  }
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  const median = sorted.length % 2
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length
  const standardDeviation = Math.sqrt(variance)
  return {
    count: values.length,
    median,
    mean,
    standardDeviation,
    coefficientOfVariation: Number((mean === 0 ? 0 : standardDeviation / mean).toFixed(6)),
  }
}
```

- [ ] **Step 5: Implement confidence filtering and ranking**

```ts
// packages/benchmarks/src/ranking.ts
import type { FindingScore, RankedFinding } from './contracts'

export function rankFindings(findings: FindingScore[]): RankedFinding[] {
  return findings
    .filter((finding) => finding.confidence >= 2)
    .map((finding) => ({
      ...finding,
      priority: (finding.impact * finding.frequency * finding.confidence) / finding.risk,
    }))
    .sort((a, b) =>
      b.priority - a.priority ||
      b.impact - a.impact ||
      b.confidence - a.confidence ||
      a.risk - b.risk ||
      a.id.localeCompare(b.id),
    )
}
```

- [ ] **Step 6: Run package tests and typecheck**

Run: `bunx vitest run packages/benchmarks/test/statistics.test.ts packages/benchmarks/test/ranking.test.ts`

Expected: PASS.

Run: `bun --cwd packages/benchmarks run typecheck`

Expected: PASS with zero diagnostics.

- [ ] **Step 7: Commit the shared benchmark model**

```powershell
git add packages/benchmarks
git commit -m "feat(benchmarks): add metric statistics and ranking core"
```

## Task 2: Timed Process Runner and Developer Lane

**Files:**
- Create: `packages/benchmarks/src/process.ts`
- Create: `packages/benchmarks/src/lanes/developer.ts`
- Create: `packages/benchmarks/test/process.test.ts`
- Create: `packages/benchmarks/test/developer.test.ts`
- Modify: `packages/benchmarks/src/cli.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `MetricSample` and `summarizeSamples()` from Task 1.
- Produces: `runTimed(command, options): Promise<TimedRun>`, `collectDeveloperLane(repoRoot): Promise<MetricSample[]>`, and root `benchmark:developer` command.

- [ ] **Step 1: Write failing process-runner tests**

```ts
// packages/benchmarks/test/process.test.ts
import { expect, test } from 'vitest'
import { runTimed } from '../src/process'

test('captures a successful command without leaking its environment', async () => {
  const result = await runTimed(['bun', '-e', 'process.stdout.write("ok")'], {
    cwd: process.cwd(),
    timeoutMs: 5_000,
    env: { BENCH_SENTINEL: 'safe' },
  })
  expect(result.exitCode).toBe(0)
  expect(result.stdout).toBe('ok')
  expect(result.durationMs).toBeGreaterThanOrEqual(0)
  expect(JSON.stringify(result)).not.toContain('BENCH_SENTINEL')
})

test('classifies timeout as an invalid environment run', async () => {
  const result = await runTimed(['bun', '-e', 'await Bun.sleep(200)'], {
    cwd: process.cwd(),
    timeoutMs: 10,
  })
  expect(result.classification).toBe('environment_failure')
  expect(result.reason).toBe('timeout')
})
```

- [ ] **Step 2: Run the process tests and confirm they fail**

Run: `bunx vitest run packages/benchmarks/test/process.test.ts`

Expected: FAIL because `runTimed` does not exist.

- [ ] **Step 3: Implement safe timed execution**

```ts
// packages/benchmarks/src/process.ts
export interface TimedRun {
  exitCode: number | null
  durationMs: number
  stdout: string
  stderr: string
  classification: 'success' | 'environment_failure' | 'product_failure'
  reason?: 'timeout' | 'spawn_error' | 'non_zero_exit'
}

export async function runTimed(
  command: string[],
  options: { cwd: string; timeoutMs: number; env?: Record<string, string> },
): Promise<TimedRun> {
  const started = performance.now()
  try {
    let timedOut = false
    const proc = Bun.spawn(command, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const timeout = setTimeout(() => {
      timedOut = true
      proc.kill()
    }, options.timeoutMs)
    const [exitCode, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ])
    clearTimeout(timeout)
    const durationMs = performance.now() - started
    if (timedOut) {
      return { exitCode, durationMs, stdout, stderr, classification: 'environment_failure', reason: 'timeout' }
    }
    return exitCode === 0
      ? { exitCode, durationMs, stdout, stderr, classification: 'success' }
      : { exitCode, durationMs, stdout, stderr, classification: 'product_failure', reason: 'non_zero_exit' }
  } catch {
    return {
      exitCode: null,
      durationMs: performance.now() - started,
      stdout: '',
      stderr: '',
      classification: 'environment_failure',
      reason: 'spawn_error',
    }
  }
}
```

- [ ] **Step 4: Write failing developer-lane contract tests**

```ts
// packages/benchmarks/test/developer.test.ts
import { expect, test, vi } from 'vitest'
import { developerCases } from '../src/lanes/developer'

test('keeps cold and warm cases separate and uses at least three runs', () => {
  const cases = developerCases('C:/repo')
  expect(cases.map((entry) => [entry.metricId, entry.kind])).toEqual([
    ['dev.build.cold_ms', 'cold'],
    ['dev.build.warm_ms', 'warm'],
    ['dev.typecheck.warm_ms', 'warm'],
    ['dev.test.warm_ms', 'warm'],
  ])
  expect(cases.every((entry) => entry.runs >= 3)).toBe(true)
  expect(vi.isMockFunction(developerCases)).toBe(false)
})
```

- [ ] **Step 5: Implement developer cases and CLI output**

```ts
// packages/benchmarks/src/lanes/developer.ts
import { resolve } from 'node:path'
import type { MetricSample, RunKind } from '../contracts'
import { runTimed } from '../process'

interface DeveloperCase {
  metricId: string
  kind: RunKind
  command: string[]
  runs: number
  timeoutMs: number
}

export function developerCases(repoRoot: string): DeveloperCase[] {
  return [
    { metricId: 'dev.build.cold_ms', kind: 'cold', command: ['bunx', 'turbo', 'build', '--force'], runs: 3, timeoutMs: 600_000 },
    { metricId: 'dev.build.warm_ms', kind: 'warm', command: ['bun', 'run', 'build'], runs: 3, timeoutMs: 600_000 },
    { metricId: 'dev.typecheck.warm_ms', kind: 'warm', command: ['bun', 'run', 'typecheck'], runs: 3, timeoutMs: 300_000 },
    { metricId: 'dev.test.warm_ms', kind: 'warm', command: ['bun', 'run', 'test'], runs: 3, timeoutMs: 600_000 },
  ].map((entry) => ({ ...entry, cwd: resolve(repoRoot) }))
}

export async function collectDeveloperLane(repoRoot: string): Promise<MetricSample[]> {
  const samples: MetricSample[] = []
  for (const entry of developerCases(repoRoot)) {
    for (let run = 1; run <= entry.runs; run += 1) {
      const result = await runTimed(entry.command, { cwd: repoRoot, timeoutMs: entry.timeoutMs })
      samples.push({
        metricId: entry.metricId,
        lane: 'developer',
        kind: entry.kind,
        unit: 'ms',
        value: result.durationMs,
        run,
        status: result.classification === 'success' ? 'valid' : 'invalid',
        reason: result.reason,
      })
      if (entry.metricId.startsWith('dev.build.') && result.classification === 'success') {
        samples.push({
          metricId: 'dev.web.bundle_bytes',
          lane: 'developer',
          kind: entry.kind,
          unit: 'bytes',
          value: await sumFiles(repoRoot, 'apps/web/.next/static/chunks/app', '.js'),
          run,
          status: 'valid',
        })
      }
    }
  }
  return samples
}
```

Implement `sumFiles(root, directory, suffix)` with `node:fs/promises.readdir({ recursive: true, withFileTypes: true })`; sum only regular files ending in `.js`. The report derives `dev.build.cache_ratio` as warm build median divided by cold build median, so Turbo cache effectiveness is visible without parsing human-formatted console output.

In `packages/benchmarks/src/cli.ts`, implement `developer --out <path>` by calling `collectDeveloperLane(process.cwd())` and `Bun.write(out, JSON.stringify(samples, null, 2))`. Reject missing `--out` with exit code 2.

- [ ] **Step 6: Add root scripts**

```json
"benchmark:developer": "bun --cwd packages/benchmarks run benchmark developer --out ../../output/benchmarks/developer.json",
"benchmark": "bun --cwd packages/benchmarks run benchmark merge"
```

- [ ] **Step 7: Run focused tests and a one-case smoke mode**

Run: `bunx vitest run packages/benchmarks/test/process.test.ts packages/benchmarks/test/developer.test.ts`

Expected: PASS.

Run: `bun --cwd packages/benchmarks run benchmark developer --out ../../output/benchmarks/developer-smoke.json --runs 1 --only dev.typecheck.warm_ms`

Expected: exit 0 and one valid `MetricSample` in the JSON. The `--runs 1` override is smoke-only; baseline generation must reject fewer than three runs.

- [ ] **Step 8: Commit the developer lane**

```powershell
git add package.json packages/benchmarks/src packages/benchmarks/test
git commit -m "feat(benchmarks): measure developer feedback loop"
```

## Task 3: Editor Runtime Probe and Browser Lane

**Files:**
- Create: `apps/web/components/editor/performanceProbe.ts`
- Create: `apps/web/test/performanceProbe.test.ts`
- Create: `apps/web/playwright.config.ts`
- Create: `apps/web/e2e/editor-performance.spec.ts`
- Modify: `apps/web/components/editor/TimelinePreview.tsx`
- Modify: `apps/web/components/editor/EditorFixture.tsx`
- Modify: `apps/web/app/dev/editor-fixture/page.tsx`
- Modify: `apps/web/package.json`
- Modify: `package.json`

**Interfaces:**
- Consumes: the shared `MetricSample` JSON contract from Task 1.
- Produces: `recordEditorMetric(name, durationMs?)`, `readEditorMetrics()`, `resetEditorMetrics()`, and `output/benchmarks/editor.json`.

- [ ] **Step 1: Write the failing inert-probe tests**

```ts
// apps/web/test/performanceProbe.test.ts
import { beforeEach, expect, test } from 'vitest'
import {
  readEditorMetrics,
  recordEditorMetric,
  resetEditorMetrics,
  setEditorProbeEnabled,
} from '@/components/editor/performanceProbe'

beforeEach(() => {
  resetEditorMetrics()
  setEditorProbeEnabled(false)
})

test('does nothing while disabled', () => {
  recordEditorMetric('draw', 4)
  expect(readEditorMetrics()).toEqual({ counters: {}, durations: {} })
})

test('counts events and records durations while enabled', () => {
  setEditorProbeEnabled(true)
  recordEditorMetric('draw', 4)
  recordEditorMetric('draw', 6)
  expect(readEditorMetrics()).toEqual({ counters: { draw: 2 }, durations: { draw: [4, 6] } })
})
```

- [ ] **Step 2: Run the probe tests and confirm they fail**

Run: `bunx vitest run apps/web/test/performanceProbe.test.ts`

Expected: FAIL because `performanceProbe.ts` does not exist.

- [ ] **Step 3: Implement the benchmark-only adapter**

```ts
// apps/web/components/editor/performanceProbe.ts
interface EditorMetrics {
  counters: Record<string, number>
  durations: Record<string, number[]>
}

const metrics: EditorMetrics = { counters: {}, durations: {} }
let enabled = false

export function setEditorProbeEnabled(value: boolean): void {
  enabled = value
}

export function resetEditorMetrics(): void {
  metrics.counters = {}
  metrics.durations = {}
}

export function recordEditorMetric(name: string, durationMs?: number): void {
  if (!enabled) return
  metrics.counters[name] = (metrics.counters[name] ?? 0) + 1
  if (durationMs !== undefined) (metrics.durations[name] ??= []).push(durationMs)
}

export function readEditorMetrics(): EditorMetrics {
  return structuredClone(metrics)
}
```

Expose these four functions on `window.__KLIPMATIC_EDITOR_BENCHMARK__` only when the fixture query contains `?benchmark=1`; call `setEditorProbeEnabled(true)` in that branch and reset during cleanup.

Wrap the fixture root with React `Profiler` and record `react_commit` on every
commit. In the fixture's first effect, record `hydration` with
`performance.now()` as the duration value; because navigation starts at zero
for the document, this is the local hydration proxy.

- [ ] **Step 4: Instrument the real preview hot path**

In `TimelinePreview.tsx`:

```ts
import { recordEditorMetric } from './performanceProbe'

// Immediately after playback-controller creation:
recordEditorMetric('controller_create')

// In the effect cleanup immediately before controller.dispose():
recordEditorMetric('controller_dispose')

// Around drawFrameRef.current body:
const drawStarted = performance.now()
// existing drawing logic remains unchanged
recordEditorMetric('draw', performance.now() - drawStarted)
```

Do not change controller dependencies or rendering behavior in this task; measurement and optimization must remain separate commits.

- [ ] **Step 5: Make the fixture exercise `TimelinePreview` deterministically**

Generate a deterministic two-second local fixture, then replace the lightweight `FixturePreview` with `TimelinePreview` using the existing `FIXTURE_SPEC`, `FIXTURE_CONTEXT`, and `/benchmark/editor-fixture.mp4`. Add stable controls:

```powershell
ffmpeg -f lavfi -i color=c=black:s=1080x1920:d=2 -f lavfi -i anullsrc=r=48000:cl=stereo -shortest -c:v libx264 -pix_fmt yuv420p -c:a aac apps/web/public/benchmark/editor-fixture.mp4
```

```tsx
<button data-benchmark="play" onClick={() => setPlaying(true)}>Play fixture</button>
<input data-benchmark="scrubber" aria-label="Benchmark scrubber" ... />
```

The page guard becomes:

```tsx
const benchmarkEnabled = process.env.KLIPMATIC_BENCHMARK === '1'
if (process.env.NODE_ENV !== 'development' && !benchmarkEnabled) notFound()
```

The fixture must still return 404 in a normal production build.

- [ ] **Step 6: Add Playwright configuration and metric test**

```ts
// apps/web/playwright.config.ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  workers: 1,
  retries: 0,
  use: { baseURL: 'http://127.0.0.1:3100', headless: true },
  webServer: {
    command: 'bun run dev -- --hostname 127.0.0.1 --port 3100',
    port: 3100,
    reuseExistingServer: false,
    env: { KLIPMATIC_BENCHMARK: '1' },
  },
})
```

```ts
// apps/web/e2e/editor-performance.spec.ts
import { mkdir, writeFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'

test('collects editor navigation and interaction metrics', async ({ page }) => {
  const samples = []
  for (let run = 1; run <= 3; run += 1) {
    let responseCount = 0
    let responseBytes = 0
    page.on('response', (response) => {
      responseCount += 1
      responseBytes += Number(response.headers()['content-length'] ?? 0)
    })
    const started = performance.now()
    await page.goto('/dev/editor-fixture?benchmark=1', { waitUntil: 'networkidle' })
    const navigationMs = performance.now() - started
    const heapBefore = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? 0)
    await page.locator('[data-benchmark="scrubber"]').evaluate((element) => {
      const input = element as HTMLInputElement
      for (let value = 1; value <= 30; value += 1) {
        input.value = String(value)
        input.dispatchEvent(new Event('input', { bubbles: true }))
      }
    })
    await page.waitForTimeout(250)
    const editor = await page.evaluate(() => window.__KLIPMATIC_EDITOR_BENCHMARK__.read())
    const heapAfter = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? 0)
    expect(editor.counters.draw).toBeGreaterThan(0)
    samples.push(
      { metricId: 'editor.navigation.warm_ms', lane: 'editor', kind: 'warm', unit: 'ms', value: navigationMs, run, status: 'valid' },
      { metricId: 'editor.hydration.warm_ms', lane: 'editor', kind: 'warm', unit: 'ms', value: editor.durations.hydration[0], run, status: 'valid' },
      { metricId: 'editor.draw.count', lane: 'editor', kind: 'warm', unit: 'count', value: editor.counters.draw, run, status: 'valid' },
      { metricId: 'editor.react_commit.count', lane: 'editor', kind: 'warm', unit: 'count', value: editor.counters.react_commit, run, status: 'valid' },
      { metricId: 'editor.controller_create.count', lane: 'editor', kind: 'warm', unit: 'count', value: editor.counters.controller_create ?? 0, run, status: 'valid' },
      { metricId: 'editor.network.count', lane: 'editor', kind: 'warm', unit: 'count', value: responseCount, run, status: 'valid' },
      { metricId: 'editor.network.bytes', lane: 'editor', kind: 'warm', unit: 'bytes', value: responseBytes, run, status: 'valid' },
      { metricId: 'editor.heap_growth.bytes', lane: 'editor', kind: 'warm', unit: 'bytes', value: Math.max(0, heapAfter - heapBefore), run, status: 'valid' },
    )
  }
  await mkdir('../../output/benchmarks', { recursive: true })
  await writeFile('../../output/benchmarks/editor.json', JSON.stringify(samples, null, 2))
})
```

Augment `Window`, `Performance`, and the sample array in the test file with the exact probe and `MetricSample` interfaces so TypeScript remains strict. Register the response listener once per fresh page, or remove it after each run, so counts do not accumulate across runs. Add a one-second `requestAnimationFrame` sampler while fixture playback is active and emit `editor.dropped_frame.count` for gaps greater than 34 ms. Navigate to the same fixture a second time inside each run and emit `editor.cache_repeat.bytes`; this makes the browser cache path visible rather than inferred.

- [ ] **Step 7: Add scripts and Playwright as a dev-only dependency**

Add `@playwright/test` to `apps/web` devDependencies and:

```json
// apps/web/package.json scripts
"benchmark:editor": "playwright test -c playwright.config.ts"
```

```json
// root package.json scripts
"benchmark:editor": "bun --cwd apps/web run benchmark:editor"
```

Run `bun install` so `bun.lock` records the exact dependency graph.

- [ ] **Step 8: Verify the probe and browser lane**

Run: `bunx vitest run apps/web/test/performanceProbe.test.ts apps/web/test/TimelinePreviewScrubbing.test.tsx`

Expected: PASS.

Run: `bunx playwright install chromium`

Expected: Chromium available for the benchmark runner.

Run: `bun run benchmark:editor`

Expected: PASS and `output/benchmarks/editor.json` contains at least three valid samples for navigation, hydration, React commits, draws, controller creation, dropped frames, heap growth, network count/bytes, and repeated-load bytes.

Run: `bun run build`

Expected: PASS; requesting `/dev/editor-fixture` from a normal production start returns 404 because `KLIPMATIC_BENCHMARK` is absent.

Run: `rg -l "controller_create|__KLIPMATIC_EDITOR_BENCHMARK__" apps/web/.next/static/chunks`

Expected: no client chunk match. Guard every probe import/call behind `process.env.NODE_ENV !== 'production'` and adjust the adapter boundary until this check is clean.

- [ ] **Step 9: Commit the browser lane**

```powershell
git add package.json bun.lock apps/web/package.json apps/web/playwright.config.ts apps/web/e2e apps/web/app/dev/editor-fixture/page.tsx apps/web/components/editor apps/web/test/performanceProbe.test.ts
git commit -m "feat(benchmarks): measure editor runtime in Chromium"
```

## Task 4: Seeded Database Lane

**Files:**
- Create: `packages/benchmarks/src/lanes/database.ts`
- Create: `packages/benchmarks/test/database.test.ts`
- Modify: `packages/benchmarks/src/cli.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `MetricSample`, `runTimed`, `listCandidates(sql, userId, projectId)`, and `loadClipEditor(sql, userId, clipId)`.
- Produces: `collectDatabaseLane(databaseUrl, runs): Promise<MetricSample[]>` and `output/benchmarks/database.json`.

- [ ] **Step 1: Write the failing database benchmark integration test**

```ts
// packages/benchmarks/test/database.test.ts
import { afterAll, expect, test } from 'vitest'
import postgres from 'postgres'
import { collectDatabaseLane } from '../src/lanes/database'

const url = process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:55432/klipmatic'
const admin = postgres(url, { max: 1 })

afterAll(async () => admin.end())

test('measures candidate and editor queries with deterministic seed data', async () => {
  const samples = await collectDatabaseLane(url, 3)
  expect(samples.filter((sample) => sample.status === 'valid')).toHaveLength(6)
  expect(new Set(samples.map((sample) => sample.metricId))).toEqual(new Set([
    'database.candidates.warm_ms',
    'database.clip_editor.warm_ms',
  ]))
  expect(samples.every((sample) => sample.value >= 0)).toBe(true)
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `bunx vitest run packages/benchmarks/test/database.test.ts`

Expected: FAIL because the lane does not exist. If Postgres is unavailable, start only the already-defined local database service with `bun run db:up`, then rerun.

- [ ] **Step 3: Implement deterministic seeding and query measurement**

Implement `collectDatabaseLane()` with these exact rules:

```ts
export async function collectDatabaseLane(databaseUrl: string, runs = 3): Promise<MetricSample[]> {
  if (runs < 3) throw new Error('database baseline requires at least three runs')
  const sql = postgres(databaseUrl, { max: 1, prepare: false })
  await resetBenchmarkSchema(sql) // same four migrations used by packages/db/test/helpers.ts
  const fixture = await seedBenchmarkProject(sql, { candidateCount: 100, jobCount: 200 })
  await listCandidates(sql, fixture.userId, fixture.projectId) // warm-up, not recorded
  await loadClipEditor(sql, fixture.userId, fixture.clipId) // warm-up, not recorded
  const samples: MetricSample[] = []
  for (let run = 1; run <= runs; run += 1) {
    samples.push(await measure('database.candidates.warm_ms', run, () =>
      listCandidates(sql, fixture.userId, fixture.projectId)))
    samples.push(await measure('database.clip_editor.warm_ms', run, () =>
      loadClipEditor(sql, fixture.userId, fixture.clipId)))
  }
  await sql.end()
  return samples
}
```

`seedBenchmarkProject` must create one user, one source, one project, 100 candidates, one ready segment, one clip, no transcript row, and 200 historical jobs. This exercises ownership joins and latest-job subqueries without triggering external storage access. `measure` marks thrown query errors as `product_failure` records rather than dropping them.

- [ ] **Step 4: Add the CLI command and root script**

`database --out <path>` reads `TEST_DATABASE_URL`, requires at least three runs outside smoke mode, writes the shared JSON array, and never logs the URL.

```json
"benchmark:database": "bun --cwd packages/benchmarks run benchmark database --out ../../output/benchmarks/database.json"
```

- [ ] **Step 5: Verify the database lane**

Run: `bunx vitest run packages/benchmarks/test/database.test.ts`

Expected: PASS with six valid samples.

Run: `bun run benchmark:database`

Expected: exit 0 and JSON with three candidate-query plus three clip-editor-query samples.

- [ ] **Step 6: Commit the database lane**

```powershell
git add package.json packages/benchmarks/src/cli.ts packages/benchmarks/src/lanes/database.ts packages/benchmarks/test/database.test.ts
git commit -m "feat(benchmarks): measure seeded database hot paths"
```

## Task 5: Mocked Worker Pipeline Lane

**Files:**
- Create: `apps/downloader/scripts/benchmark_pipeline.py`
- Create: `apps/downloader/tests/test_benchmark_pipeline.py`
- Modify: `package.json`

**Interfaces:**
- Consumes: existing worker handlers, pytest `conn` fixture schema, and the shared JSON field names from `MetricSample`.
- Produces: `run_benchmark(conn, runs, output_path) -> list[dict]` and `output/benchmarks/worker.json` without network or paid API calls.

- [ ] **Step 1: Write failing no-network and output-contract tests**

```py
# apps/downloader/tests/test_benchmark_pipeline.py
import json

from scripts.benchmark_pipeline import run_benchmark


def test_pipeline_benchmark_is_deterministic_and_never_uses_network(conn, tmp_path, monkeypatch):
    def forbidden(*args, **kwargs):
        raise AssertionError("network access is forbidden in worker benchmark")

    monkeypatch.setattr("httpx.request", forbidden)
    monkeypatch.setattr("boto3.client", forbidden)
    output = tmp_path / "worker.json"
    samples = run_benchmark(conn, runs=3, output_path=output)

    assert len(samples) == 27
    assert {sample["metricId"] for sample in samples} == {
        "worker.ingest.mock_ms",
        "worker.transcribe.mock_ms",
        "worker.analyze.mock_ms",
        "worker.fetch_segments.mock_ms",
        "worker.preview.mock_ms",
        "worker.cache_hit.mock_ms",
        "worker.provider_call.count",
        "worker.temp_io.bytes",
        "worker.subprocess_proxy.count",
    }
    assert all(sample["lane"] == "worker" for sample in samples)
    assert json.loads(output.read_text(encoding="utf-8")) == samples
```

- [ ] **Step 2: Run the worker test and confirm it fails**

Run: `Set-Location apps/downloader; uv run pytest tests/test_benchmark_pipeline.py -v`

Expected: FAIL because `scripts.benchmark_pipeline` does not exist.

- [ ] **Step 3: Implement the deterministic worker runner**

Use the same handler dependency-injection seams already exercised by `test_transcribe_handler.py`, `test_analyze_handler.py`, `test_fetch_segments.py`, and `test_render_previews.py`:

```py
def measure(metric_id, run, action):
    started = time.perf_counter()
    try:
        action()
    except Exception as exc:
        return {
            "metricId": metric_id,
            "lane": "worker",
            "kind": "warm",
            "unit": "ms",
            "value": (time.perf_counter() - started) * 1000,
            "run": run,
            "status": "invalid",
            "reason": type(exc).__name__,
        }
    return {
        "metricId": metric_id,
        "lane": "worker",
        "kind": "warm",
        "unit": "ms",
        "value": (time.perf_counter() - started) * 1000,
        "run": run,
        "status": "valid",
    }
```

`run_benchmark` resets and reseeds its rows before each measured run. Fake storage operates in memory, fake download writes deterministic bytes under pytest `tmp_path`, fake transcription returns 400 timestamped Indonesian words, fake LLM returns two candidates, and fake FFmpeg/render functions write fixed local bytes. The cache-hit case repeats the same public source and asserts provider, download, and render call counters do not increase. Emit provider-call count, total temporary bytes written, and fake download/FFmpeg invocation count (`worker.subprocess_proxy.count`) once per run alongside the six stage durations.

- [ ] **Step 4: Add CLI parsing and root script**

The module accepts `--runs`, `--output`, and `--database-url`; it rejects `runs < 3`, defaults the URL from `TEST_DATABASE_URL`, and never prints the URL or fixture content.

```json
"benchmark:worker": "cd apps/downloader && uv run python -m scripts.benchmark_pipeline --runs 3 --output ../../output/benchmarks/worker.json"
```

- [ ] **Step 5: Verify the worker lane and existing handler coverage**

Run: `Set-Location apps/downloader; uv run pytest tests/test_benchmark_pipeline.py tests/test_transcribe_handler.py tests/test_analyze_handler.py tests/test_fetch_segments.py tests/test_render_previews.py -v`

Expected: PASS and no network call.

Run from repo root: `bun run benchmark:worker`

Expected: exit 0 and 27 valid samples in `output/benchmarks/worker.json`.

- [ ] **Step 6: Commit the worker lane**

```powershell
git add package.json apps/downloader/scripts/benchmark_pipeline.py apps/downloader/tests/test_benchmark_pipeline.py
git commit -m "feat(benchmarks): measure mocked worker pipeline"
```

## Task 6: Merge, Noise Classification, Scorecard, and Top-Three Gate

**Files:**
- Create: `packages/benchmarks/src/report.ts`
- Create: `packages/benchmarks/test/report.test.ts`
- Modify: `packages/benchmarks/src/cli.ts`
- Modify: `package.json`
- Create from measured output: `docs/performance/2026-08-25-cross-stack-baseline.md`

**Interfaces:**
- Consumes: lane JSON files, `summarizeSamples()`, and `rankFindings()`.
- Produces: merged `output/benchmarks/baseline.json`, reviewed Markdown scorecard, exactly three selected findings, and a ranked backlog.

- [ ] **Step 1: Write failing report tests**

```ts
// packages/benchmarks/test/report.test.ts
import { expect, test } from 'vitest'
import { buildReport } from '../src/report'

test('marks noisy metrics inconclusive and never ranks them', () => {
  const report = buildReport({
    samples: [10, 20, 40].map((value, index) => ({
      metricId: 'editor.draw_ms', lane: 'editor', kind: 'warm', unit: 'ms',
      value, run: index + 1, status: 'valid',
    })),
    findings: [{
      id: 'draw', metricId: 'editor.draw_ms', title: 'draw',
      impact: 3, frequency: 3, confidence: 3, risk: 2,
    }],
  })
  expect(report.metrics[0]?.status).toBe('inconclusive')
  expect(report.rankedFindings).toEqual([])
})

test('selects exactly three valid findings and keeps the rest as backlog', () => {
  const stableSamples = ['a', 'b', 'c', 'd'].flatMap((metricId) =>
    [10, 10, 10].map((value, index) => ({
      metricId, lane: 'developer' as const, kind: 'warm' as const, unit: 'ms' as const,
      value, run: index + 1, status: 'valid' as const,
    })))
  const findings = ['a', 'b', 'c', 'd'].map((id, index) => ({
    id, metricId: id, title: id, impact: 3 as const, frequency: 3 as const,
    confidence: 3 as const, risk: (index === 3 ? 2 : 1) as 1 | 2,
  }))
  const report = buildReport({ samples: stableSamples, findings })
  expect(report.selected).toHaveLength(3)
  expect(report.backlog).toHaveLength(1)
})
```

- [ ] **Step 2: Run report tests and confirm they fail**

Run: `bunx vitest run packages/benchmarks/test/report.test.ts`

Expected: FAIL because `buildReport` does not exist.

- [ ] **Step 3: Implement merge and noise classification**

`buildReport` groups valid samples by `metricId + kind`, calls `summarizeSamples`, and sets:

```ts
const status = summary.coefficientOfVariation > 0.15 ? 'inconclusive' : 'valid'
```

Invalid-only groups retain `status: 'invalid'` and all reasons. Findings whose metric is not `valid` are excluded before `rankFindings`. The first three ranked findings become `selected`; the remainder become `backlog`. Markdown rendering includes command, lane, cold/warm kind, median, unit, sample count, coefficient of variation, status, evidence note, four score factors, priority, and selection state.

- [ ] **Step 4: Add orchestration commands**

Add these CLI behaviors:

- `merge --input output/benchmarks --out output/benchmarks/baseline.json` loads `developer.json`, `editor.json`, `database.json`, and `worker.json`; a missing lane is an environment failure and exits 1.
- `rank --baseline <path> --findings <path> --out <path>` validates finding scores as integers 1-3 and requires evidence text for confidence 2 or 3.
- `report --baseline <path> --findings <path> --out <path>` writes Markdown and refuses to write unless exactly three valid findings are selected.

Root orchestration becomes:

```json
"benchmark": "bun run benchmark:developer && bun run benchmark:editor && bun run benchmark:database && bun run benchmark:worker && bun --cwd packages/benchmarks run benchmark merge --input ../../output/benchmarks --out ../../output/benchmarks/baseline.json"
```

- [ ] **Step 5: Run unit tests and full static validation before measurement**

Run: `bunx vitest run packages/benchmarks/test`

Expected: PASS.

Run: `bun run typecheck`

Expected: PASS.

Run: `Set-Location apps/downloader; uv run pytest tests/test_benchmark_pipeline.py -v`

Expected: PASS.

- [ ] **Step 6: Execute the complete baseline twice when required by the noise rule**

Run from repo root: `bun run benchmark`

Expected: four lane files plus `output/benchmarks/baseline.json`. Every metric has at least three valid samples or an explicit invalid reason.

Inspect coefficient of variation. If any group exceeds 15%, rerun the complete affected lane once, merge again, and keep it `inconclusive` if it remains above 15%.

- [ ] **Step 7: Profile only evidence-bearing hotspots and score findings**

For each suspicious metric, capture one direct evidence artifact using the relevant built-in tool:

- Developer: Turbo summary, test duration, or Next route-size output.
- Editor: Playwright trace plus probe draw/controller counts.
- Database: `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` for the measured query using seeded IDs.
- Worker: stage duration plus fake dependency call counters and temp-file byte counts.

Create `output/benchmarks/findings.json` using the `FindingScore` fields plus `evidence`, `frequencyReason`, and `riskReason`. Score every factor 1-3 according to the approved design table; do not promote a finding with confidence 1.

- [ ] **Step 8: Generate and review the committed scorecard**

Run:

```powershell
bun --cwd packages/benchmarks run benchmark report --baseline ../../output/benchmarks/baseline.json --findings ../../output/benchmarks/findings.json --out ../../docs/performance/2026-08-25-cross-stack-baseline.md
```

Expected: the report names exactly three selected bottlenecks, lists every other valid finding in ranked backlog order, labels local results as production proxies, and includes reproducible commands without secrets.

- [ ] **Step 9: Run the final audit validation**

Run: `bun run test`

Expected: PASS.

Run: `bun run typecheck`

Expected: PASS.

Run: `bun run build`

Expected: PASS.

Run: `Set-Location apps/downloader; uv run pytest -v`

Expected: PASS.

Run: `git diff --check`

Expected: no whitespace errors.

- [ ] **Step 10: Commit the reproducible audit and reviewed scorecard**

```powershell
git add package.json packages/benchmarks/src packages/benchmarks/test docs/performance/2026-08-25-cross-stack-baseline.md
git commit -m "perf: establish cross-stack optimization baseline"
```

At this point the audit sub-project is complete. Invoke `writing-plans` again
against the three actual selected findings in the committed scorecard. Create
one independent plan per finding, copying its exact metric ID, baseline median,
unit, evidence path, affected files, unchanged benchmark command, and rollback
boundary from measured output. This second planning gate is intentionally not
predicted here: prescribing fix files or code before Task 6 would violate the
approved evidence-first design.
