# App shell fixture

Last reviewed: 2026-08-28

## Purpose

- [FACT] Provides an interactive, deterministic rendering of Adeo's sidebar,
  view picker, compose position, and task view for evaluating Storybook concepts
  in application context (`ui-ux/ux/concepts/fixture-catalog.stories.ts:AppShell`,
  `ui-ux/ux/concepts/app-shell-preview.ts:createAppShellPreview`).
- [FACT] The story explicitly labels this shell as a Storybook design-lab
  fixture and not part of Adeo; it is evidence of the demonstrated UI, not proof
  that every local fixture behavior is approved product behavior
  (`fixture-catalog.stories.ts:AppShell`).

## Storybook References

- [FACT] `Concepts/Fixture catalog / App Shell`
  (`concepts-fixture-catalog--app-shell`) in
  `ui-ux/ux/concepts/fixture-catalog.stories.ts`.
- [FACT] Related infrastructure state catalog: `Concepts/Fixture catalog /
  Deterministic States` (`concepts-fixture-catalog--deterministic-states`).

## UI Structure

- [FACT] Two-column shell: a sidebar rail and main column
  (`app-shell-preview.ts:createAppShellPreview`).
- [FACT] Sidebar contains separate Lists, Smart lists, and Tags panels, each with
  a heading and toggle action. Lists includes an All lists destination
  (`app-shell-preview.ts`).
- [FACT] Main column contains a view picker, replaceable compose slot, and
  production task preview (`app-shell-preview.ts`).
- [FACT] The view picker owns a `role="listbox"` menu grouped into All lists,
  Lists, and Smart lists; each destination is a button with `role="option"` and
  `aria-selected` (`app-shell-preview.ts:renderViewMenu`).

## States

- [FACT] Each sidebar panel has expanded and collapsed state; all start expanded
  (`app-shell-preview.ts:ShellState`).
- [FACT] Exactly one view key is active: All lists, a list, or a smart list. The
  active view is reflected in sidebar selection, view-picker label, menu option,
  and displayed fixture tasks (`app-shell-preview.ts:renderAll`).
- [FACT] A smart-list panel with no entries displays `No smart lists yet.`
  (`app-shell-preview.ts:renderSmartListsPanel`).
- [FACT] The deterministic catalog includes populated, empty, and save-error
  fixture cards, while App Shell uses multi-list fixture data with recurring and
  reminder examples (`fixture-catalog.stories.ts`,
  `ui-ux/ux/concepts/fixtures.ts`).

## Interactions

- [FACT] Each panel toggle shows or hides its panel contents
  (`app-shell-preview.ts:createPanelHeader`).
- [FACT] Activating a list/smart-list sidebar pill or view-menu option selects
  that view, closes the view menu, updates selection, and re-renders tasks
  (`app-shell-preview.ts:selectView`, `renderAll`).
- [FACT] The view-picker button toggles the listbox. A document click outside
  the shell closes it; clicks inside the menu do not bubble to that handler
  (`app-shell-preview.ts`).
- [FACT] Lists, smart lists, and tags can be drag-reordered within their own
  groups. Reordering a list or smart list also updates view-menu order
  (`app-shell-preview.ts:renderListsPanel`, `renderSmartListsPanel`,
  `renderTagsPanel`).
- [FACT] Task-row drag-and-drop is intentionally structural-only/not wired in
  this fixture (`app-shell-preview.ts` file comment).
- [OPEN QUESTION: OQ-008] The fixture does not define complete keyboard behavior
  for the view picker/listbox.

## Data displayed/entered

- [FACT] Sidebar displays list names and open-task counts, smart-list names with
  query text in `title`, and tag names, dots, and open-task counts
  (`app-shell-preview.ts`).
- [FACT] The selected view determines which fixture task set is displayed. The
  caller may replace a view's tasks or replace the composer without rebuilding
  the shell (`app-shell-preview.ts:AppShellPreviewHandle`).
- [FACT] The default compose slot displays a task text input and Add task button,
  but the fixture does not wire submission unless a concept supplies its own
  composer (`app-shell-preview.ts`).

## Validation

- [FACT] Unknown view keys fall back to label `All lists`; absent task arrays
  render as empty (`app-shell-preview.ts:viewLabelFor`, `renderTasks`).
- [FACT] The fixture does not persist selected view, panel expansion, or reorder
  changes beyond the mounted story instance (`app-shell-preview.ts:ShellState`).

## Relevant assumptions

- [ASSUMPTION] The shell is intended to preserve production-like structure and
  component presentation, while its local state wiring is only a Storybook
  approximation (`fixture-catalog.stories.ts:AppShell`,
  `app-shell-preview.ts` file comment).

## Human decisions

<!-- human-owned:start -->
No human decisions recorded yet.
<!-- human-owned:end -->

## Open questions

- [OPEN QUESTION: OQ-008] Define required keyboard navigation, dismissal, and
  focus restoration for the view picker.

