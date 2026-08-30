# Date picker

Last reviewed: 2026-08-28

## Purpose

- [FACT] Replaces a native date input's visible surface with an accessible
  trigger and calendar dialog while keeping the native input value as an ISO
  date (`ui-ux/ux/stories/date-picker.stories.ts`,
  `src/renderer/datepicker.ts:attachDatePicker`).

## Storybook References

- [FACT] `Components/Date picker / States`
  (`components-date-picker--states`) in
  `ui-ux/ux/stories/date-picker.stories.ts`.

## UI Structure

- [FACT] The original date input is hidden and followed by a button with the
  formatted value and calendar icon. The button controls a `role="dialog"`
  popover containing month navigation, a Monday-first calendar grid, and Today
  and Clear actions (`datepicker.ts:attachDatePicker`).
- [FACT] The month label is polite live text; days are buttons inside gridcells,
  selected cells expose `aria-selected`, and today exposes
  `aria-current="date"` (`datepicker.ts:renderCalendar`).

## States

- [FACT] Closed and empty: trigger text is `Select date`.
- [FACT] Boundary examples: `2000-01-01` and `2099-12-31` are rendered using the
  story's `DD/MM/YYYY` formatter.
- [FACT] Open year boundary: `2025-12-31` opens December 2025 using deterministic
  today `2026-01-01`; a status output reflects changes
  (`date-picker.stories.ts:States`).
- [FACT] Calendar cells distinguish current month, other month, selected date,
  today, and the single roving focus target (`datepicker.ts:renderCalendar`).

## Interactions

- [FACT] Clicking the trigger toggles the popover. Opening starts at the selected
  date or today and focuses that day (`datepicker.ts:openPopover`).
- [FACT] Previous/next buttons move one month. Selecting any visible day,
  including an adjacent-month cell, writes ISO `YYYY-MM-DD`, emits a bubbling
  `change` event, closes, and returns focus to the trigger
  (`datepicker.ts:selectDate`, `renderCalendar`).
- [FACT] Arrow Left/Right move one day, Arrow Up/Down move one week, Home/End
  move to Monday/Sunday, and Page Up/Down move one month while preserving the
  day where possible (`datepicker.ts:renderCalendar`).
- [FACT] Today selects the injected/system date. Clear empties the value. Escape
  closes and restores trigger focus; outside click closes without restoring
  focus (`datepicker.ts`).
- [FACT] The popover chooses above or below the trigger based on available
  vertical space and is horizontally clamped to the viewport
  (`datepicker.ts:positionPopover`).

## Data displayed/entered

- [FACT] Stored/changed value: ISO date string or empty string. Display value:
  caller-supplied formatter, otherwise the shared UI date formatter
  (`datepicker.ts:DatePickerOptions`, `refreshTrigger`).
- [FACT] Accessible name priority is explicit option, input `aria-label`,
  associated label text, then `Date` (`datepicker.ts:attachDatePicker`).

## Validation

- [FACT] The parser accepts a string matching `YYYY-MM-DD`; no minimum, maximum,
  disabled-date, or invalid-date message is implemented in the picker
  (`datepicker.ts:parseIso`, `attachDatePicker`).
- [OPEN QUESTION: OQ-004] The story's 2000/2099 values are not confirmed product
  limits.

## Relevant assumptions

- [ASSUMPTION] Date format and deterministic today are dependencies supplied by
  the caller in isolated rendering; product callers may supply different values
  (`date-picker.stories.ts`, `datepicker.ts:DatePickerOptions`).

## Human decisions

<!-- human-owned:start -->
No human decisions recorded yet.
<!-- human-owned:end -->

## Open questions

- [OPEN QUESTION: OQ-004] Confirm whether the boundary examples define an
  allowed date range.

