# Shortcut keycap

Last reviewed: 2026-08-28

## Purpose

- [FACT] Presents already-formatted shortcut tokens as individual keycaps; it
  does not own keymap or platform formatting
  (`ui-ux/ux/stories/shortcut-keycap.stories.ts`,
  `src/renderer/uiElements.ts:createShortcutKeycaps`).

## Storybook References

- [FACT] `Components/Shortcut keycap / States`
  (`components-shortcut-keycap--states`) in
  `ui-ux/ux/stories/shortcut-keycap.stories.ts`.

## UI Structure

- [FACT] A wrapper span contains one semantic `<kbd>` element per supplied token
  (`uiElements.ts:createShortcutKeycaps`).

## States

- [FACT] Demonstrated values are `⌘` + `K`, `Shift` + `Enter`, `?`, and
  `Page Down` (`shortcut-keycap.stories.ts:States`).

## Interactions

- [FACT] None. The component is display-only (`uiElements.ts`).

## Data displayed/entered

- [FACT] Displays a caller-supplied ordered array of strings. It collects no
  input (`uiElements.ts:ShortcutKeycapsOptions`).

## Validation

- [FACT] No empty-token, duplicate-token, or length validation is performed;
  each supplied string becomes one keycap (`uiElements.ts:createShortcutKeycaps`).

## Relevant assumptions

- [ASSUMPTION] Caller-side formatting determines whether modifiers use symbols
  or words because the component contains no platform logic
  (`shortcut-keycap.stories.ts`, `uiElements.ts`).

## Human decisions

<!-- human-owned:start -->
No human decisions recorded yet.
<!-- human-owned:end -->

## Open questions

- [FACT] No unresolved user-observable behavior is identified by the available
  isolated Storybook/component evidence.

