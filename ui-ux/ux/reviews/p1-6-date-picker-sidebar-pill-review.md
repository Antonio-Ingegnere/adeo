# P1.6 implementation review: date picker and sidebar pill

**Status:** DONE — 2026-08-24
**Reviewer:** Codex implementation verification
**Review date:** 2026-08-24
**Classification:** Approved roadmap extraction; no product-direction change
**Production base:** `ab3bfe3` plus the reviewed P1.6 worktree diff
**Build under review:** `npm run build` and `npm run storybook:build`

## Outcome

P1.6 is complete. The production date picker now exposes a controller with explicit
formatting, deterministic-today, accessible-name, and popover-parent inputs. Its dialog and
calendar grid are named, each week has valid row/gridcell structure, one day owns the tab
stop, arrow/Home/End/Page keys move focus, and Escape restores the trigger. None of that
interaction imports or calls an Electron service.

The list renderer now consumes the dependency-free `createSidebarPill` factory for label,
count, selected state, accessible truncation, and Enter/Space activation. Existing drag,
drop, menu, persistence, dialog, and reorder code remains feature-owned and unchanged.

The two production-component stories passed eight Chrome theme/viewport cases with no axe
violations and no horizontal overflow. P1.6-owned inherited contrast issues found during the
first scan were corrected without disabling any accessibility rule.

## Requirement-to-evidence traceability

| Requirement / acceptance criterion | Evidence | Result |
|---|---|---|
| Date picker closed/open | `components-date-picker--states` renders one closed empty trigger and one deterministically open December 2025 picker | PASS |
| Boundary dates | Story renders 2000-01-01, 2099-12-31, and an open 2025-12-31 year boundary | PASS |
| Calendar keyboard focus | Chrome focused December 31, Arrow Right moved focus and the view to January 1, and Enter selected 2026-01-01 | PASS |
| Escape and focus restoration | Chrome pressed Escape on the focused day; the dialog closed, `aria-expanded` became false, and one date trigger retained focus | PASS |
| Accessible calendar structure | Named dialog, live month label, grid, weekday/data rows, column headers, gridcells, selected/current state, and named Previous/Next buttons are exposed | PASS |
| Sidebar selected/unselected | `components-sidebar-pill--states` exposes correct `aria-pressed` values for Personal and Planning | PASS |
| Sidebar long label | Visible text truncates while the full label plus count remains the accessible name and title | PASS |
| Sidebar keyboard activation | Chrome activated Planning with Enter and Personal with Space and observed both callback outputs | PASS |
| Preserve reorder behavior | `src/renderer/pillDnD.ts` has no P1.6 diff; the production list renderer attaches the same DnD controller after factory creation | PASS |
| Preserve dialog architecture | `index.html`, `modals.ts`, and `focusTrap.ts` have no P1.6 diff | PASS |
| Isolate from Electron services | `datepicker.ts` and `uiElements.ts` contain no `window.electronAPI`; stories pass all runtime data explicitly | PASS |
| New story accessibility policy | Both new stories inherit project-wide `a11y.test: 'error'`; no rule, element, story, or theme is excluded | PASS |

## Chrome matrix

| Story | Theme | Desktop 1440 | Mobile 390 | Axe |
|---|---|---:|---:|---:|
| Date picker | Light | PASS | PASS | 0 violations / 27 passes / 1 inconclusive |
| Date picker | Dark | PASS | PASS | 0 violations / 27 passes / 1 inconclusive |
| Sidebar pill | Light | PASS | PASS | 0 violations / 21 passes / 0 inconclusive |
| Sidebar pill | Dark | PASS | PASS | 0 violations / 21 passes / 0 inconclusive |

All eight cases reported the expected story/theme markers and zero horizontal document
overflow. The date-picker inconclusive result is axe declining to decide whether each
`aria-controls` reference exists while `aria-haspopup="dialog"` is present. Manual DOM
verification confirmed all four trigger references resolve to exactly one popover ID.

## Accessibility corrections made in P1.6

- Weekday headers now sit within their required grid parent.
- Previous and next month controls have explicit names.
- The open surface has a stable dialog name; the grid is labelled by the live month.
- Only one date is tabbable; calendar navigation supports Arrow keys, Home/End, and
  Page Up/Down.
- Selection and Escape restore trigger focus and synchronize visible/accessible values.
- Selected-date text uses `--text-on-bright-accent`; date actions use the theme-specific
  `--accent-text` token.
- Selected sidebar counts use a contrast-safe text token.

## Verification

```text
npm run build
  PASS

npm run storybook:build
  PASS; both P1.6 story IDs indexed

node scripts/query-selftest.mjs
  PASS; all 103 query cases

node scripts/shortcuts-selftest.mjs
  PASS; all 132 shortcut cases

npm run test:isolation
  PASS; 34 checks and protected user data unchanged

Chrome rendered-state verification
  PASS; 8 of 8 story/theme/desktop-mobile cases
  PASS; year-boundary navigation, selection, Escape, and focus restoration
  PASS; Enter/Space pill activation and full accessible long label
  PASS; no axe violations or horizontal overflow

git diff --check
  PASS
```

## Gaps and follow-up

- Date-picker day/footer targets remain compact and are explicitly due for the P5.4 touch
  implementation; P1.6 does not claim a mobile touch redesign.
- Pointer-only sidebar reorder remains visible in the accessibility inventory and is due
  before responsive approval. P1.6 did not alter it.
- Phase 1 exit is not yet complete: AXE-P1.5-01 through AXE-P1.5-03 remain due at the exit
  review even though both P1.6 stories are clean.
- No baseline was regenerated, no real user/development database was accessed, and
  unrelated `.claude` worktree changes were not modified.
