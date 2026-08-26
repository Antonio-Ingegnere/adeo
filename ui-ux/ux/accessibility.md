# Adeo accessibility standard

Accessibility acceptance includes semantics, keyboard behavior, focus, contrast, motion,
zoom/resizing, and understandable content. Automated axe results are evidence, not the
whole decision.

## Existing foundations to preserve

- One visible `:focus-visible` ring across the app.
- Roving focus for task rows and the vertical Settings tablist.
- A modal focus trap that filters for elements that are actually tabbable.
- Named icon buttons and decorative SVGs hidden from assistive technology.
- Search and Quick Add inputs exposed as comboboxes with synchronized ARIA state.
- A polite live region for search status and alert regions for Settings errors.
- Native radio/checkbox/select controls where their semantics fit.
- Reduced-motion media handling for menus, overlays, and modals.
- Selected segmented controls with a 3:1-capable boundary token, not color alone.

## Required interaction behavior

### Keyboard

- All critical flows work with Tab/Shift+Tab plus documented scoped shortcuts.
- Escape dismisses only the topmost transient surface and never loses the underlying task
  editor state.
- Arrow-key behavior follows the control: task cursor, tablist, radio group, listbox, or
  calendar. Do not add global arrow handlers that interfere with text fields.
- Focus after rerender, completion, filtering, and deletion remains predictable.
- Reordering has a keyboard path with an announced result.

### Dialogs and transient surfaces

- Each dialog has an accessible name through `aria-labelledby` or `aria-label`.
- Initial focus lands on the first meaningful control, not automatically on a destructive
  action.
- Focus stays inside an open modal and returns to the invoking control when it closes.
- Popovers and listboxes expose expanded state on their trigger/input and close without
  leaving stale `aria-activedescendant` values.

### Visual and content

- Text and meaningful state indicators meet WCAG AA contrast for their size and role.
- Focus, selected, error, priority, and completion are not communicated by hue alone.
- At 200% zoom, essential content and actions remain operable without two-dimensional
  page scrolling.
- Touch-target review uses a 44×44 CSS pixel target for primary actions.
- Errors identify the failed action and a recovery path.

## Known baseline gaps

These are findings to schedule, not permission to change production code outside an
approved plan.

| Gap | Evidence | Severity | Target |
|---|---|---|---|
| Sidebar list/smart-list/tag order depends on pointer drag-and-drop | `../../src/renderer/pillDnD.ts` sets `draggable` and handles drag events; no keyboard reorder API | High | Responsive work / first touched reorder feature |
| Several overlays have `role="dialog"` and `aria-modal` but no explicit accessible-name relationship | `../../index.html`: edit, list, smart-list, tag, and repeat overlays | High | First approved dialog accessibility task after rollback |
| Date-picker day and footer targets remain below the documented 44px primary touch target | `../../styles.css`: `.date-picker-day` and `.date-picker-footer-btn` | Medium | P5.4 responsive implementation |
| Task drag handle is a hover-revealed draggable span | `../../src/renderer/tasks.ts` and `../../styles.css` | Medium | P4 keyboard/visual coverage; responsive redesign |
| Markdown task-list checkboxes have no programmatic accessible name | `../../src/renderer/helpers.ts` appends a checkbox and sibling text without a `<label>` or ARIA name; reproduced by axe during P2.1/P2.2 Markdown-fixture review | High | First approved task-details accessibility change |
| Markdown heading levels are rendered literally without normalization to the surrounding app outline | `../../src/renderer/helpers.ts` maps `#`–`######` directly to `h1`–`h6`; a details fixture beginning at `###` reproduced an axe heading-order violation | Medium | First approved task-details accessibility change |
| Focus restoration is flow-specific and not centralized for every overlay | Modal open/close functions in `modals.ts`, `index.ts`, and `shortcutsHelp.ts` | Medium | Review per dialog after rollback |
| Story axe scans are local-only; renderer/Electron keyboard suites and accessibility CI do not exist | `.storybook/main.ts` loads the axe-based addon, but `package.json` has no renderer/Electron UI test command | High | P4.1, P4.4, and P4.6 |
| Narrow/mobile layout has no complete navigation model | Only 860px and 760px compression rules in `styles.css` | High for web/mobile | P5.4 after approved concept |

## Initial Storybook axe baseline and resolution

P1.5 ran every then-existing Phase 1 story in light and dark. Story-owned contrast and
semantics issues were fixed immediately, while three inherited production-token pairings
were kept visible under `a11y.test: 'error'` until the Phase 1 exit. The exit review changed
only the failing semantic tokens and reran all six Phase 1 stories in both themes. No axe
rule, story, element, or theme was excluded.

| Finding | Initial fingerprint and result | Phase 1 exit result | Status |
|---|---|---|---|
| AXE-P1.5-01 | `#story-suggestion-active > .query-suggest-hint`; `--text-hint` on `--surface-hover-alt` was 4.47:1 in light | `#6d6d6d` on `#f0f0f0` is 4.54:1 | RESOLVED — 2026-08-24 |
| AXE-P1.5-02 | `.design-smoke__status--success`; `--success` on `--surface` was 4.23:1 in light | `#388338` on `#ffffff` is 4.70:1 | RESOLVED — 2026-08-24 |
| AXE-P1.5-03 | `.design-smoke__bar--8`, `--16`, `--24`, and `--32`; `--text-on-accent` on `--accent` was 4.41:1 light and 3.32:1 dark | `#000000` on `#1d72f3` is 4.75:1 light; `#111111` on `#3d8bfd` is 5.67:1 dark | RESOLVED — 2026-08-24 |

The final 12-case Chrome matrix reports zero violations. The shortcut-keycap and
date-picker stories each retain one documented axe inconclusive result that manual review
has already verified as a passing token pair and a valid `aria-controls` relationship,
respectively. See `reviews/phase-1-exit-review.md`.

## Review method

For each critical flow:

1. Complete it with keyboard only and record focus transitions.
2. Inspect accessible names, roles, states, and live announcements.
3. Run axe on every revealed state, including errors and nested surfaces.
4. Review light/dark, reduced motion, 200% zoom, and required viewports.
5. Test pointer and, when applicable, touch behavior.
6. Record assistive-technology/manual limitations honestly.

New axe violations fail. Existing violations need a specific fingerprint, owner, and due
task; broad exclusions and global rule disabling require explicit user approval.

## Story accessibility policy

- Storybook loads `@storybook/addon-a11y` for every story and runs axe automatically
  when the story is visited.
- The project-level `a11y.test: 'error'` policy applies to every current and new story.
  Story files must not weaken it to `todo` or `off` without a recorded finding, owner,
  due phase, and explicit user approval.
- A passing automated scan is necessary but does not replace keyboard, focus, zoom,
  contrast, motion, or assistive-technology review.
- An inherited violation remains visible. Record its axe rule, affected story and state,
  selector or stable fingerprint, severity, owner, and due phase; do not silence the rule
  globally or exclude the affected markup from the scan.
