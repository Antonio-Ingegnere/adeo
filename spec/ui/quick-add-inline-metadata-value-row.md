# Quick Add inline metadata — Value row

Last reviewed: 2026-08-29

## Purpose

- [FACT] Specifies the `A · Value row` concept for entering a task while keeping
  Task list, Priority, and Reminder visible and directly editable in a compact
  row without stacked visible labels
  (`ui-ux/ux/concepts/quick-add-inline-metadata-layouts.stories.ts:ValueRow`,
  `notes.values`).
- [HUMAN DECISION] (2026-08-29) Value row is the selected inline metadata
  layout; Meta chips, Same-line cluster, and Unified context bar are not
  selected. Resolves OQ-003.
- [FACT] The Storybook story itself remains concept code and marks no layout
  approved; it is evidence for the selected direction, not a production
  implementation (`quick-add-inline-metadata-layouts.stories.ts` file header,
  `meta`).

## Storybook References

- [FACT] `Concepts/Quick Add inline metadata layouts / A · Value row`
  (`concepts-quick-add-inline-metadata-layouts--value-row`) in
  `ui-ux/ux/concepts/quick-add-inline-metadata-layouts.stories.ts`.
- [FACT] Direct UI evidence: `createLayoutConcept('values')`, `createComposer`,
  `createMenuField`, and `createReminderField` in the same story file, plus the
  production date picker in `src/renderer/datepicker.ts`.
- [FACT] Deterministic example data comes from
  `ui-ux/ux/concepts/fixtures.ts`.

## UI Structure

- [FACT] The proposed composer contains a task input and icon-only Add task
  button on the first row. A second, wrapping metadata row contains Task list,
  Priority, and Reminder in that order
  (`quick-add-inline-metadata-layouts.stories.ts:createComposer`).
- [FACT] The metadata row has `role="group"` and accessible name `Details for
  the next task`; it has no visible group label
  (`quick-add-inline-metadata-layouts.stories.ts:GROUP_LABEL`,
  `createComposer`).
- [FACT] Task list and Priority are buttons composed of a leading glyph/swatch,
  current value, and caret. Each button exposes `<field>: <value>` as its
  accessible name and controls a menu
  (`quick-add-inline-metadata-layouts.stories.ts:createMenuField`).
- [FACT] Reminder uses the production date-picker controller. Its visible
  trigger presents the formatted value or `Select date` with a calendar glyph
  and exposes `Reminder: <value>` as its accessible name
  (`quick-add-inline-metadata-layouts.stories.ts:createReminderField`,
  `src/renderer/datepicker.ts:attachDatePicker`).
- [FACT] The right-most field carries `data-menu-align="end"`, which aligns a
  Task list or Priority menu to the row's end. In Value row that right-most
  field is Reminder, so the attribute has no visible effect here: the production
  date popover is positioned by the picker itself and clamped to the viewport
  edge (`quick-add-inline-metadata-layouts.stories.ts:createComposer`,
  `ui-ux/ux/concepts/quick-add-inline-layouts.css`,
  `src/renderer/datepicker.ts:positionPopover`).
- [FACT] In this layout the Reminder trigger places its calendar glyph before
  the value, matching the leading glyph of the other two fields
  (`ui-ux/ux/concepts/quick-add-inline-layouts.css`,
  `.qaim-field--reminder .date-picker-trigger`).
- [FACT] Each trigger is content-sized up to a fixed maximum width and truncates
  an over-long value with an ellipsis instead of growing further; the row itself
  wraps when the three fields no longer fit on one line
  (`ui-ux/ux/concepts/quick-add-inline-layouts.css`: `.qaim-trigger`,
  `.qaim-value`, `.qaim-row`).
- [FACT] The story page also contains fixture switches, theme indicator,
  measured-height output, app-shell preview, and evaluation notes. These are
  explicitly Storybook scaffolding and are not part of the proposed composer
  (`quick-add-inline-metadata-layouts.stories.ts:createLayoutConcept`).

## States

- [FACT] `Populated`: draft from the populated fixture, Work list, Medium
  priority, and reminder `2026-08-24`
  (`quick-add-inline-metadata-layouts.stories.ts:resetModel`,
  `defaultsForFixture`).
- [FACT] `Empty`: empty draft/task fixture, Current list, no priority, and no
  reminder (`quick-add-inline-metadata-layouts.stories.ts:defaultsForFixture`).
- [FACT] `Save error`: error fixture draft, Personal list, High priority, and
  reminder `2026-08-25`; the error appears after submission and the selections
  remain available for retry (`quick-add-inline-metadata-layouts.stories.ts`).
- [FACT] `Long content`: long task draft, `Quarterly planning and stakeholder
  review` list, High priority, and `2026-12-31` reminder. At narrow widths the
  metadata controls wrap rather than replacing their values with labels
  (`quick-add-inline-metadata-layouts.stories.ts:longDraft`,
  `defaultsForFixture`, `notes.values`).
- [FACT] Task list is considered unset only for Current list; Priority is unset
  only for None; Reminder is unset only when empty. Set state is exposed on the
  field wrapper and trigger (`quick-add-inline-metadata-layouts.stories.ts:
  createMenuField`, `createReminderField`).
- [FACT] An unset field reads `Current list`, `None`, or `Select date`. The
  Value row layout gives the unset state no separate visual treatment, so the
  visible value word is the only signal that a field is unset
  (`quick-add-inline-metadata-layouts.stories.ts:listLabels`, `priorityLabels`,
  `src/renderer/datepicker.ts:refreshTrigger`,
  `ui-ux/ux/concepts/quick-add-inline-layouts.css`, which styles `data-set` only
  for the chip and cluster layouts).
- [FACT] At viewport widths up to 480px every trigger in the row is at least
  44px tall (`ui-ux/ux/concepts/quick-add-inline-layouts.css`,
  `@media (max-width: 480px)`).
- [HUMAN DECISION] The fixture selections and frozen dates are comparison
  examples, not product defaults. A new task defaults to the list currently in
  view if one is selected and to no list otherwise, with empty priority and
  empty reminder date (OQ-011).

## Interactions

- [FACT] Typing updates the draft. Enter in Task and clicking Add task both
  submit (`quick-add-inline-metadata-layouts.stories.ts:createInputParts`).
- [FACT] Clicking Task list or Priority toggles its menu. Arrow Down opens at
  the first item; Arrow Up opens at the last item
  (`quick-add-inline-metadata-layouts.stories.ts:createMenuField`).
- [FACT] Within either menu, Arrow Up/Down wraps through items, Home/End moves to
  the first/last item, and Enter or Space activates the focused button using
  native button behavior. The selected row has `role="menuitemradio"` and
  `aria-checked="true"` (`quick-add-inline-metadata-layouts.stories.ts:
  createMenuField`).
- [FACT] Selecting a menu item updates the visible value, closes the menu, and
  returns focus to its trigger (`quick-add-inline-metadata-layouts.stories.ts:
  createMenuField`).
- [FACT] Escape closes one open list/priority menu or date popover and restores
  its trigger. With no surface open, the permanent metadata row and draft
  remain unchanged (`quick-add-inline-metadata-layouts.stories.ts:
  createComposer`, `createMenuField`, `createReminderField`).
- [FACT] Tab closes an open list/priority menu without restoring focus. Clicking
  outside the composer closes any open metadata surface without changing values
  (`quick-add-inline-metadata-layouts.stories.ts:createMenuField`,
  `createComposer`).
- [FACT] The normal tab order is Task, Add task, Task list, Priority, Reminder
  (`quick-add-inline-metadata-layouts.stories.ts:notes.values`,
  `createComposer`).
- [FACT] Priority is not communicated by color alone: the current priority word
  remains visible and menu rows pair their word with an `aria-hidden` swatch
  (`quick-add-inline-metadata-layouts.stories.ts:createMenuField`).

## Data displayed/entered

- [FACT] Entered data: task title. Selectable metadata: Task list (`Current
  list`, `No list`, `Work`, `Personal`, or the long Quarterly fixture), Priority
  (`None`, `Low`, `Medium`, `High`), and Reminder date
  (`quick-add-inline-metadata-layouts.stories.ts:listLabels`,
  `priorityLabels`, `createReminderField`).
- [FACT] Reminder values are stored as ISO dates and displayed as day,
  abbreviated month, and year, for example `24 Aug 2026`
  (`quick-add-inline-metadata-layouts.stories.ts:formatReminder`).
- [FACT] Successful submission prepends a task using the trimmed title, selected
  priority, and formatted reminder to the All lists fixture preview, then clears
  the draft, returns focus to Task, and announces `Added “<title>” to <list>.`
  in a visually hidden polite status region, the new task row being the visible
  confirmation (`quick-add-inline-metadata-layouts.stories.ts:
  createLayoutConcept`, `createComposer`).
- [FACT] Metadata selections remain unchanged after successful submission; only
  the task draft, error, and status values are reset by the story's submit
  handler (`quick-add-inline-metadata-layouts.stories.ts:createLayoutConcept`).

## Validation

- [FACT] A whitespace-only title is rejected with `Enter a task before adding.`;
  the draft and metadata remain and focus returns to Task
  (`quick-add-inline-metadata-layouts.stories.ts:createLayoutConcept`).
- [FACT] In Save error state, submission reports the deterministic fixture error
  `Could not save the task. Keep the draft and try again.` in the row's
  `role="alert"` region, preserves task text and metadata, and returns focus to
  Task (`quick-add-inline-metadata-layouts.stories.ts:createLayoutConcept`,
  `createComposer`, `ui-ux/ux/concepts/fixtures.ts:errorConceptFixture`).
- [FACT] The concept does not demonstrate validation for list availability,
  priority values beyond the fixed menu, or reminder-date range
  (`quick-add-inline-metadata-layouts.stories.ts`).

## Relevant assumptions

- [ASSUMPTION] Removing the visible field labels is an accepted constraint of
  the selected layout, carried over from the Inline essentials direction
  (`quick-add-inline-metadata-layouts.stories.ts` file header and `notes`). The
  choice of Value row itself is no longer an assumption; see Human decisions.
- [ASSUMPTION] The measured compose-block heights are comparison evidence rather
  than acceptance thresholds
  (`quick-add-inline-metadata-layouts.stories.ts:createLayoutConcept`, `notes`).
  The fixture values are no longer assumed: their status is settled under Human
  decisions.

## Human decisions

<!-- human-owned:start -->
- [HUMAN DECISION] (2026-08-29) Proceed with option A, Value row, as the
  selected inline metadata layout. Resolves OQ-003.
- [HUMAN DECISION] (2026-08-29) New-task defaults are the list currently in view
  if one is selected, otherwise no list; priority empty; reminder date empty.
  The Storybook fixture values are comparison examples only. Resolves OQ-011.
- [HUMAN DECISION] (2026-08-29) The relationship between this concept's menu
  semantics and the shipped compose menus is not a product question for this
  spec. The concept behavior is recorded under Interactions; the shipped menus'
  gap is the filed accessibility defect F-01/F-02 in
  `ui-ux/handoffs/phase3-handoff.md`. Resolves OQ-012.
<!-- human-owned:end -->

## Open questions

- None. OQ-003, OQ-011, and OQ-012 are RESOLVED; their decisions are recorded
  under Human decisions and in `spec/_open-questions.md`.

