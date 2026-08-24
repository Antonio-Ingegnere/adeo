# P1.4 implementation review: first reusable UI elements

**Status:** DONE — 2026-08-24
**Reviewer:** Codex implementation verification
**Review date:** 2026-08-24
**Classification:** Approved roadmap extraction; no product-direction change
**Production base:** `3f3ff95` plus the reviewed P1.4 worktree diff
**Build under review:** `npm run build` and `npm run storybook:build`

## Outcome

P1.4 is complete. Tag chips/dots, shortcut keycaps, and combobox suggestion items now share
production DOM factories in `src/renderer/uiElements.ts`. The factories have no imports and
receive all data, state flags, and callbacks explicitly. Production task/tag, shortcut-help,
shortcut-settings, tag-suggestion, and query-suggestion renderers consume the shared boundary.

Three production-component stories cover the required states and render correctly in light and
dark themes at desktop 1440 and mobile 390. The browser matrix completed 12 cases with zero
assertion failures or horizontal overflow.

## Requirement-to-evidence traceability

| Requirement / acceptance criterion | Evidence | Result |
|---|---|---|
| Explicit tag chip/dot factory | `createTagChip`, `createTagDot`, and `styleTagChip` accept label, color, visibility, disabled state, variant, and callback inputs | PASS |
| Explicit shortcut keycap factory | `createShortcutKeycaps` accepts formatted display tokens and preserves one semantic `<kbd>` per key | PASS |
| Explicit suggestion-item factory | `createComboboxSuggestionItem` accepts id, label, metadata, color, variant, active/disabled state, and selection callback | PASS |
| No Electron/global renderer dependency | `src/renderer/uiElements.ts` has no imports, `window.electronAPI`, global `refs`, or mutable global `state` access; structural check returned no matches | PASS |
| Production consumes the factories | Task/pending tag chips, query/tag suggestions, shortcut help, and shortcut settings import the shared factories | PASS |
| Normal and color-off tag states | `components-tag-chip-and-dot--states` renders interactive normal, `tag-plain`, omitted-dot, disabled, long-text, and palette-dot states | PASS |
| Active and disabled suggestion states | `components-combobox-suggestion-item--states` exposes one selected option and one native/ARIA-disabled option | PASS |
| Long text | Tag, keycap, and suggestion stories include long labels; Chrome reported no horizontal document overflow at 390px | PASS |
| Explicit callbacks | Chrome activated the normal tag chip and suggestion option and observed the expected local status updates | PASS |
| Light and dark | Each of the three stories passed in both toolbar themes at desktop 1440 and mobile 390 | PASS |
| P1.2 spacing policy | All new story-owned margin, padding, and gap declarations use `--space-*`; production component spacing remains the reviewed legacy presentation | PASS |
| Preserve production behavior | Production/Storybook builds, 103 query cases, 132 shortcut cases, and 34 isolation checks pass | PASS |

## Browser matrix

| Story | Light / 1440 | Dark / 1440 | Light / 390 | Dark / 390 |
|---|---:|---:|---:|---:|
| Tag chip and dot | PASS | PASS | PASS | PASS |
| Shortcut keycap | PASS | PASS | PASS | PASS |
| Combobox suggestion item | PASS | PASS | PASS | PASS |

Browser assertions covered stable story/component markers, active theme markers, viewport width,
required state counts, disabled semantics, long text, callback output, computed active/disabled
styles, dot visibility, individual keycap tokens, and horizontal overflow. Chrome reported only
Storybook's existing manager warning that `PopoverProvider.ariaLabel` becomes mandatory in
Storybook 11; no Adeo story error was logged.

## Visual evidence

- [Tag chip/dot — dark, Desktop 1440](evidence/p1-4-tag-dark-desktop-1440.png)
- [Shortcut keycap — light, Mobile 390](evidence/p1-4-keycap-light-mobile-390.png)
- [Suggestion item — light, Mobile 390](evidence/p1-4-suggestion-light-mobile-390.png)

The production extraction retains the existing element types, classes, text, inline tag colors,
and mouse-event timing. The only new production CSS states are disabled treatments, which no
current production caller enables. No production visual change is expected for existing states.

## Verification

```text
npm run build
  PASS

npm run storybook:build
  PASS; all three P1.4 story IDs indexed

node scripts/query-selftest.mjs
  All 103 query cases passed

node scripts/shortcuts-selftest.mjs
  All 132 shortcut cases passed

npm run test:isolation
  Isolation self-test passed (34 checks)

Chrome rendered-state verification
  PASS; 12 of 12 component/theme/viewport cases
  PASS; tag and suggestion callbacks
  PASS; no story errors or horizontal overflow

git diff --check
  PASS
```

## Gaps and follow-up

- Axe enforcement is intentionally owned by P1.5; it is not silently disabled here.
- P1.6 will add the date picker and first sidebar-pill stories using the same explicit-input
  boundary.
- No baseline was regenerated, no real user/development database was accessed, and unrelated
  `.claude` worktree changes were not modified.
