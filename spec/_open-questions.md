# Open questions

Last reviewed: 2026-08-29

IDs are stable and must not be renumbered or reused. Resolved questions remain
in this register so human decisions survive later Storybook updates.

## OQ-001

- Component: Quick Add concepts
- Question: Which top-level Quick Add direction, if any, is approved for product
  behavior: Compact/current direction, Command style, or Touch first?
- Available evidence: [FACT] `Concepts/Quick Add pilot` labels all three stories
  non-production and says only the user can approve a direction
  (`ui-ux/ux/concepts/quick-add-pilot.stories.ts:meta`,
  `createQuickAddPilot`).
- Status: OPEN

## OQ-002

- Component: Quick Add concepts
- Question: Which metadata approach, if any, is approved: Inline essentials,
  Smart capture, or Metadata presets?
- Available evidence: [FACT] The Storybook title describes three non-production
  approaches and renders all three with the same fixture states
  (`ui-ux/ux/concepts/quick-task-add-metadata.stories.ts:meta`,
  `createQuickTaskConcept`).
- Status: OPEN

## OQ-003

- Component: Quick Add concepts
- Question: If Inline essentials is selected, which label-free layout is the
  approved UI: Value row, Meta chips, Same-line cluster, or Unified context bar?
- Available evidence: [FACT] The follow-up Storybook file presents four
  alternatives and records benefits/trade-offs for each; it does not mark one
  approved (`ui-ux/ux/concepts/quick-add-inline-metadata-layouts.stories.ts`).
- Status: RESOLVED
- Resolution: [HUMAN DECISION] (user message, 2026-08-29) Proceed with option A,
  Value row. Meta chips, Same-line cluster, and Unified context bar are not
  selected. The Storybook story remains concept code; this decision selects the
  layout direction, not the story's implementation.

## OQ-004

- Component: Date picker
- Question: Are `2000-01-01` and `2099-12-31` actual allowed limits, or only
  boundary examples for visual review?
- Available evidence: [FACT] The story calls these values "Boundary values",
  but `attachDatePicker` does not enforce a date range
  (`ui-ux/ux/stories/date-picker.stories.ts:States`,
  `src/renderer/datepicker.ts:attachDatePicker`).
- Status: OPEN

## OQ-005

- Component: Combobox suggestion item
- Question: Which parent combobox behaviors are required for keyboard movement,
  selection, and dismissal around these option items?
- Available evidence: [FACT] The story says the input owns focus and navigation,
  while the component factory only supplies option state and pointer selection;
  no owning input is present in this story
  (`combobox-suggestion-item.stories.ts:States`,
  `uiElements.ts:createComboboxSuggestionItem`).
- Status: OPEN

## OQ-006

- Component: Sidebar pill
- Question: What does the optional count represent in each usage, and should a
  zero count be displayed?
- Available evidence: [FACT] The component accepts any numeric count; the
  standalone story shows `4`, `12`, and `128`, while the app-shell fixture uses
  open-task counts for lists and tags (`sidebar-pill.stories.ts:States`,
  `uiElements.ts:createSidebarPill`,
  `ui-ux/ux/concepts/app-shell-preview.ts`).
- Status: OPEN

## OQ-007

- Component: Tag chip and dot
- Question: When a tag chip has no activation callback, should it remain a
  focusable button or render as non-interactive text?
- Available evidence: [FACT] `createTagChip` always returns a button, including
  story samples without callbacks (`tag-chip-dot.stories.ts:States`,
  `uiElements.ts:createTagChip`).
- Status: OPEN

## OQ-008

- Component: App shell fixture
- Question: What keyboard behavior and focus restoration are required for the
  view picker and its listbox options?
- Available evidence: [FACT] The fixture exposes listbox semantics and pointer
  selection but does not implement Arrow, Home/End, Enter, or Escape handlers
  for the view menu (`app-shell-preview.ts:createAppShellPreview`).
- Status: OPEN

## OQ-009

- Component: Overdue task treatments
- Question: Which overdue treatment, if any, is approved: meta emphasis, inert
  chip, or row rail and tint?
- Available evidence: [FACT] Every related story says exploration only and no
  direction is approved
  (`ui-ux/ux/concepts/overdue-task-treatments.stories.ts`).
- Status: OPEN

## OQ-010

- Component: Overdue task treatments
- Question: In product behavior, when does a date-only task become overdue, and
  which time zone supplies that cutoff?
- Available evidence: [FACT] The deterministic concept treats a date-only task
  as due at `23:59` in a fixed `+02:00` offset, but explicitly frames this as
  fixture logic rather than backend/product evidence
  (`ui-ux/ux/concepts/overdue-fixtures.ts:isOverdue`).
- Status: OPEN

## OQ-011

- Component: Quick Add concepts
- Question: Are the visible fixture defaults and shorthand/preset values product
  defaults or examples used only for comparison?
- Available evidence: [FACT] The stories label Populated, Empty, Save error, and
  Long content controls as Storybook fixtures and use frozen values such as
  Work, Personal, Today, Tomorrow, and fixed 2026 dates
  (`quick-add-pilot.stories.ts`, `quick-task-add-metadata.stories.ts`,
  `quick-add-inline-metadata-layouts.stories.ts`).
- Status: RESOLVED
- Resolution: [HUMAN DECISION] (user message, 2026-08-29) The fixture values are
  comparison examples only. A new task defaults to the list currently in view if
  one is selected, and to no list otherwise; priority defaults to empty; the
  reminder date defaults to empty.

## OQ-012

- Component: Quick Add concepts (inline metadata layouts)
- Question: Do the concept's Task list and Priority menu semantics — real
  `role="menuitemradio"` buttons with `aria-checked`, Arrow/Home/End movement,
  and Escape that restores trigger focus — also define required behavior for the
  shipped compose menus, or do they apply only to these unapproved layouts?
- Available evidence: [FACT] `createMenuField` implements those semantics and its
  own comment states the shipped priority menu does not
  (`ui-ux/ux/concepts/quick-add-inline-metadata-layouts.stories.ts`). [FACT] The
  shipped `#compose-priority-menu` rows are role-less `div`s selected by a
  click-only handler, and the edit dialog's `#priority-menu` container carries no
  `role="menu"` (`index.html`, `src/renderer/composeOptions.ts`,
  `src/renderer/index.ts`).
- Status: RESOLVED
- Resolution: [HUMAN DECISION] (user message, 2026-08-29) This is not a product
  question and should not be carried as one. The concept's menu semantics are
  recorded as observable facts in the Value row spec's Interactions section. The
  shipped compose menus' missing roles and keyboard handling are an already-filed
  accessibility defect (F-01 High, F-02 Medium in
  `ui-ux/handoffs/phase3-handoff.md`), tracked there rather than in this
  register.

