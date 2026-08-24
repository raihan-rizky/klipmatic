# Klipmatic Full Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a polished Creator Studio frontend for every Klipmatic P2 route without changing existing backend contracts or feature behavior.

**Architecture:** Tailwind CSS supplies tokens, layout, responsive styling, and state variants. Locally owned shadcn-style components wrap Radix UI primitives for accessible interactions, while feature components retain their current data ownership and API calls. Large editor and settings components are split by responsibility so presentation can be tested independently from orchestration.

**Tech Stack:** Next.js 15, React 19, TypeScript, Tailwind CSS, Radix UI, class-variance-authority, Lucide React, Vitest, Testing Library, Playwright.

## Global Constraints

- Use near-black charcoal, graphite surfaces, electric lime primary actions, muted gray secondary text, and amber/red warning states.
- UI copy is concise Bahasa Indonesia.
- Landing, login, project, and settings are responsive from mobile through desktop.
- Editor is optimized for desktop/tablet and remains readable as a stacked mobile fallback.
- Preserve all existing API routes, Supabase auth/Realtime behavior, ownership checks, polling fallbacks, browser export, and download behavior.
- Do not add cloud rendering, providers, endpoints, database migrations, or external font dependencies.
- Every interactive target is at least 44px and has visible electric-lime keyboard focus.
- Internal errors and credentials never appear in user-facing UI.

---

## File Structure

### Foundation

- Create `apps/web/postcss.config.mjs`: Tailwind PostCSS integration.
- Create `apps/web/app/globals.css`: design tokens, Tailwind import, base styles, and reusable animation utilities.
- Create `apps/web/lib/utils.ts`: `cn(...inputs)` class merge helper.
- Create `apps/web/components/ui/*.tsx`: locally owned Button, Card, Input, Badge, Alert, Progress, AlertDialog, Select, Accordion, Skeleton, and Tooltip.
- Create `apps/web/test/ui/primitives.test.tsx`: rendering and keyboard interaction coverage for the UI layer.

### Shared Shell

- Create `apps/web/components/AppShell.tsx`: responsive brand, navigation, and account entry.
- Create `apps/web/components/PageHeader.tsx`: consistent title, eyebrow, description, and actions.
- Create `apps/web/components/StatePanel.tsx`: loading, empty, error, and informational page state.
- Modify `apps/web/app/layout.tsx`: load global CSS and render the app shell.
- Create `apps/web/test/AppShell.test.tsx`: navigation and landmark coverage.

### Feature Surfaces

- Modify `apps/web/app/page.tsx` and `apps/web/components/UrlForm.tsx`: landing hero and primary URL workflow.
- Modify auth pages and `ImplicitMagicLinkForm.tsx`: cohesive login/account/callback states.
- Modify project page, error boundary, `JobProgress.tsx`, `CandidateList.tsx`, and `CreateClipButton.tsx`: staged pipeline and candidate cards.
- Create `apps/web/components/settings/ApiKeyCard.tsx` and `DeleteApiKeyButton.tsx`; modify `ApiKeyForm.tsx` and settings page.
- Create `apps/web/components/editor/EditorPreview.tsx`, `CropControls.tsx`, `CaptionControls.tsx`, `EditorActionBar.tsx`, and `editorViewState.ts`; keep `ClipEditor.tsx` as the orchestration boundary.

### Browser Validation

- Use the installed Playwright CLI skill against the local Next.js server.
- Store screenshots and browser artifacts under `output/playwright/`, which remains outside production source.

---

### Task 1: Tailwind and Accessible UI Foundation

**Files:**
- Modify: `apps/web/package.json`
- Create: `apps/web/postcss.config.mjs`
- Create: `apps/web/app/globals.css`
- Create: `apps/web/lib/utils.ts`
- Create: `apps/web/components/ui/button.tsx`
- Create: `apps/web/components/ui/card.tsx`
- Create: `apps/web/components/ui/input.tsx`
- Create: `apps/web/components/ui/badge.tsx`
- Create: `apps/web/components/ui/alert.tsx`
- Create: `apps/web/components/ui/progress.tsx`
- Create: `apps/web/components/ui/alert-dialog.tsx`
- Create: `apps/web/components/ui/select.tsx`
- Create: `apps/web/components/ui/accordion.tsx`
- Create: `apps/web/components/ui/skeleton.tsx`
- Create: `apps/web/components/ui/tooltip.tsx`
- Create: `apps/web/test/ui/primitives.test.tsx`

**Interfaces:**
- Produces: `cn(...inputs: ClassValue[]): string`.
- Produces: `buttonVariants({ variant, size, className })`.
- Produces UI exports using `React.ComponentProps` and Radix-compatible `ref` forwarding.
- Consumes: no application feature modules.

- [ ] **Step 1: Write the failing primitive test**

```tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'

describe('UI primitives', () => {
  test('button keeps a visible focus treatment and 44px target', () => {
    render(<Button>Mulai</Button>)
    expect(screen.getByRole('button', { name: 'Mulai' })).toHaveClass('min-h-11', 'focus-visible:ring-2')
  })

  test('alert dialog requires an explicit destructive confirmation', () => {
    const confirm = vi.fn()
    render(
      <AlertDialog>
        <AlertDialogTrigger asChild><Button>Hapus</Button></AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus key?</AlertDialogTitle>
            <AlertDialogDescription>Key tidak dapat dipulihkan.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={confirm}>Hapus permanen</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Hapus' }))
    expect(screen.getByRole('alertdialog')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Hapus permanen' }))
    expect(confirm).toHaveBeenCalledOnce()
  })

  test('progress exposes its value to assistive technology', () => {
    render(<Progress value={42} aria-label="Proses video" />)
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '42')
  })
})
```

- [ ] **Step 2: Run the test and verify RED**

Run: `bun x vitest run apps/web/test/ui/primitives.test.tsx`

Expected: FAIL because `@/components/ui/button`, `progress`, and `alert-dialog` do not exist.

- [ ] **Step 3: Install the frontend and test dependencies**

Run:

```powershell
bun --cwd apps/web add class-variance-authority clsx tailwind-merge lucide-react @radix-ui/react-accordion @radix-ui/react-alert-dialog @radix-ui/react-progress @radix-ui/react-select @radix-ui/react-slot @radix-ui/react-tooltip
bun --cwd apps/web add --dev tailwindcss @tailwindcss/postcss @testing-library/dom @testing-library/jest-dom @testing-library/react @testing-library/user-event jsdom
```

Expected: `apps/web/package.json` and root `bun.lock` contain the new dependencies.

- [ ] **Step 4: Add Tailwind configuration and tokens**

```js
// apps/web/postcss.config.mjs
export default {
  plugins: {
    '@tailwindcss/postcss': {},
  },
}
```

```css
/* apps/web/app/globals.css */
@import "tailwindcss";

:root {
  color-scheme: dark;
  --background: #090b0d;
  --surface: #111519;
  --surface-raised: #171c21;
  --border: #293038;
  --foreground: #f4f7f1;
  --muted: #929b94;
  --primary: #c7ff45;
  --primary-foreground: #101408;
  --warning: #f6b94a;
  --danger: #ff6470;
}

@theme inline {
  --color-background: var(--background);
  --color-surface: var(--surface);
  --color-surface-raised: var(--surface-raised);
  --color-border: var(--border);
  --color-foreground: var(--foreground);
  --color-muted: var(--muted);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-warning: var(--warning);
  --color-danger: var(--danger);
}

* { border-color: var(--border); }
html { background: var(--background); }
body {
  min-height: 100vh;
  margin: 0;
  background: var(--background);
  color: var(--foreground);
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  text-rendering: optimizeLegibility;
}
button, input, select, textarea { font: inherit; }
::selection { background: var(--primary); color: var(--primary-foreground); }
```

- [ ] **Step 5: Implement the shared class helper and primitive contracts**

```ts
// apps/web/lib/utils.ts
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

Use `cva` in `button.tsx` with these exact variants:

```ts
variant: {
  primary: 'bg-primary text-primary-foreground hover:bg-primary/90',
  secondary: 'border border-border bg-surface-raised text-foreground hover:border-primary/50',
  ghost: 'bg-transparent text-muted hover:bg-surface-raised hover:text-foreground',
  destructive: 'bg-danger text-white hover:bg-danger/90',
},
size: {
  default: 'min-h-11 px-5 py-2.5',
  sm: 'min-h-11 px-3 py-2 text-sm',
  icon: 'size-11',
},
```

Every focusable primitive must include:

```ts
'outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50'
```

Wrap Radix primitives without changing their state model. `Progress` maps
`value` to `aria-valuenow` and translates its indicator with
`translateX(${Math.max(0, Math.min(100, value ?? 0)) - 100}%)`.

- [ ] **Step 6: Run focused tests and typecheck**

Run:

```powershell
bun x vitest run apps/web/test/ui/primitives.test.tsx
bun --cwd apps/web run typecheck
```

Expected: PASS with no TypeScript errors.

- [ ] **Step 7: Commit the foundation**

```powershell
git add apps/web/package.json bun.lock apps/web/postcss.config.mjs apps/web/app/globals.css apps/web/lib/utils.ts apps/web/components/ui apps/web/test/ui/primitives.test.tsx
git commit -m "feat(web): add creator studio design foundation"
```

### Task 2: Responsive App Shell and Shared Page States

**Files:**
- Modify: `apps/web/app/layout.tsx`
- Create: `apps/web/components/AppShell.tsx`
- Create: `apps/web/components/PageHeader.tsx`
- Create: `apps/web/components/StatePanel.tsx`
- Create: `apps/web/test/AppShell.test.tsx`

**Interfaces:**
- Consumes: `Button`, `Badge`, `TooltipProvider`, `cn`.
- Produces: `AppShell({ children }: { children: ReactNode })`.
- Produces: `PageHeader({ eyebrow?, title, description?, actions? })`.
- Produces: `StatePanel({ tone, title, description, action?, busy? })`.

- [ ] **Step 1: Write the failing app-shell test**

```tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { test, expect } from 'vitest'
import { AppShell } from '@/components/AppShell'

test('app shell exposes brand, primary navigation, and content landmark', () => {
  render(<AppShell><h1>Konten</h1></AppShell>)
  expect(screen.getByRole('link', { name: /Klipmatic/i })).toHaveAttribute('href', '/')
  expect(screen.getByRole('navigation', { name: 'Navigasi utama' })).toBeVisible()
  expect(screen.getByRole('link', { name: 'Buat klip' })).toHaveAttribute('href', '/')
  expect(screen.getByRole('link', { name: 'API Key' })).toHaveAttribute('href', '/settings/keys')
  expect(screen.getByRole('main')).toContainElement(screen.getByRole('heading', { name: 'Konten' }))
})
```

- [ ] **Step 2: Run the test and verify RED**

Run: `bun x vitest run apps/web/test/AppShell.test.tsx`

Expected: FAIL because `AppShell` does not exist.

- [ ] **Step 3: Implement shell and shared state components**

`AppShell` renders one `<main id="main-content">`, a skip link, sticky header,
brand mark using `Clapperboard`, desktop navigation, and a compact mobile
navigation row. Use `max-w-[1440px]`, `px-4 sm:px-6 lg:px-8`, and
`min-h-[calc(100vh-65px)]`.

`PageHeader` contract:

```tsx
type PageHeaderProps = {
  eyebrow?: string
  title: string
  description?: string
  actions?: React.ReactNode
}
```

`StatePanel` contract:

```tsx
type StatePanelProps = {
  tone?: 'neutral' | 'warning' | 'danger'
  title: string
  description: string
  action?: React.ReactNode
  busy?: boolean
}
```

When `busy` is true, `StatePanel` renders `role="status"` and an animated
`LoaderCircle`; danger renders `role="alert"`.

- [ ] **Step 4: Wire the root layout**

```tsx
import './globals.css'
import { AppShell } from '@/components/AppShell'

export const metadata = {
  title: { default: 'Klipmatic', template: '%s · Klipmatic' },
  description: 'Ubah video panjang menjadi klip pendek siap posting.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body><AppShell>{children}</AppShell></body>
    </html>
  )
}
```

- [ ] **Step 5: Verify shell tests and typecheck**

Run:

```powershell
bun x vitest run apps/web/test/AppShell.test.tsx apps/web/test/ui/primitives.test.tsx
bun --cwd apps/web run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit the shell**

```powershell
git add apps/web/app/layout.tsx apps/web/components/AppShell.tsx apps/web/components/PageHeader.tsx apps/web/components/StatePanel.tsx apps/web/test/AppShell.test.tsx
git commit -m "feat(web): add responsive app shell"
```

### Task 3: Landing and URL Creation Experience

**Files:**
- Modify: `apps/web/app/page.tsx`
- Modify: `apps/web/components/UrlForm.tsx`
- Create: `apps/web/test/UrlForm.test.tsx`

**Interfaces:**
- Consumes: `Button`, `Input`, `Badge`, `Card`, `Alert`.
- Preserves: `POST /api/projects` body `{ url: string }`.
- Preserves: success navigation `/projects/${projectId}?job=${jobId}`.

- [ ] **Step 1: Write failing landing-form tests**

```tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'
import { UrlForm } from '@/components/UrlForm'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))

beforeEach(() => {
  push.mockReset()
  vi.unstubAllGlobals()
})

test('submits the source URL and opens the created project', async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ projectId: 'project-1', jobId: 'job-1' }),
  })
  vi.stubGlobal('fetch', fetchMock)
  render(<UrlForm />)
  await userEvent.type(screen.getByLabelText('Link video'), 'https://youtu.be/dQw4w9WgXcQ')
  await userEvent.click(screen.getByRole('button', { name: 'Cari klip terbaik' }))
  expect(fetchMock).toHaveBeenCalledWith('/api/projects', expect.objectContaining({
    method: 'POST',
    body: JSON.stringify({ url: 'https://youtu.be/dQw4w9WgXcQ' }),
  }))
  expect(push).toHaveBeenCalledWith('/projects/project-1?job=job-1')
})
```

- [ ] **Step 2: Run the test and verify RED**

Run: `bun x vitest run apps/web/test/UrlForm.test.tsx`

Expected: FAIL because the current form labels and CTA do not match the new interface.

- [ ] **Step 3: Implement the landing hero and form states**

Use the exact hero copy:

```tsx
<p>AI VIDEO CLIPPER UNTUK CREATOR</p>
<h1>Video panjang masuk. Klip siap posting keluar.</h1>
<p>Tempel link, biarkan AI menemukan momen terbaik, lalu edit dan ekspor langsung di browser.</p>
```

Keep supported badges limited to `YouTube`, `TikTok`, and `Google Drive`.
Render three steps with `Link2`, `Sparkles`, and `Clapperboard` icons.

In `UrlForm`, keep the existing fetch and error behavior while changing the
visible label to `Link video`, placeholder to
`https://youtube.com/watch?v=...`, idle CTA to `Cari klip terbaik`, and busy CTA
to `Menganalisis video…`. The error uses `Alert` with `role="alert"`.

- [ ] **Step 4: Verify landing tests and typecheck**

Run:

```powershell
bun x vitest run apps/web/test/UrlForm.test.tsx
bun --cwd apps/web run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit the landing**

```powershell
git add apps/web/app/page.tsx apps/web/components/UrlForm.tsx apps/web/test/UrlForm.test.tsx
git commit -m "feat(web): redesign clip creation landing"
```

### Task 4: Login, Account, and Auth Callback States

**Files:**
- Modify: `apps/web/app/login/page.tsx`
- Modify: `apps/web/app/auth/implicit/page.tsx`
- Modify: `apps/web/components/ImplicitMagicLinkForm.tsx`
- Create: `apps/web/test/ImplicitMagicLinkForm.test.tsx`

**Interfaces:**
- Consumes: `Card`, `Input`, `Button`, `Alert`, `StatePanel`, `PageHeader`.
- Preserves: Supabase implicit OTP configuration and `/auth/implicit` callback.
- Preserves: server action `signOut`.

- [ ] **Step 1: Write the failing form-state test**

```tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test } from 'vitest'
import { ImplicitMagicLinkForm } from '@/components/ImplicitMagicLinkForm'

test('rejects an invalid email with a clear status message', async () => {
  render(<ImplicitMagicLinkForm initialMessage={null} />)
  await userEvent.type(screen.getByLabelText('Alamat email'), 'nama@domain')
  await userEvent.click(screen.getByRole('button', { name: 'Kirim magic link' }))
  expect(screen.getByRole('status')).toHaveTextContent('Masukkan alamat email yang valid.')
})
```

- [ ] **Step 2: Run the test and verify RED**

Run: `bun x vitest run apps/web/test/ImplicitMagicLinkForm.test.tsx`

Expected: FAIL because the label is currently `Email`.

- [ ] **Step 3: Implement auth presentation**

The anonymous login card uses heading `Masuk tanpa password`, label
`Alamat email`, and helper copy `Kami akan mengirim link sekali pakai ke inbox
kamu.` The signed-in account uses a shield icon, email badge, `Buat klip baru`
primary action, and `Keluar` secondary action.

The callback page renders:

```ts
loading: {
  title: 'Menyiapkan workspace kamu',
  description: 'Session sedang diamankan di browser ini.',
}
failed: {
  title: 'Link tidak bisa dipakai',
  description: 'Link mungkin sudah dipakai atau kedaluwarsa. Minta link baru untuk melanjutkan.',
}
```

Continue clearing token fragments from browser history before setting the
Supabase session.

- [ ] **Step 4: Verify auth tests and typecheck**

Run:

```powershell
bun x vitest run apps/web/test/ImplicitMagicLinkForm.test.tsx
bun --cwd apps/web run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit auth UI**

```powershell
git add apps/web/app/login/page.tsx apps/web/app/auth/implicit/page.tsx apps/web/components/ImplicitMagicLinkForm.tsx apps/web/test/ImplicitMagicLinkForm.test.tsx
git commit -m "feat(web): polish passwordless auth experience"
```

### Task 5: Pipeline Progress and Candidate Cards

**Files:**
- Modify: `apps/web/app/projects/[id]/page.tsx`
- Modify: `apps/web/app/projects/[id]/error.tsx`
- Modify: `apps/web/components/JobProgress.tsx`
- Modify: `apps/web/components/CandidateList.tsx`
- Modify: `apps/web/components/CreateClipButton.tsx`
- Create: `apps/web/test/CandidateList.test.tsx`

**Interfaces:**
- Consumes: `PageHeader`, `StatePanel`, `Card`, `Badge`, `Progress`, `Accordion`, `Button`.
- Preserves: `JobProgress({ projectId })` Supabase query, Realtime subscription, 3-second polling, and completed-analysis reload.
- Preserves: `CandidateList({ candidates: CandidateView[] })`.

- [ ] **Step 1: Write the failing candidate card test**

```tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { CandidateList } from '@/components/CandidateList'

vi.mock('@/components/CreateClipButton', () => ({
  CreateClipButton: () => <button>Edit klip</button>,
}))

test('renders ranked candidate details and transcript disclosure', () => {
  render(<CandidateList candidates={[{
    id: 'candidate-1',
    title: 'Hook yang kuat',
    hookText: 'Kalimat pembuka',
    startSec: 10,
    endSec: 42,
    score: 0.91,
    reason: 'Langsung ke inti',
    transcriptSlice: 'Isi transkrip',
  }]} />)
  expect(screen.getByText('#1')).toBeVisible()
  expect(screen.getByText('91')).toBeVisible()
  expect(screen.getByRole('button', { name: /Lihat kutipan/i })).toBeVisible()
  expect(screen.getByRole('button', { name: 'Edit klip' })).toBeVisible()
})
```

- [ ] **Step 2: Run the test and verify RED**

Run: `bun x vitest run apps/web/test/CandidateList.test.tsx`

Expected: FAIL because ranked card and Radix accordion UI do not exist.

- [ ] **Step 3: Implement the staged project experience**

`JobProgress` maps its existing latest job to three visible labels:
`Ambil video`, `Transkripsi`, and `Cari highlight`. It must not fabricate
per-stage percentages unavailable from the backend. The current active state
uses lime; completed prior stages use check icons; later stages stay muted.

Candidate cards render:

```tsx
<Badge>#1</Badge>
<Badge variant="score">91</Badge>
<h2>Hook yang kuat</h2>
<p>Kalimat pembuka</p>
<span>00:10–00:42</span>
```

Use the existing `formatRange` result for the visible range. Keep `reason`
optional and transcript collapsed by default. `CreateClipButton` keeps the
same request and navigation and adopts consistent busy/error visuals.

The project error boundary uses `StatePanel` with title
`Project belum bisa dimuat`, existing `messageFor('INTERNAL')`, and `Coba lagi`.

- [ ] **Step 4: Verify project tests and existing progress tests**

Run:

```powershell
bun x vitest run apps/web/test/CandidateList.test.tsx apps/web/test/jobProgress.test.ts
bun --cwd apps/web run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit project UI**

```powershell
git add apps/web/app/projects apps/web/components/JobProgress.tsx apps/web/components/CandidateList.tsx apps/web/components/CreateClipButton.tsx apps/web/test/CandidateList.test.tsx
git commit -m "feat(web): redesign pipeline and candidate results"
```

### Task 6: Secure API Key Settings

**Files:**
- Modify: `apps/web/app/settings/keys/page.tsx`
- Modify: `apps/web/components/ApiKeyForm.tsx`
- Create: `apps/web/components/settings/ApiKeyCard.tsx`
- Create: `apps/web/components/settings/DeleteApiKeyButton.tsx`
- Create: `apps/web/test/DeleteApiKeyButton.test.tsx`

**Interfaces:**
- Consumes: `PageHeader`, `Card`, `Input`, `Select`, `Badge`, `AlertDialog`, `Button`.
- Produces: `ApiKeyCard({ apiKey }: { apiKey: PublicApiKey })`, importing
  `PublicApiKey` from `@/lib/apiKeys`.
- Produces: `DeleteApiKeyButton({ id, label })`.
- Preserves: `requestDeleteKey(id)` and `router.refresh()`.

- [ ] **Step 1: Write the failing delete confirmation test**

```tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { DeleteApiKeyButton } from '@/components/settings/DeleteApiKeyButton'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
vi.mock('@/lib/apiKeyForm', () => ({
  requestDeleteKey: vi.fn().mockResolvedValue({ ok: true }),
}))

test('explains irreversible deletion before calling the API', async () => {
  render(<DeleteApiKeyButton id="key-1" label="Nebius utama" />)
  await userEvent.click(screen.getByRole('button', { name: 'Hapus key Nebius utama' }))
  expect(screen.getByRole('alertdialog')).toHaveTextContent('tidak dapat dipulihkan')
  await userEvent.click(screen.getByRole('button', { name: 'Hapus permanen' }))
  expect(refresh).toHaveBeenCalledOnce()
})
```

- [ ] **Step 2: Run the test and verify RED**

Run: `bun x vitest run apps/web/test/DeleteApiKeyButton.test.tsx`

Expected: FAIL because the extracted component and AlertDialog flow do not exist.

- [ ] **Step 3: Implement settings cards, form sections, and dialog**

Move deletion behavior out of `ApiKeyForm.tsx`. The dialog title is
`Hapus “{label}”?`, description includes `Secret tidak dapat dipulihkan`, the
cancel action is `Batal`, and the destructive action is `Hapus permanen`.

`ApiKeyCard` shows label, provider, model, optional base URL, optional
`Terakhir dipakai {formattedTime}`, and a `Terenkripsi` badge.

Keep the current preset/provider behavior and form payload. Group the fields
under visible labels `Pilih penyedia` and `Detail kredensial`; retain datalist
model suggestions and `autoComplete="off"` for the secret.

- [ ] **Step 4: Verify settings tests and existing API key tests**

Run:

```powershell
bun x vitest run apps/web/test/DeleteApiKeyButton.test.tsx apps/web/test/apiKeys.test.ts
bun --cwd apps/web run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit settings UI**

```powershell
git add apps/web/app/settings/keys/page.tsx apps/web/components/ApiKeyForm.tsx apps/web/components/settings apps/web/test/DeleteApiKeyButton.test.tsx
git commit -m "feat(web): redesign secure api key settings"
```

### Task 7: Structured Clip Editor Workspace

**Files:**
- Modify: `apps/web/components/ClipEditor.tsx`
- Create: `apps/web/components/editor/editorViewState.ts`
- Create: `apps/web/components/editor/EditorPreview.tsx`
- Create: `apps/web/components/editor/CropControls.tsx`
- Create: `apps/web/components/editor/CaptionControls.tsx`
- Create: `apps/web/components/editor/EditorActionBar.tsx`
- Create: `apps/web/test/editorViewState.test.ts`
- Create: `apps/web/test/EditorControls.test.tsx`

**Interfaces:**
- Consumes: `EditSpecV1`, `ClipEditorPayload`, existing engine/export/focus/cache functions.
- Produces: `editorViewState(payload, spec, mediaUrl, fatalError): EditorViewState`.
- Produces controlled crop and caption panels receiving `spec` and `onChange(nextSpec)`.
- Preserves: all current polling, canvas composition, save, autofocus, export, and object URL cleanup behavior.

- [ ] **Step 1: Write the failing editor-state tests**

```ts
import { describe, expect, test } from 'vitest'
import { editorViewState } from '@/components/editor/editorViewState'

describe('editorViewState', () => {
  test('shows a fatal load error before payload exists', () => {
    expect(editorViewState(null, null, null, 'Editor gagal dimuat.')).toBe('error')
  })
  test('keeps users informed while the worker prepares a segment', () => {
    expect(editorViewState({ segment: { status: 'pending', url: null } }, {}, null, null)).toBe('preparing')
  })
  test('waits for the browser cache after the segment is ready', () => {
    expect(editorViewState({ segment: { status: 'ready', url: 'signed' } }, {}, null, null)).toBe('caching')
  })
  test('enters the workspace only when payload, spec, and media are ready', () => {
    expect(editorViewState({ segment: { status: 'ready', url: 'signed' } }, {}, 'blob:clip', null)).toBe('ready')
  })
})
```

The helper accepts structural minimums for its payload/spec arguments so these
tests do not construct the full server payload.

- [ ] **Step 2: Run editor-state tests and verify RED**

Run: `bun x vitest run apps/web/test/editorViewState.test.ts`

Expected: FAIL because `editorViewState` does not exist.

- [ ] **Step 3: Implement the state helper**

```ts
export type EditorViewState = 'loading' | 'error' | 'failed' | 'preparing' | 'caching' | 'ready'

type StatePayload = { segment: { status: 'pending' | 'ready' | 'failed'; url: string | null } }

export function editorViewState(
  payload: StatePayload | null,
  spec: object | null,
  mediaUrl: string | null,
  fatalError: string | null,
): EditorViewState {
  if (fatalError && !payload) return 'error'
  if (!payload || !spec) return 'loading'
  if (payload.segment.status === 'failed') return 'failed'
  if (payload.segment.status === 'pending' || !payload.segment.url) return 'preparing'
  if (!mediaUrl) return 'caching'
  return 'ready'
}
```

- [ ] **Step 4: Write failing controlled-panel tests**

```tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { normalizeEditSpec } from '@klipmatic/engine'
import { CropControls } from '@/components/editor/CropControls'
import { CaptionControls } from '@/components/editor/CaptionControls'

test('crop panel exposes manual and face focus controls', () => {
  render(<CropControls spec={normalizeEditSpec(null)} onChange={vi.fn()} onAutoFocus={vi.fn()} />)
  expect(screen.getByLabelText('Fokus horizontal')).toBeVisible()
  expect(screen.getByLabelText('Zoom')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Deteksi wajah' })).toBeVisible()
})

test('caption panel can disable karaoke captions', async () => {
  const onChange = vi.fn()
  render(<CaptionControls spec={normalizeEditSpec(null)} onChange={onChange} />)
  await userEvent.click(screen.getByRole('checkbox', { name: 'Tampilkan caption karaoke' }))
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
    captions: expect.objectContaining({ enabled: false }),
  }))
})
```

- [ ] **Step 5: Run controlled-panel tests and verify RED**

Run: `bun x vitest run apps/web/test/EditorControls.test.tsx`

Expected: FAIL because the editor panel modules do not exist.

- [ ] **Step 6: Extract editor presentation and preserve orchestration**

`EditorPreview` receives `canvasRef`, `videoRef`, `mediaUrl`, `spec`, duration,
and timing precision. It renders the canvas as the dominant 9:16 preview and
the source `<video controls playsInline>` in a secondary card.

`CropControls` and `CaptionControls` always call:

```ts
onChange(normalizeEditSpec({
  ...spec,
  crop: { ...spec.crop, focusX: event.target.value },
}))
```

or the equivalent captions update. They do not own API calls.

`EditorActionBar` receives:

```ts
type EditorActionBarProps = {
  saving: boolean
  exporting: boolean
  exportProgress: number
  exportSupported: boolean
  exportReason?: string
  onSave: () => void
  onExport: () => void
}
```

Keep all effects and async functions in `ClipEditor`. Use `editorViewState` to
render `StatePanel` for loading/preparing/caching/failure, then render a
responsive `lg:grid-cols-[minmax(320px,0.9fr)_minmax(360px,1.1fr)]` workspace
with sticky controls on wide screens.

- [ ] **Step 7: Verify editor tests, existing clip tests, and typecheck**

Run:

```powershell
bun x vitest run apps/web/test/editorViewState.test.ts apps/web/test/EditorControls.test.tsx apps/web/test/clips.test.ts
bun --cwd apps/web run typecheck
```

Expected: PASS and existing export/save behavior remains covered.

- [ ] **Step 8: Commit editor workspace**

```powershell
git add apps/web/components/ClipEditor.tsx apps/web/components/editor apps/web/test/editorViewState.test.ts apps/web/test/EditorControls.test.tsx
git commit -m "feat(web): build structured clip editor workspace"
```

### Task 8: Playwright CLI Browser and Responsive Validation

**Files:**
- Create runtime artifacts only: `output/playwright/`

**Interfaces:**
- Consumes: completed frontend routes served at `http://127.0.0.1:3000`.
- Uses: installed `playwright-cli` wrapper from the Playwright skill.
- Does not create test-only production routes, bypass auth, or add app dependencies.

- [ ] **Step 1: Start the local Next.js server**

Run: `bun run dev`

Expected: Next.js reports the app ready at `http://localhost:3000`.

- [ ] **Step 2: Open and snapshot the landing route**

Run the installed Playwright wrapper with:

```powershell
bash.exe "$env:USERPROFILE/.codex/skills/playwright/scripts/playwright_cli.sh" open http://127.0.0.1:3000
bash.exe "$env:USERPROFILE/.codex/skills/playwright/scripts/playwright_cli.sh" snapshot
```

Expected: snapshot includes the heading
`Video panjang masuk. Klip siap posting keluar.`, the `Link video` input, and
the `Cari klip terbaik` button.

- [ ] **Step 3: Verify keyboard and form interaction**

Use refs from the fresh snapshot:

```powershell
bash.exe "$env:USERPROFILE/.codex/skills/playwright/scripts/playwright_cli.sh" press Tab
bash.exe "$env:USERPROFILE/.codex/skills/playwright/scripts/playwright_cli.sh" snapshot
bash.exe "$env:USERPROFILE/.codex/skills/playwright/scripts/playwright_cli.sh" fill eX "https://youtu.be/dQw4w9WgXcQ"
bash.exe "$env:USERPROFILE/.codex/skills/playwright/scripts/playwright_cli.sh" snapshot
```

Replace `eX` with the `Link video` input ref from the immediately preceding
snapshot. Expected: skip link receives keyboard focus and the URL remains
visible in the enabled form.

- [ ] **Step 4: Inspect landing and login at mobile width**

Use the CLI viewport command documented by `playwright-cli --help`, set the
viewport to `390x844`, visit `/` and `/login`, and snapshot each page. Expected:
no clipped primary content, horizontal page scrolling, overlapping controls,
or touch targets smaller than the 44px design baseline.

- [ ] **Step 5: Inspect desktop project, settings, and editor auth gates**

Visit `/projects/browser-check`, `/settings/keys`, and `/clips/browser-check`
at desktop width and snapshot after each navigation. For an anonymous session,
each protected route must expose a clear login action without leaking internal
errors. If the local Supabase service is unavailable, record the exact route
and error while keeping public-route validation intact.

- [ ] **Step 6: Capture final screenshots**

Create screenshots under `output/playwright/` for the landing desktop, landing
mobile, login mobile, and every authenticated route available in the local
session. Re-snapshot before every screenshot so element refs and page state are
fresh.

### Task 9: Final Regression and Production Audit

**Files:**
- Modify only files producing a verified failure from the commands below.

**Interfaces:**
- Consumes: all prior tasks.
- Produces: a clean full-repository validation result.

- [ ] **Step 1: Run all frontend and shared tests**

Run: `bun run test`

Expected: all Vitest suites PASS.

- [ ] **Step 2: Run monorepo typecheck**

Run: `bun run typecheck`

Expected: all Turbo typecheck tasks PASS.

- [ ] **Step 3: Run production build**

Run: `bun run build`

Expected: Next.js and package builds complete without errors.

- [ ] **Step 4: Re-run Playwright CLI browser checks**

Repeat Task 8 against the final production-equivalent app state.

Expected: required snapshots, interactions, responsive layouts, and accessible
auth gates match Task 8.

- [ ] **Step 5: Inspect the final diff and working tree**

Run:

```powershell
git diff --check
git status --short
```

Expected: no whitespace errors; only intentional frontend changes and existing
unrelated user changes are present.
