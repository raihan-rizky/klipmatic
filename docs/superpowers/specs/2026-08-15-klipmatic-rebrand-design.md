# Klipmatic Full Rebrand Design

## Goal

Rename the product from Klipmatic to Klipmatic across the repository, including
runtime branding, workspace package identifiers, infrastructure defaults, internal
browser protocols, documentation, tests, and documentation filenames.

## Scope

- Replace product-facing `Klipmatic` with `Klipmatic`.
- Replace lowercase identifiers `klipmatic` with `klipmatic`.
- Rename scoped packages from `@klipmatic/*` to `@klipmatic/*` and update all imports,
  workspace dependencies, and configuration references.
- Rename browser drag-and-drop MIME identifiers and cache identifiers to the Klipmatic
  namespace.
- Update Docker Compose, environment examples, CI database settings, bucket names, and
  downloader package metadata.
- Update tests and fixtures to assert the new names.
- Rename documentation specs and plans whose filenames contain `klipmatic` and update
  links/references inside documentation.
- Preserve existing unrelated working-tree changes and avoid generated directories such
  as `.git`, `node_modules`, `.next`, and `.turbo`.

## Compatibility decision

This is a hard rename. Legacy package names, MIME types, cache names, database defaults,
bucket defaults, and old domains will not be retained as aliases. Existing local caches
and development data using the old names may need to be recreated.

## Implementation approach

1. Inventory all tracked and relevant ungenerated references, including case variants and
   filenames.
2. Apply content replacements using the exact casing rules above.
3. Rename affected documentation files and update references to those paths.
4. Verify no relevant old-name references remain outside Git history or intentionally
   preserved generated artifacts.
5. Run repository validation: formatting/type checks/build/tests available from the
   workspace, with focused web and package tests where applicable.

## Acceptance criteria

- Product/runtime surfaces display Klipmatic.
- Workspace package resolution uses `@klipmatic/*` consistently.
- Infrastructure defaults and CI use `klipmatic` names.
- Browser drag-and-drop and cache identifiers use the Klipmatic namespace.
- Documentation content and relevant filenames use Klipmatic.
- All applicable tests pass after their expectations are updated.
- No unintended files outside the requested rebrand scope are modified.

## Constraints

The current working tree contains pre-existing modifications and untracked files. The
rebrand must preserve those changes and must not reset or discard them.
