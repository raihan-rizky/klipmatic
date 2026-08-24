# Klipmatic Full Rebrand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every relevant Klipmatic product, package, infrastructure, protocol, test, and documentation reference with Klipmatic.

**Architecture:** This is a repository-wide naming migration with no compatibility aliases. Content replacements happen before documentation filename renames so internal links can be updated deterministically. Existing unrelated working-tree changes remain untouched.

**Tech Stack:** Bun, TypeScript, Next.js, Vitest, Python/pytest, Docker Compose, Markdown, Git.

## Global Constraints

- Replace `Klipmatic` with `Klipmatic` and `klipmatic` with `klipmatic`.
- Rename scoped packages from `@klipmatic/*` to `@klipmatic/*`.
- Do not retain legacy package, MIME, cache, bucket, database, or domain aliases.
- Exclude `.git`, dependency folders, build output, and generated caches from the sweep.
- Preserve pre-existing modified and untracked files outside the rebrand scope.

---

### Task 1: Inventory and establish the replacement set

**Files:** Read-only repository files and matches from `rg`.

**Interfaces:** Produces the exact replacement categories used by Tasks 2–4: product copy, package scope, infrastructure identifiers, browser identifiers, domains, and documentation filenames.

- [ ] **Step 1: Capture all relevant text matches**

```powershell
rg -n -i --hidden -g '!node_modules' -g '!dist' -g '!build' -g '!.next' -g '!.turbo' -g '!*.lock' 'klipmatic|legacy-brand' .
```

- [ ] **Step 2: Capture affected filenames**

```powershell
rg --files | rg -i 'klipmatic'
```

- [ ] **Step 3: Confirm generated output is excluded**

Exclude `.git`, `node_modules`, `.next`, `.turbo`, and lockfile internals from edits.

### Task 2: Rename runtime, package, infrastructure, and protocol identifiers

**Files:** Root/workspace package manifests, TypeScript imports/config, `docker-compose.dev.yml`, `.env.example`, CI, web runtime files, downloader metadata, and tests.

**Interfaces:** Produces `@klipmatic/*` packages, `application/x-klipmatic-asset`, `application/x-klipmatic-transition`, and `klipmatic` database/bucket/volume/cache/domain defaults.

- [ ] **Step 1: Replace exact content identifiers**

```text
@klipmatic/ -> @klipmatic/
Klipmatic   -> Klipmatic
klipmatic   -> klipmatic
Klipmatic   -> Klipmatic
```

- [ ] **Step 2: Update browser identifiers**

Use `application/x-klipmatic-asset`, `application/x-klipmatic-transition`, `klipmatic-segments-v1`, and `/__klipmatic_cache__/segments/` everywhere.

- [ ] **Step 3: Update domain references**

Change `app.klipmatic.id` to `app.klipmatic.id`.

- [ ] **Step 4: Re-scan source/config**

```powershell
rg -n -i --hidden -g '!node_modules' -g '!dist' -g '!build' -g '!.next' -g '!.turbo' -g '!*.lock' 'klipmatic|legacy-brand' apps packages .env.example docker-compose.dev.yml .github README.md
```

Expected: no matches.

### Task 3: Rename documentation files and content

**Files:** Rename every `docs/**` filename containing `klipmatic`; modify all Markdown, README, and attribution references.

**Interfaces:** Produces documentation paths, links, headings, snippets, and examples using Klipmatic.

- [ ] **Step 1: Rename affected documentation files**

Rename only filename segments containing `klipmatic`, preserving directories and dates.

- [ ] **Step 2: Replace documentation content**

Apply the exact replacements from Task 2 to headings, prose, code snippets, imports, env examples, and test expectations.

- [ ] **Step 3: Verify old documentation references are gone**

```powershell
rg -n -i --hidden -g '!node_modules' -g '!dist' -g '!build' -g '!.next' -g '!.turbo' -g '!*.lock' 'klipmatic|legacy-brand' docs README.md apps/web/public
```

Expected: no matches.

### Task 4: Validate the migration

**Files:** Read-only repository files; modify only missed rebrand references discovered by validation.

**Interfaces:** Confirms the new package scope, brand strings, identifiers, and infrastructure defaults are consistent.

- [ ] **Step 1: Verify no old-name references remain**

```powershell
rg -n -i --hidden -g '!.git' -g '!node_modules' -g '!dist' -g '!build' -g '!.next' -g '!.turbo' -g '!*.lock' 'klipmatic|legacy-brand' .
```

Expected: no matches.

- [ ] **Step 2: Run TypeScript checks and tests**

```powershell
bun run typecheck
bun run test
```

Expected: both commands pass.

- [ ] **Step 3: Run downloader tests when dependencies are available**

```powershell
python -m pytest apps/downloader/tests
```

Expected: tests pass, or report the exact missing-environment error without changing unrelated setup.

- [ ] **Step 4: Inspect final diff/status**

```powershell
git diff --stat
git status --short
```

Confirm requested rebrand files are included and pre-existing user changes remain present.

## Self-review

- Spec coverage: runtime, packages, infrastructure, protocols, domain, tests, docs, filenames, compatibility, and preservation constraints are covered.
- Placeholder scan: no TBD/TODO steps are used.
- Type consistency: package scope and protocol values are explicit and consistent.
