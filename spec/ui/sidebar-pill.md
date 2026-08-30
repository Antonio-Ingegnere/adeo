# Sidebar pill

Last reviewed: 2026-08-28

## Purpose

- [FACT] Presents a sidebar destination with explicit label, optional count,
  selected state, and activation callback
  (`ui-ux/ux/stories/sidebar-pill.stories.ts`,
  `src/renderer/uiElements.ts:createSidebarPill`).

## Storybook References

- [FACT] `Components/Sidebar pill / States`
  (`components-sidebar-pill--states`) in
  `ui-ux/ux/stories/sidebar-pill.stories.ts`.

## UI Structure

- [FACT] The root is a focusable `div` with `role="button"` and
  `aria-pressed`; it contains a label span and, when provided, a count span
  (`uiElements.ts:createSidebarPill`).
- [FACT] Labels longer than the default 30 characters are shortened with `...`;
  the full label is retained in the label title and root accessible name
  (`uiElements.ts:createSidebarPill`).

## States

- [FACT] Unselected `Personal` with count `4`.
- [FACT] Selected and keyboard-focused `Planning` with count `12`.
- [FACT] Long label with count `128`, visual truncation, and full accessible
  label (`sidebar-pill.stories.ts:States`).

## Interactions

- [FACT] Pointer click invokes the supplied activation callback. Enter and Space
  prevent default and synthesize the same click (`uiElements.ts:createSidebarPill`).
- [FACT] Drag ordering is intentionally feature-owned and absent from the
  isolated story (`sidebar-pill.stories.ts:meta`).

## Data displayed/entered

- [FACT] Displays required label, optional count, and selected state. The caller
  may override the CSS class and maximum visible label length
  (`uiElements.ts:SidebarPillOptions`).

## Validation

- [FACT] No validation is applied to the count or maximum label length
  (`uiElements.ts:createSidebarPill`).
- [OPEN QUESTION: OQ-006] Count meaning and zero-count presentation are not
  defined consistently by the component contract.

## Relevant assumptions

- [ASSUMPTION] `aria-pressed` is used to communicate the currently selected
  destination, although activation does not mutate selected state inside the
  component (`uiElements.ts:createSidebarPill`).

## Human decisions

<!-- human-owned:start -->
No human decisions recorded yet.
<!-- human-owned:end -->

## Open questions

- [OPEN QUESTION: OQ-006] Define count semantics per sidebar usage and whether
  zero remains visible.

