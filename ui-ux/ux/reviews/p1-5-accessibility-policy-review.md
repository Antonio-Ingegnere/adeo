# P1.5 implementation review: Storybook accessibility policy

**Status:** DONE — 2026-08-24
**Reviewer:** Codex implementation verification
**Review date:** 2026-08-24
**Classification:** Approved roadmap implementation; no product-direction change
**Production base:** `3f3ff95` plus the reviewed P1.4/P1.5 worktree diff
**Build under review:** `npm run build` and `npm run storybook:build`

## Outcome

P1.5 is complete. Storybook now loads `@storybook/addon-a11y` 10.5.10, and the
project-level `a11y.test: 'error'` parameter applies to every existing and future story.
Chrome visited all four Phase 1 stories in light and dark, causing the addon to run axe in
all eight cases.

The initial run exposed a low-contrast Storybook eyebrow and an unsupported `aria-label`
on story-only markup; both were corrected. Three inherited production-token pairings
remain visible as failing accessibility results. They are fingerprinted in
`../accessibility.md`, have named owners, and are due before Phase 1 exits. No axe rule,
element, story, or theme was disabled or excluded.

## Requirement-to-evidence traceability

| Requirement / acceptance criterion | Evidence | Result |
|---|---|---|
| Install the official addon | `package.json` pins `@storybook/addon-a11y` 10.5.10, matching Storybook 10.5.10; the static build emits the addon axe bundle | PASS |
| Load axe for Storybook | `.storybook/main.ts` registers `@storybook/addon-a11y` | PASS |
| New stories fail on violations | `.storybook/preview.ts` sets project-wide `a11y.test: 'error'` with no weaker story override | PASS |
| All Phase 1 production-component stories run axe | Chrome ran tag chip/dot, shortcut keycap, and combobox suggestion item in both light and dark | PASS |
| Foundation story also runs axe | Chrome ran design-system smoke in both light and dark | PASS |
| Inherited violations remain visible | AXE-P1.5-01 through AXE-P1.5-03 retain `color-contrast` failures and record theme, selector, ratio, owner, and Phase 1 deadline | PASS |
| No silent suppression | Repository search and configuration review found no `a11y.test: 'off'`, `todo`, rule disabling, context narrowing, or story exclusion | PASS |
| Correct P1.5-owned issues | Story eyebrows use an accessible text token; the unsupported label was removed from the already-headed rhythm sample | PASS |

## Axe matrix after Storybook-only fixes

| Story | Light | Dark |
|---|---:|---:|
| Combobox suggestion item | 1 violation / 25 passes / 0 inconclusive | 0 / 25 / 0 |
| Shortcut keycap | 0 / 9 / 1 | 0 / 9 / 1 |
| Tag chip and dot | 0 / 12 / 0 | 0 / 12 / 0 |
| Design-system smoke | 1 / 16 / 1 | 1 / 16 / 1 |

The shortcut inconclusive item is the symbol-only `<kbd>⌘</kbd>`. Manual token calculation
confirms `--text` on `--surface-sunken` at 14.85:1 in light and 14.48:1 in dark, so it is
not a violation. The smoke story's inconclusive one-character `8` bar uses the same failing
foreground/background pair as the three axe-detected bars and is included in AXE-P1.5-03.

## Inherited findings

| ID | Production pairing | Measured result | Owner / due phase |
|---|---|---:|---|
| AXE-P1.5-01 | Query suggestion hint on the active light row | 4.47:1 | Implementer + Product Design Agent / Phase 1 exit |
| AXE-P1.5-02 | Success status text on the light surface | 4.23:1 | Architect + Implementer / Phase 1 exit |
| AXE-P1.5-03 | On-accent text over accent fill in foundation samples | 4.41:1 light; 3.32:1 dark | Architect + Implementer / Phase 1 exit |

These findings are accepted only as an explicit initial baseline, not as passes. Because
the global policy remains `error`, they continue to show as Storybook failures until fixed.

## Verification

```text
npm run build
  PASS

npm run storybook:build
  PASS; addon axe bundle emitted

node scripts/query-selftest.mjs
  PASS; all 103 query cases

node scripts/shortcuts-selftest.mjs
  PASS; all 132 shortcut cases

npm run test:isolation
  PASS; 34 checks and protected user data unchanged

Chrome Storybook accessibility matrix
  PASS; axe executed in 8 of 8 story/theme cases
  PASS; no P1.5-owned violations remain
  EXPECTED FAIL; 3 inherited production-token fingerprints remain visible

Manual keycap contrast confirmation
  PASS; 14.85:1 light and 14.48:1 dark

git diff --check
  PASS
```

## Gaps and follow-up

- AXE-P1.5-01 through AXE-P1.5-03 must be resolved before the Phase 1 exit review.
- P4.4 will extend axe coverage from isolated stories to the renderer and every revealed
  application state; P4.6 will enforce story accessibility in CI.
- Automated axe cannot replace keyboard, focus, zoom, motion, contrast-context, or
  assistive-technology review.
- No baseline was regenerated, no real user/development database was accessed, and
  unrelated `.claude` worktree changes were not modified.
