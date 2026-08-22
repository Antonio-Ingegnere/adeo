# Adeo responsive behavior

## Current baseline

Adeo is currently a desktop Electron application, not a responsive web or mobile app.
`../../styles.css` defines:

- Default: 288px sidebar and flexible main column.
- At 860px: 240px sidebar, reduced outer/header spacing, and a narrower Settings rail.
- At 760px: 128px sidebar and further reduced spacing.
- No single-column/mobile navigation below 760px.
- Settings remains a fixed-height modal; edit retains a 224px right metadata column.
- Many controls and drag handles are optimized for mouse/desktop density.

The existing breakpoints compress the two-column desktop layout. They do not constitute
mobile support.

## Required review viewports

| Viewport | Purpose | Expected direction |
|---|---|---|
| 1440px | Wide desktop | Full sidebar, comfortable main column, no stretched controls |
| 1024px | Compact desktop/tablet landscape | Preserve two-column orientation and all actions |
| 768px | Tablet portrait/small desktop | Validate compressed navigation and dialog fit |
| 390px | Phone reference | Used for concepts until responsive production work is approved |

Use 800×600 and 1280×800 for the Phase 0 Electron visual baseline because those match
the current application. Use the four viewports above in Storybook concepts.

## Responsive design rules

- Preserve the user’s active list, search/query, and task when navigation changes form.
- At 768px and below, do not solve space pressure only by truncating labels or shrinking
  text below the existing 11px floor.
- At phone width, sidebar content needs an explicit open/close navigation model; a 128px
  permanent rail is not acceptable.
- Critical actions must not require hover or drag. Provide visible menus, move controls,
  or another operable alternative.
- Dialogs become viewport-aware sheets/panels only after a concept is approved; do not
  silently alter desktop dialog geometry.
- Keep the add-task action available without scrolling past the task list.
- Avoid horizontal page scrolling. Local horizontal scrolling requires a documented need.
- Primary touch controls should target at least 44×44 CSS pixels, with spacing that avoids
  accidental activation.
- The on-screen keyboard must not hide Quick Add or the active editor action.

## Platform continuity

The following semantics remain shared even if presentation changes:

- Task, List, Smart list, Tag, priority, due/reminder, and repeat terminology.
- Search has Text and Query modes.
- Smart lists remain named query strings.
- Completing, editing, and deleting a task produce the same data outcomes.
- Theme and date/time preferences retain their meaning.

Desktop-only capabilities such as the native menu, global/background reminders, and deep
links must be represented as platform capabilities rather than disabled-looking controls
on unsupported platforms.

## Current risks to carry into briefs

| Risk | Source | Required future outcome |
|---|---|---|
| Sidebar reorder is HTML drag-and-drop only | `../../src/renderer/pillDnD.ts` | Keyboard and touch alternative |
| Task drag handle is hover-revealed | `../../styles.css`, `../../src/renderer/tasks.ts` | Discoverable non-hover path; keyboard shortcuts remain supported |
| Two-column edit geometry is rigid | `../../styles.css` | Approved narrow editor concept before production change |
| Settings uses fixed 720×560 geometry | `../../styles.css` | Verify viewport fit and define narrow navigation |
| Date picker is a 220px floating popover | `../../src/renderer/datepicker.ts` | Collision/viewport tests and touch review |
| Renderer calls Electron bridge directly | `../../src/renderer/*.ts` | AppServices adapters before standalone web/mobile |

## Responsive acceptance checklist

- [ ] 1440, 1024, 768, and 390px evidence exists.
- [ ] No horizontal page overflow.
- [ ] Active context survives navigation changes.
- [ ] Keyboard, pointer, and touch paths are named.
- [ ] Long task/list/tag names are exercised.
- [ ] Empty, error, menu/popover, and editor-open states are exercised.
- [ ] Light and dark themes are reviewed.
- [ ] Platform-only features have explicit capability behavior.
