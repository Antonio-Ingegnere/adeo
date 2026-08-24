# Phase 1 exit review: design-system surface and Storybook

**Status:** DONE — 2026-08-24
**Reviewer:** Codex implementation verification
**Review date:** 2026-08-24
**Classification:** Approved roadmap maintenance; no product-direction change
**Production base:** `4721d97` plus the reviewed Phase 1 exit worktree diff
**Build under review:** `npm run build` and `npm run storybook:build`

## Outcome

Phase 1 is complete. AXE-P1.5-01 through AXE-P1.5-03 are resolved by correcting the
semantic production tokens that formed the failing foreground/background pairs. Chrome
reran every Phase 1 story in light and dark: all 12 cases rendered the requested theme and
reported zero axe violations. No rule, element, story, or theme was disabled or excluded.

The expected visual changes are limited to a one-step darker light hint, a darker light
success green, and dark text on blue accent fills. The accent fills themselves are
unchanged. The light and dark foundation canvases were visually reviewed at the 1440px
Storybook viewport and saved as review evidence.

## Phase-exit criteria

| Criterion | Evidence | Result |
|---|---|---|
| Storybook builds in a clean checkout | `npm run storybook:build` completed from tracked configuration and sources and indexed all six Phase 1 stories; no generated output is required as source | PASS |
| At least five production UI elements have meaningful state coverage | Stories cover tag chip/dot, shortcut keycap, combobox suggestion item, date picker, and sidebar pill presentation, including normal, selected/active, disabled where applicable, long, boundary, focus, and closed/open states | PASS |
| Product Design Agent can inspect tokens and component states without Electron | Chrome loaded the foundation story and all five production-component stories from standalone Storybook with deterministic fixtures; Electron was not running for this inspection | PASS |
| Phase 1 accessibility debt is cleared | The final light/dark matrix contains zero axe violations and keeps project-wide `a11y.test: 'error'` unchanged | PASS |

## Resolved findings

| Finding | Token correction | Rendered contrast | Result |
|---|---|---:|---|
| AXE-P1.5-01 | Light `--text-hint`: `#6e6e6e` → `#6d6d6d` | 4.54:1 on `--surface-hover-alt` (`#f0f0f0`) | PASS |
| AXE-P1.5-02 | Light `--success`: `#3d8b3d` → `#388338` | 4.70:1 on `--surface` (`#ffffff`) | PASS |
| AXE-P1.5-03 | Light `--text-on-accent`: `#ffffff` → `#000000`; dark: `#ffffff` → `#111111` | 4.75:1 light; 5.67:1 dark | PASS |

## Chrome axe matrix

| Story | Light | Dark |
|---|---:|---:|
| Design-system smoke | 0 violations / 16 passes / 0 inconclusive | 0 / 16 / 0 |
| Combobox suggestion item | 0 / 25 / 0 | 0 / 25 / 0 |
| Shortcut keycap | 0 / 9 / 1 | 0 / 9 / 1 |
| Tag chip and dot | 0 / 12 / 0 | 0 / 12 / 0 |
| Date picker | 0 / 27 / 1 | 0 / 27 / 1 |
| Sidebar pill | 0 / 21 / 0 | 0 / 21 / 0 |

Every case rendered its requested light/dark marker. The shortcut inconclusive item is the
symbol-only `⌘` keycap, whose text/surface pair was manually verified at 14.85:1 light and
14.48:1 dark. The date-picker inconclusive item is axe declining to decide the
`aria-controls` relationship; P1.6 manually verified that every reference resolves to one
popover ID.

## Visual evidence

- [Light foundation, desktop 1440](evidence/phase-1-exit-light-desktop-1440.jpg)
- [Dark foundation, desktop 1440](evidence/phase-1-exit-dark-desktop-1440.jpg)

Both captures show the unchanged blue accent fills with the corrected dark foreground,
and no clipped foundation content at the 1440px Storybook viewport. No baseline image was
regenerated or accepted to conceal a regression.

## Verification

```text
npm run build
  PASS

npm run storybook:build
  PASS; all six Phase 1 story IDs indexed

node scripts/query-selftest.mjs
  PASS; all 103 query cases

node scripts/shortcuts-selftest.mjs
  PASS; all 132 shortcut cases

npm run test:isolation
  PASS; 34 checks and protected user data unchanged

Chrome rendered accessibility verification
  PASS; 12 of 12 story/theme cases
  PASS; zero axe violations

git diff --check
  PASS
```

## Gaps and next gate

- The known dialog naming, pointer-only reorder, touch-target, and broader renderer/CI axe
  gaps retain their existing later-phase owners; none blocks the narrowly defined Phase 1
  exit criteria.
- Phase 2 must begin with P2.1. Do not begin the Quick Add concept pilot until the Concepts
  hierarchy, deterministic fixture boundary, and production-import guard are in place.
- No real user/development database was accessed. Unrelated `.claude` worktree changes were
  not modified.
