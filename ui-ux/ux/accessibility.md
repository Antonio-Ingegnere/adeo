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
| Date picker exposes a grid of buttons without calendar/grid semantics or explicit previous/next labels | `../../src/renderer/datepicker.ts` | Medium | P1.6 story and accessibility review |
| Task drag handle is a hover-revealed draggable span | `../../src/renderer/tasks.ts` and `../../styles.css` | Medium | P4 keyboard/visual coverage; responsive redesign |
| Focus restoration is flow-specific and not centralized for every overlay | Modal open/close functions in `modals.ts`, `index.ts`, and `shortcutsHelp.ts` | Medium | Review per dialog after rollback |
| Automated axe and browser/Electron keyboard suites do not exist | `package.json` contains no UI test scripts | High | Phase 4 |
| Narrow/mobile layout has no complete navigation model | Only 860px and 760px compression rules in `styles.css` | High for web/mobile | P5.4 after approved concept |

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
