# Tag chip and dot

Last reviewed: 2026-08-28

## Purpose

- [FACT] Presents tag labels as task, pending, or filter chips and optionally
  presents a decorative tag-color dot
  (`ui-ux/ux/stories/tag-chip-dot.stories.ts`,
  `src/renderer/uiElements.ts:createTagChip`, `createTagDot`).

## Storybook References

- [FACT] `Components/Tag chip and dot / States`
  (`components-tag-chip-and-dot--states`) in
  `ui-ux/ux/stories/tag-chip-dot.stories.ts`.

## UI Structure

- [FACT] A chip is always a native button whose class depends on task, pending,
  or filter variant. Its text is the supplied label
  (`uiElements.ts:createTagChip`).
- [FACT] A dot is an `aria-hidden` span with the supplied background color, or
  no element when colors are disabled (`uiElements.ts:createTagDot`).

## States

- [FACT] Interactive `#planning` with colors enabled and a filter title.
- [FACT] Plain `#personal` with colors disabled and no dot.
- [FACT] Disabled `#archived` with color.
- [FACT] Long `#quarterly-planning-and-retrospective` label.
- [FACT] Rose, Mint, Aqua, and Periwinkle palette dots
  (`tag-chip-dot.stories.ts:States`).

## Interactions

- [FACT] When supplied, the activation callback runs on native button click.
  Native disabled state suppresses activation (`uiElements.ts:createTagChip`).
- [OPEN QUESTION: OQ-007] The semantic/keyboard behavior of a chip without a
  callback is unclear because it remains a focusable button.

## Data displayed/entered

- [FACT] Chip inputs are label, color, colors-enabled flag, optional variant,
  title, accessible name, disabled state, and callback
  (`uiElements.ts:TagChipOptions`).
- [FACT] No text is entered through the chip or dot.

## Validation

- [FACT] The factory applies the color string directly and performs no color
  syntax or contrast validation (`uiElements.ts:styleTagChip`, `createTagDot`).

## Relevant assumptions

- [ASSUMPTION] Color is supplementary rather than the only tag identifier
  because every demonstrated chip also has visible label text
  (`tag-chip-dot.stories.ts:States`).

## Human decisions

<!-- human-owned:start -->
No human decisions recorded yet.
<!-- human-owned:end -->

## Open questions

- [OPEN QUESTION: OQ-007] Decide whether display-only tag chips should remain
  buttons or use non-interactive markup.

