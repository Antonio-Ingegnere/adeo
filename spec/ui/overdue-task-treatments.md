# Overdue task treatments

Last reviewed: 2026-08-28

## Purpose

- [FACT] Compares three non-production ways to distinguish incomplete tasks
  whose due moment is before a deterministic clock, while reusing the production
  task-row structure
  (`ui-ux/ux/concepts/overdue-task-treatments.stories.ts`,
  `ui-ux/ux/concepts/overdue-fixtures.ts`).
- [FACT] The Storybook copy explicitly says no treatment is approved and only
  the user can choose one (`overdue-task-treatments.stories.ts`).

## Storybook References

- [FACT] `Concepts/Overdue task treatments / A — Overdue meta emphasis`
  (`concepts-overdue-task-treatments--a-meta-emphasis`).
- [FACT] `Concepts/Overdue task treatments / B — Overdue chip`
  (`concepts-overdue-task-treatments--b-overdue-chip`).
- [FACT] `Concepts/Overdue task treatments / C — Row rail and tint`
  (`concepts-overdue-task-treatments--c-row-rail-and-tint`).
- [FACT] `Concepts/Overdue task treatments / Compare A / B / C`
  (`concepts-overdue-task-treatments--compare-alternatives`).
- [FACT] All references are exported from
  `ui-ux/ux/concepts/overdue-task-treatments.stories.ts`.

## UI Structure

- [FACT] Each alternative decorates the same production task preview after it is
  rendered; it adds one row class and one marker inside the existing task meta
  line (`overdue-task-treatments.stories.ts:decorateOverdue`).
- [FACT] Alternative A prepends a warning glyph and visible `Overdue` text and
  emphasizes the due date (`createMetaFlag`, treatment notes).
- [FACT] Alternative B prepends an inert `Overdue` span styled as a chip while
  leaving due-date text in its normal treatment (`createOverdueChip`).
- [FACT] Alternative C adds a row rail/tint and prepends visually hidden
  `Overdue` text; it adds no visible word (`createVisuallyHiddenOverdue`).

## States

- [FACT] `No overdue tasks`: three incomplete tasks that are future-due,
  due-later-today, or undated; no treatment should appear.
- [FACT] `One overdue task`: one incomplete past-due task among current/undated
  tasks.
- [FACT] `Several overdue tasks, mixed with normal ones`: three overdue rows,
  including long-title and recurring cases, plus a completed past-due task that
  remains untreated and two current tasks
  (`overdue-fixtures.ts:overdueScenarios`).
- [FACT] Comparison story renders all three alternatives against all three data
  states (`overdue-task-treatments.stories.ts:CompareAlternatives`).

## Interactions

- [FACT] None of the treatments adds a focus target or click action
  (`overdue-task-treatments.stories.ts:treatments`, `decorateOverdue`).
- [FACT] Alternative B's chip is a span, not a button. Alternative C's hidden
  label supplies assistive text without adding a control
  (`overdue-task-treatments.stories.ts`).

## Data displayed/entered

- [FACT] Treatment eligibility uses due date, optional due time, and completion
  state. Visible task data also demonstrates title, priority, tags, and optional
  repeat summary (`overdue-fixtures.ts`).
- [FACT] The concept clock is fixed at `2026-08-26T09:30:00+02:00`; an
  incomplete task is treated when its derived due moment is strictly earlier
  (`overdue-fixtures.ts:isOverdue`).
- [FACT] No data is entered in these stories.

## Validation

- [FACT] Completed or undated tasks are never treated as overdue. Date-only
  fixtures derive a `23:59` due time in fixed offset `+02:00`
  (`overdue-fixtures.ts:isOverdue`).
- [OPEN QUESTION: OQ-010] The date-only cutoff and time-zone rule are concept
  fixture behavior, not confirmed product behavior.
- [FACT] The decorator throws if an eligible production row or its task meta
  line cannot be found, preventing a silently incomplete concept rendering
  (`overdue-task-treatments.stories.ts:decorateOverdue`).

## Relevant assumptions

- [ASSUMPTION] Findings in the story's evaluation notes describe trade-offs to
  resolve, not requirements to implement, because the alternatives are
  explicitly unapproved (`overdue-task-treatments.stories.ts:treatments`).

## Human decisions

<!-- human-owned:start -->
No human decisions recorded yet.
<!-- human-owned:end -->

## Open questions

- [OPEN QUESTION: OQ-009] Select or reject the three demonstrated overdue
  treatments.
- [OPEN QUESTION: OQ-010] Define the product cutoff and time zone for date-only
  overdue calculation.

