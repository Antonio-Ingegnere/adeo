# Adeo component and behavior inventory

**Audit date:** 2026-08-20
**Production commit:** `99dab6e602edefd3975e1cbe7defb72a24786c64`

Classifications:

- **Reusable:** sufficiently isolated to consume from another production UI module/story.
- **Extraction candidate:** useful behavior exists but needs dependency injection or a
  small factory boundary before production Storybook use.
- **Production-only:** tightly coupled to current application state, Electron, or static
  markup; document/story around it without importing it as a component yet.

## Inventory

| Element or behavior | Source | Class | Evidence and next step |
|---|---|---|---|
| Design tokens and theme | `../../styles.css` | Extraction candidate | Complete color/type/radius/elevation tokens and dark override exist in one file; move values unchanged to importable design CSS in P1.1. Spacing is not tokenized. |
| Global focus ring and visually-hidden utility | `../../styles.css` | Reusable | Shared `:focus-visible` and clipping utility; include in Storybook design CSS. |
| Tag palette, chip paint, and dot | `../../src/renderer/tagColor.ts`; `../../server/app.py` | Reusable | `paintTagChip`/`makeTagDot` centralize color-on/off behavior. Palette must remain mirrored with server validation. |
| Priority visual mapping | `../../src/renderer/theme.ts`; `../../styles.css` | Reusable | `setPriorityAttr` maps none/low/medium/high to CSS token palettes without Electron access. |
| Shortcut key grammar and formatting | `../../src/renderer/shortcutKeys.ts` | Reusable | Pure, DOM-free binding normalization and platform formatting; already covered by Node self-test. |
| Shortcut keycap presentation | `../../src/renderer/shortcutsHelp.ts`; `../../src/renderer/shortcutsSettings.ts`; `../../styles.css` | Extraction candidate | Presentation is duplicated inside feature renderers; extract a DOM factory accepting formatted keys and state. |
| Query/tag suggestion row | `../../src/renderer/querySearch.ts`; `../../src/renderer/tagInput.ts`; `../../styles.css` | Extraction candidate | Similar listbox row/active styling; extract explicit label, metadata, active/disabled state, and selection callback. |
| Combobox ARIA synchronization | `../../src/renderer/helpers.ts` | Reusable | `syncComboboxAria` owns expanded and active-descendant synchronization. |
| Sidebar list/smart-list/tag pill | `../../src/renderer/lists.ts`; `../../src/renderer/smartLists.ts`; `../../src/renderer/tags.ts`; `../../src/renderer/helpers.ts` | Extraction candidate | Shared visual/activation pattern, but construction and state are split across three feature modules. Preserve `aria-pressed`. |
| Sidebar pill reorder | `../../src/renderer/pillDnD.ts` | Extraction candidate | Generic across three pill kinds, but pointer drag-only. Add keyboard/touch alternative before responsive approval. |
| Task row | `../../src/renderer/tasks.ts` | Production-only | Valuable states, but factory reads global state, calls Electron API, dispatches document events, and owns DnD/focus. Story through an adapter or extracted presentation. |
| Task-list roving cursor | `../../src/renderer/tasks.ts`; `../../src/renderer/state.ts` | Extraction candidate | Strong keyboard pattern keyed by task ID; needs a collection controller boundary before reuse. |
| Date picker | `../../src/renderer/datepicker.ts`; `../../src/renderer/helpers.ts` | Extraction candidate | Mostly DOM/local state and shared date format, but attaches globally and lacks complete calendar semantics. Story closed/open/boundaries before refactor. |
| Segmented option | `../../index.html`; `../../styles.css` | Extraction candidate | Search mode and Settings share CSS/semantic pattern; create a factory without changing native radio behavior. |
| Settings vertical tabs | `../../src/renderer/settingsTabs.ts`; `../../index.html`; `../../styles.css` | Reusable with fixture DOM | Focus logic is scoped and Electron-free, but expects fixed element IDs/static panels. Story with representative static markup. |
| Dialog shell and focus trap | `../../index.html`; `../../styles.css`; `../../src/renderer/focusTrap.ts`; `../../src/renderer/modals.ts` | Production-only | Geometry/chrome is under an approved rollback and ownership is spread across flows. Do not extract/redesign until that gate closes. Several dialogs need explicit accessible names. |
| View picker and contextual view bar | `../../src/renderer/viewBar.ts`; `../../src/renderer/currentView.ts`; `../../src/renderer/activeSmartList.ts` | Production-only | Core orientation behavior but reads global state and emits document events. Use a fixture adapter for concepts. |
| Search parser and predicate | `../../src/renderer/query.ts`; `../../src/renderer/searchMatches.ts` | Reusable | Pure query grammar/compiler is appropriate for deterministic fixtures; rendering remains separate. |
| Smart-list template derivation | `../../src/renderer/smartListTemplate.ts`; `../../src/renderer/activeSmartList.ts` | Reusable core / production-only UI | Pure derivation is tested; display and API tag resolution remain state/Electron coupled. |
| Task details renderer | `../../src/renderer/helpers.ts` | Extraction candidate | `createDetailsElement` accepts callbacks but mixes markdown-like rendering and editable DOM behavior. Story long text, links, lists, checkbox, and edit. |
| Repeat summary | `../../src/renderer/repeat.ts` | Reusable | Pure display-string derivation; safe for fixtures and stories. |
| Repeat editor | `../../index.html`; `../../src/renderer/index.ts`; `../../src/renderer/modals.ts`; `../../styles.css` | Production-only | Static, large, and coupled to edit state. Preserve nested-modal close behavior. |
| Settings controls | `../../index.html`; `../../src/renderer/index.ts`; `../../src/renderer/shortcutsSettings.ts` | Production-only | Static presentation plus Electron-backed persistence; stories need an explicit settings adapter. |
| Electron service bridge | `../../src/preload.ts`; `../../src/types.ts`; renderer feature modules | Production-only | Renderer calls `window.electronAPI` directly. P5 introduces `AppServices`; do not mock the global ad hoc across components. |

## CSS and layout findings

- Tokens cover color, type, radius, and elevation but not spacing.
- Light/dark values are centralized; two baked visual details require dark-specific rules.
- Desktop layout has only 860px and 760px compression breakpoints.
- Dialog, menu, and picker dimensions include many fixed pixel widths.
- Multiple controls reveal affordances on hover, which is unsuitable as the only touch path.

## Accessibility findings

- Strong existing foundations: global focus visibility, task/settings roving focus, modal
  focus trap, live search status, combobox ARIA synchronization, reduced motion.
- Sidebar ordering is pointer-dependent.
- Several dialogs lack an explicit accessible-name relationship.
- The custom date picker needs calendar semantics and clearer navigation labels.
- A narrow Playwright/Electron isolation self-test now protects real data. There is still no
  axe, broad UI-flow, visual-regression, or screen-reader test layer.

## First extraction order

1. Tag chip/dot and priority marker (already isolated).
2. Shortcut keycap.
3. Suggestion item.
4. Date picker and one sidebar pill only after Storybook is available.
5. Keep task rows, dialogs, view bar, and Settings production-only until service/state
   boundaries are explicitly planned.
