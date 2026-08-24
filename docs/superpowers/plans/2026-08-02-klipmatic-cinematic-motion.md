# Klipmatic Cinematic Motion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task with validation checkpoints.

**Goal:** Add a CSS-first Cinematic Controlled motion system to Klipmatic with cinematic entrance choreography, coordinated ambient loops, interaction feedback, and full reduced-motion support.

**Architecture:** Keep all decorative animation in `apps/web/app/globals.css` using shared tokens and utility classes. Add semantic hooks to `AppShell`, the landing page, `UrlForm`, and the button primitive without adding React state, animation dependencies, API changes, or editor data-flow changes. Tests cover the stylesheet contract and component hooks; Playwright covers desktop, mobile, console health, overflow, and reduced motion.

**Tech Stack:** Next.js App Router, React 19, Tailwind CSS v4, Vitest, Testing Library, Playwright CLI, native CSS keyframes/transforms.

## Global Constraints

- Preserve the near-black graphite, electric-lime Creator Studio visual system.
- Use CSS-first animation; do not add Framer Motion or another runtime animation dependency.
- Prefer `transform` and `opacity`; do not animate layout properties in ambient loops.
- `prefers-reduced-motion: reduce` disables decorative motion across the whole application.
- Decorative elements use `aria-hidden="true"`; motion is never the only status signal.
- Preserve 44px targets, keyboard focus visibility, API payloads, routing, and backend/editor behavior.
- Desktop gets full choreography; mobile reduces displacement, layers, and shadow intensity without overflow.
- Do not reset or discard unrelated dirty worktree changes.

---

### Task 1: Build the shared motion foundation

**Files:**
- Create: `apps/web/test/motionStyles.test.ts`
- Modify: `apps/web/app/globals.css` near existing keyframes and reduced-motion rules

**Interfaces:** Add `.motion-shell-enter`, `.motion-reveal`, `.motion-grid`, `.motion-scan`, `.motion-intake`, `.motion-signal`, `.motion-workflow-cell`, `.motion-control`, `.motion-cta`, `.motion-cta-arrow`, `.motion-source`, `.motion-delay-1` through `.motion-delay-4`, plus `--motion-ease`, `--motion-fast`, `--motion-slow`, and `--motion-ambient`.

- [ ] **Step 1: Write the failing stylesheet contract test**

```tsx
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../app/globals.css', import.meta.url)), 'utf8')

test('motion foundation exposes cinematic hooks and reduced-motion escape hatch', () => {
  expect(css).toContain('@keyframes grid-drift')
  expect(css).toContain('@keyframes cinematic-scan')
  expect(css).toContain('@keyframes signal-sweep')
  expect(css).toContain('.motion-grid')
  expect(css).toContain('.motion-reveal')
  expect(css).toContain('.motion-cta')
  expect(css).toContain('@media (prefers-reduced-motion: reduce)')
  expect(css).toContain('animation: none !important')
})
```

- [ ] **Step 2: Run the test and verify RED**

Run `bun x vitest run apps/web/test/motionStyles.test.ts`. It must fail because the new keyframes and classes do not exist.

- [ ] **Step 3: Implement the CSS foundation**

Add tokens and keyframes for `grid-drift`, `cinematic-scan`, `intake-float`, `signal-sweep`, `studio-enter`, `motion-reveal`, `motion-lift`, and `ready-pulse`. Ambient loops must use `transform`/`opacity`, with only a restrained intake shadow change. Add explicit delay classes rather than React timers. Extend the global reduced-motion media query to stop every decorative class and disable smooth scrolling while preserving color/border focus feedback.

- [ ] **Step 4: Run the test and verify GREEN**

Run `bun x vitest run apps/web/test/motionStyles.test.ts`. Expected: one passing test.

- [ ] **Step 5: Re-run current shell and primitive tests**

Run `bun x vitest run apps/web/test/ui/primitives.test.tsx apps/web/test/AppShell.test.tsx`. Expected: existing tests remain green.

### Task 2: Make the studio rail the scanning-playhead anchor

**Files:**
- Modify: `apps/web/test/AppShell.test.tsx`
- Modify: `apps/web/components/AppShell.tsx`

**Interfaces:** Keep `AppShell({ children }: { children: React.ReactNode })` and the accessible rail labels. Add `.motion-shell-enter`, `.studio-rail`, `.studio-rail-signal`, and `.studio-rail-step`.

- [ ] **Step 1: Add failing hook assertions**

```tsx
expect(screen.getByRole('banner')).toHaveClass('motion-shell-enter')
expect(screen.getByLabelText('Studio rail')).toHaveClass('studio-rail')
expect(screen.getByLabelText('Studio rail').querySelector('[aria-hidden="true"]')).toHaveClass('studio-rail-signal')
```

- [ ] **Step 2: Run `bun x vitest run apps/web/test/AppShell.test.tsx` and verify RED** because the hooks are absent.

- [ ] **Step 3: Add the hooks and one `aria-hidden="true"` signal span**

Put `motion-shell-enter` on the header, `studio-rail` on the rail, `studio-rail-step` on each item, and a single `studio-rail-signal` child inside the rail. Keep all visible labels as normal text and do not change navigation.

- [ ] **Step 4: Run the shell test and verify GREEN**

Run `bun x vitest run apps/web/test/AppShell.test.tsx`. Expected: all existing and new assertions pass.

### Task 3: Add landing entrance choreography and big loops

**Files:**
- Create: `apps/web/test/HomeMotion.test.tsx`
- Modify: `apps/web/app/page.tsx`

**Interfaces:** Keep `Home` as a server component and existing copy/form behavior. Add `.motion-reveal`, `.motion-grid`, `.motion-scan`, `.motion-intake`, `.motion-source`, `.motion-workflow-cell`, and `.motion-signal`; decorative layers are `aria-hidden="true"`.

- [ ] **Step 1: Write the failing hook test**

```tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import Home from '@/app/page'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

test('landing exposes cinematic intake choreography hooks', () => {
  render(<Home />)
  expect(screen.getByRole('heading', { level: 1 })).toHaveClass('motion-reveal')
  expect(screen.getByLabelText('Clip intake desk')).toHaveClass('motion-intake')
  expect(screen.getByLabelText('Clip intake desk').querySelector('[aria-hidden="true"]')).toHaveClass('motion-scan')
  expect(screen.getByRole('list')).toHaveClass('motion-signal')
  expect(screen.getAllByRole('listitem')[0]).toHaveClass('motion-workflow-cell')
})
```

- [ ] **Step 2: Run `bun x vitest run apps/web/test/HomeMotion.test.tsx` and verify RED** because hooks are absent.

- [ ] **Step 3: Add the landing hooks and layers**

Apply `motion-reveal` and delay classes to badge/headline/description, add one `aria-hidden` scan layer inside the intake desk, apply `motion-intake` to the aside, stagger `motion-source` across source labels, and apply `motion-signal` plus `motion-workflow-cell`/delay classes to the existing workflow list/items. Keep layout, copy, and URL behavior unchanged.

- [ ] **Step 4: Run `bun x vitest run apps/web/test/HomeMotion.test.tsx apps/web/test/UrlForm.test.tsx` and verify GREEN**.

- [ ] **Step 5: Run `bun run typecheck` and verify Turbo TypeScript tasks pass**.

### Task 4: Add small-loop CTA and shared-control feedback

**Files:**
- Modify: `apps/web/test/ui/primitives.test.tsx`
- Modify: `apps/web/test/UrlForm.test.tsx`
- Modify: `apps/web/components/ui/button.tsx`
- Modify: `apps/web/components/UrlForm.tsx`
- Modify: `apps/web/app/page.tsx`

**Interfaces:** Preserve all button props, disabled behavior, URL POST body `{ url }`, and router destination. Add `.motion-control`, `.motion-cta`, `.motion-cta-arrow`, and `.motion-source-active`.

- [ ] **Step 1: Add failing assertions**

Extend the primitive button assertion with `motion-control`. In `UrlForm.test.tsx`, assert the submit button has `motion-cta` and its SVG child has `motion-cta-arrow`.

- [ ] **Step 2: Run `bun x vitest run apps/web/test/ui/primitives.test.tsx apps/web/test/UrlForm.test.tsx` and verify RED** because the classes are absent.

- [ ] **Step 3: Implement interaction-only feedback**

Add `motion-control` to the button base class, `motion-cta` to the URL submit button, and `motion-cta-arrow` to its arrow. Use CSS opacity/border changes for source-monitor activation; do not add timers or React state for ambience. Keep loading spinner motion informative and preserve the existing submit handler.

- [ ] **Step 4: Re-run the focused tests and verify GREEN**.

- [ ] **Step 5: Run `bun x vitest run apps/web/test`**. Expected: frontend tests pass; if DB-backed suites still report the known PostgreSQL `127.0.0.1:55432` refusal, record it as environment-only.

### Task 5: Browser QA and final validation

**Files:**
- Modify: no source files unless QA exposes a concrete regression
- Create: `output/playwright/home-motion-desktop.png` and `output/playwright/home-motion-mobile.png`

**Interfaces:** Validate the built app at `http://127.0.0.1:3000/`; use Playwright reduced-motion emulation before navigation.

- [ ] **Step 1: Run `bun run build`** and verify the Next.js production build succeeds.

- [ ] **Step 2: Start production with `bun --cwd=apps/web --env-file=../../.env run start -- -p 3000`** and verify the server reports Ready.

- [ ] **Step 3: Playwright desktop QA at 1440x1000**

Snapshot and capture the desktop artifact. Verify sequence timing, grid drift, hero scan, intake float, workflow signal, no horizontal overflow, and zero browser console errors/warnings.

- [ ] **Step 4: Playwright mobile QA at 390x844**

Snapshot and capture the mobile artifact. Verify intake enters from below, rail remains readable, CTA stays inside viewport, and workflow cells do not overlap.

- [ ] **Step 5: Playwright reduced-motion QA**

Emulate `prefers-reduced-motion: reduce`, reload, assert motion nodes have `animationName === 'none'` or `animationDuration === '0.01ms'`, and assert headline/form/workflow remain visible.

- [ ] **Step 6: Run `bun run typecheck` and `git diff --check`**. Expected: both pass.

- [ ] **Step 7: Review status and commit only motion implementation files/tests**

Use `git status --short`, then stage the exact motion files and commit with `git commit -m "feat: add cinematic controlled motion system"`. Do not stage unrelated dirty files or `.superpowers/`.
