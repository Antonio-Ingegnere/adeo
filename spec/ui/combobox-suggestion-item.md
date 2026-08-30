# Combobox suggestion item

Last reviewed: 2026-08-28

## Purpose

- [FACT] Renders one option inside a caller-owned suggestion list, with explicit
  label, active/disabled state, optional metadata hint, optional tag color, and
  a selection callback (`ui-ux/ux/stories/combobox-suggestion-item.stories.ts`,
  `src/renderer/uiElements.ts:createComboboxSuggestionItem`).

## Storybook References

- [FACT] `Components/Combobox suggestion item / States`
  (`components-combobox-suggestion-item--states`) in
  `ui-ux/ux/stories/combobox-suggestion-item.stories.ts`.

## UI Structure

- [FACT] The story places four option buttons in a `role="listbox"` container
  followed by a status output (`combobox-suggestion-item.stories.ts:States`).
- [FACT] Each option has `role="option"`, `aria-selected`, `aria-disabled`, and
  `tabindex="-1"`; tag options may prepend a decorative color dot and query
  options may append a metadata hint
  (`uiElements.ts:createComboboxSuggestionItem`).

## States

- [FACT] Normal tag: `#planning`, pastel dot visible, not selected.
- [FACT] Active query: `priority:high`, `High priority` hint, selected.
- [FACT] Disabled tag: `#archived`, pastel dot visible, not selectable.
- [FACT] Long query: `tag:quarterly-planning-and-retrospective` with a long
  metadata hint (`combobox-suggestion-item.stories.ts:States`).

## Interactions

- [FACT] Selectable options handle `mousedown`, prevent default and propagation,
  then invoke the supplied callback; this keeps focus ownership with the parent
  input (`uiElements.ts:createComboboxSuggestionItem`).
- [FACT] The active state is presentational/semantic input; the option factory
  does not move active state itself (`uiElements.ts`).
- [OPEN QUESTION: OQ-005] The parent combobox keyboard and dismissal contract is
  not demonstrated by this isolated story.

## Data displayed/entered

- [FACT] Displays a required label and optional hint and color. It does not
  accept text input itself (`uiElements.ts:ComboboxSuggestionItemOptions`).

## Validation

- [FACT] A disabled item receives both the native `disabled` property and
  `aria-disabled="true"`; active styling and `aria-selected="true"` are
  suppressed while disabled (`uiElements.ts:createComboboxSuggestionItem`).
- [ASSUMPTION] Callers are responsible for unique IDs and for keeping the parent
  input's active-descendant state synchronized because the factory does not
  validate either concern (`uiElements.ts`).

## Relevant assumptions

- [ASSUMPTION] Query versus tag variant changes presentation but not the
  selection callback contract (`uiElements.ts:createComboboxSuggestionItem`).

## Human decisions

<!-- human-owned:start -->
No human decisions recorded yet.
<!-- human-owned:end -->

## Open questions

- [OPEN QUESTION: OQ-005] Define the owning combobox's keyboard movement,
  selection, focus, and dismissal behavior.

