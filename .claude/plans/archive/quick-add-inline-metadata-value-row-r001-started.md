# Implementation Plan

## Plan Metadata

- Plan ID: `quick-add-inline-metadata-value-row`
- Revision: `1`
- Lifecycle Status: `DRAFT`
- Source Specification: `spec/ui/quick-add-inline-metadata-value-row.md`
- Created: `2026-08-29`
- Updated: `2026-08-29`

## Goal

Turn the shipped Quick Add **Options disclosure** into the selected `A · Value row` inline
metadata layout: Task list, Priority and Reminder permanently visible in one compact, label-free
row directly under the input row, each control self-describing through a leading glyph, its
current value and a caret, with `<field>: <value>` as its accessible name.

This is a presentation and discoverability change on top of work that already ships. The data path
built by the `quick-add-options-disclosure` plan — `state.composeListId` (tri-state),
`state.composePriority`, `state.composeReminderDate`, `composeSeed()`, the
compose-beats-template-beats-sidebar destination rule in `addTask()`, `#compose-status` /
`#compose-error` — is correct against this specification and is **reused unchanged**. What changes
is the surface: no toggle, no stacked labels, content-sized triggers that truncate, a `role="group"`
wrapper, and a shorter Escape ladder.

## Current Behavior

### Markup (`index.html:227-282`, inside `.compose-block`)

- `.compose-options` (line 229) — the `#compose-options-toggle` button (`.view-bar-action`,
  `aria-expanded`, `aria-controls="compose-options-panel"`, label `Options`), then
  `#compose-error` (`role="alert"`) and `#compose-status` (`.visually-hidden`, `role="status"`).
- `#compose-options-panel` (line 235) — `hidden` by default; three `.compose-option` columns, each
  a stacked visible label plus its control:
  - Task list: `<p class="compose-option-label" id="compose-list-label">Task list</p>` +
    `.modal-list-select-wrap.reminder-select-wrap` > `#compose-list-picker` (`.reminder-picker`,
    `aria-labelledby="compose-list-label compose-list-value"`) > `#compose-list-value` +
    `.priority-caret`; `#compose-list-menu` (`.modal-list-menu`, `role="menu"`, rows generated).
  - Priority: same shape with `#compose-priority-picker` (`.priority-picker`),
    `#compose-priority-chip`, `#compose-priority-value`, and `#compose-priority-menu`
    (`.priority-menu`, `role="menu"`) holding four **static role-less `<div>`**
    `.priority-menu-item[data-value]` rows.
  - Reminder: `<label for="compose-reminder-date" class="compose-option-label">Reminder</label>` +
    `<input id="compose-reminder-date" type="date" class="reminder-date-input" />`, upgraded at
    init by `attachDatePicker`.

### Behaviour (`src/renderer/composeOptions.ts`)

- `setupComposeOptions()` (line 101) wires the toggle, both pickers, both menus, the date picker
  and the panel's Escape handler. `openComposeOptions()` moves focus to `#compose-list-picker`.
- `paintComposeListLabel()` (line 38) calls `renderListOptions(refs.composeListMenu,
  state.composeListId ?? null, refs.composeListValue)` and then overwrites the label with
  `Current list` while `composeListId === undefined`.
- `paintComposePriority()` (line 46) sets the swatch via `setPriorityAttr` and capitalises the word.
- `hasComposeOptions()` (line 56) drives `#compose-options-toggle[data-active]`.
- Escape (line 164) closes, in order: the list menu → the priority menu → the panel, each restoring
  focus to its own trigger; `isDatePickerOpen()` makes it stand down for the date popover.
- `resetComposeOptions()` (line 89) clears all three fields on a successful add and collapses the
  panel.

### Everything else already correct against this spec

- `src/renderer/actions.ts:23-123` — blank submit is a true no-op with `Enter a task before adding.`
  and focus returned; the three-tier `listId` precedence (line 72); `{ ...templateSeed(template),
  ...composeSeed() }` with the `repeatStart` correction (line 85); draft preserved on failure.
- `src/renderer/composeFeedback.ts` — `#compose-status` clear-then-set so an identical repeat
  announcement still fires; `#compose-error` for blank/failure.
- `src/renderer/datepicker.ts:76` — trigger + Monday-first popover, Today/Clear, Escape with focus
  restore, viewport clamping in `positionPopover` (line 392), and `isDatePickerOpen()`.
- `src/renderer/lists.ts:42` — `renderListOptions`: `No list` + `state.lists`, 30-char truncation
  into `title`, `.selected`, and the `labelEl || refs.modalListLabel` fallback (line 89) that every
  compose caller must defeat by passing its own label element.

### Styling (`styles.css`)

`.compose-options` 2756, `.compose-options-toggle[data-active]` 2762, `.compose-options-panel`
2767 (plus the load-bearing `[hidden]` rule at 2776), `.compose-option` 2780,
`.compose-option-label` 2786, `.compose-error` 2792, and the Quick-Add-scoped
`@media (max-width: 480px)` block at 2802-2823. The reused control styles are
`.priority-picker`/`.reminder-picker` (1749, `width: 100%`), `.priority-menu` (1800,
`left: -7.5%; width: 115%`), `.modal-list-select-wrap` (1846, `min-width: 140px; width: 100%`),
`.modal-list-menu` (1852, `width: 100%; min-width: 140px`), `.reminder-date-input` (1894, bordered
100px box) and `.date-picker-trigger` (2133 — no border or background of its own; it inherits
whatever classes the input carried, because `attachDatePicker` builds the trigger's `className`
from `input.className`).

### Tests

`scripts/quick-add-selftest.mjs` — 18 scenario groups. Scenarios 7-9, 13, 14, 16 and 17 assert the
toggle/panel directly (`openOptions()`, `#compose-options-panel` hidden/visible,
`#compose-options-toggle` focus and `aria-expanded`).

## Desired Behavior

From `spec/ui/quick-add-inline-metadata-value-row.md`:

1. The composer is two rows: the task input plus the icon-only Add button, then a **permanent,
   wrapping metadata row** holding Task list, Priority and Reminder in that order.
2. That row is a `role="group"` named `Details for the next task` and carries **no visible group
   label and no per-field visible labels**.
3. Task list and Priority are buttons built from a leading glyph/swatch, the current value and a
   caret; each exposes `<field>: <value>` as its accessible name and controls its menu.
4. Reminder uses the production date picker; its trigger shows the formatted value or
   `Select date`, exposes `Reminder: <value>`, and places its calendar glyph **before** the value
   so all three fields lead with a glyph.
5. Each trigger is content-sized up to a fixed maximum and truncates an over-long value with an
   ellipsis; the row wraps when the three no longer fit on one line.
6. An unset field reads `Current list`, `None` or `Select date`, and the Value row gives the unset
   state **no separate visual treatment** — the value word is the only signal. Set state is still
   exposed on the field wrapper and trigger as data.
7. Tab order: Task, Add task, Task list, Priority, Reminder.
8. Escape closes one open menu or date popover and restores its trigger; with nothing open the
   permanent row and the draft are unchanged.
9. Clicking outside the composer closes any open metadata surface without changing values.
10. Every trigger is at least 44px tall at viewport widths up to 480px.
11. New-task defaults stay: current view's list if one is selected, otherwise no list; priority
    empty; reminder empty (OQ-011).

## Relevant Architecture

Unchanged conventions this plan must obey (root `CLAUDE.md`, all re-verified in the code):

- `refs` (`src/renderer/dom.ts:3`) resolves at import ⇒ **every element is static markup in
  `index.html`**; nothing in this row may be generated at runtime except the list menu's rows,
  which `renderListOptions` already owns.
- Nothing shared may live at bare `src/`; the row's logic stays in `src/renderer/composeOptions.ts`,
  which must remain a leaf (no import of `actions.ts`, `index.ts` or `tasks.ts`).
- Escape ownership is layered by `stopPropagation()` in the module that owns the surface; Escape is
  `fixed` in the shortcut registry and is never dispatched or rebound.
- The document `click` handler (`index.ts:1479-1520`) is what closes open menus on an outside click.
- Spacing uses the `--space-*` scale; a raw value needs an adjacent
  `/* spacing-exception: <reason> */`.
- No production module may import from `ui-ux/` (`npm run check:ux-boundary`). The concept's
  `.qaim-*` classes, `createMenuField`, `createComposer` and fixtures are **evidence, not code to
  copy**: the layout rules are re-authored under production names.
- Automated UI runs use the full `ADEO_UI_TEST` environment through
  `scripts/lib/isolated-electron.mjs`.

Useful mechanical facts confirmed for this change:

- `attachDatePicker` sets `trigger.className = \`${input.className} date-picker-trigger\`` and
  `.date-picker-trigger` itself declares no border/background — so giving `#compose-reminder-date`
  the `reminder-picker` class makes its generated trigger render as the same sunken pill as the
  other two fields, with no new component. The input is `display: none`, so its own appearance is
  irrelevant.
- `.date-picker-trigger-label` already truncates with an ellipsis; `flex-direction: row-reverse`
  moves the existing `.date-picker-trigger-icon` in front of it. Both are the concept's own
  technique (`quick-add-inline-layouts.css:101`), re-authored under production selectors.
- The date popover is positioned and viewport-clamped by `positionPopover` itself, so the spec's
  `data-menu-align="end"` has no visible effect on the right-most field in this layout.

## Proposed Solution

### 1. The disclosure becomes a permanent row

`#compose-options-toggle` and `#compose-options-panel` are replaced by a single always-visible
`#compose-meta-row` (`role="group"`, `aria-label="Details for the next task"`). Removed with them:
`openComposeOptions`/`closeComposeOptions`/`isComposeOptionsOpen`, the `data-active` toggle cue,
`hasComposeOptions`'s only consumer, the panel-level `[hidden]` CSS rule, and the panel layer of
the Escape ladder.

**This supersedes an explicit requirement of approved UX decision 0001** ("Optional metadata is
exposed by a clearly named disclosure"; risk mitigation "Keep a visible, named disclosure"). The
newer 2026-08-29 human decision selecting Value row makes the metadata permanently visible, which
serves the same discoverability goal more directly — but the conflict is between two approved
records and is raised as **Open Question 1**, not assumed.

`.compose-options` survives as the feedback container: it keeps `#compose-error` and
`#compose-status` and simply loses the toggle.

### 2. Field markup: glyph, value, caret; the name lives in `aria-label`

Each of the three fields becomes `.compose-field.compose-field--{list,priority,reminder}` inside
the row. `aria-labelledby="compose-*-label compose-*-value"` is replaced by an `aria-label` that
`composeOptions.ts` rewrites on every paint as `` `${fieldName}: ${value}` ``; the three
`.compose-option-label` elements are deleted, along with the `<label for="compose-reminder-date">`.

- **Task list** gains a leading `.compose-field-icon` span holding an inline `aria-hidden` list
  glyph (three rules with leading dots), authored in `index.html` — not imported from `ui-ux/`.
- **Priority** already has `#compose-priority-chip` as its leading swatch; it stays, still
  `aria-hidden`, still painted by `setPriorityAttr`.
- **Reminder** uses `attachDatePicker`'s own icon, moved ahead of the label by CSS.

Each paint also writes `data-set` on both the field wrapper and the trigger (`list` set unless
`Current list`, `priority` set unless `none`, `reminder` set unless empty). Per the spec the Value
row gives that state **no visual treatment**; it is written because the spec records it as exposed
state and it is what a later layout, a test, or a review can read.

### 3. Sizing, truncation and wrapping

New production rules (re-authored equivalents of the concept's shared field CSS):

- `.compose-meta-row` — `display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-8);
  min-width: 0`.
- `.compose-field` — `position: relative; flex: 0 1 auto; width: auto; min-width: 0` (defeats
  `.modal-list-select-wrap`'s `min-width: 140px; width: 100%`).
- `.compose-field .reminder-picker`, `.compose-field .priority-picker`,
  `.compose-field .date-picker-trigger` — `width: auto; max-width: 200px; gap: var(--space-6)`
  (defeats `.priority-picker/.reminder-picker { width: 100% }`).
- `.compose-value` — `min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap`
  (`.date-picker-trigger-label` already does this).
- `.compose-field .priority-menu`, `.compose-field .modal-list-menu` — `left: 0; width: max-content;
  min-width: 160px; max-width: min(260px, calc(100vw - var(--space-24)))`, because
  `.priority-menu`'s `left: -7.5%; width: 115%` is derived from a full-width trigger and becomes
  unreadable under a content-sized one.
- `.compose-field[data-menu-align='end'] .priority-menu`, `… .modal-list-menu` — `left: auto;
  right: 0`. Applied to the right-most field, per the spec, even though Reminder's popover is
  clamped by the picker itself; the rule is what keeps the row correct if the order ever changes.
- `.compose-field--reminder .date-picker-trigger` — `flex-direction: row-reverse; gap:
  var(--space-6)`.

`#compose-reminder-date`'s class changes from `reminder-date-input` to `reminder-picker
compose-trigger`, so its generated trigger inherits the sunken-pill treatment instead of the
bordered date-input box (see Relevant Architecture).

### 4. Escape, Enter and outside click

Escape, one surface per press, each `stopPropagation()`-ing:

1. Tag suggestion menu → close, focus stays in `#message-input`. *(unchanged)*
2. Reminder date popover → `datepicker.ts` closes it and restores its trigger. *(unchanged)*
3. Compose list menu → close, focus to `#compose-list-picker`.
4. Compose priority menu → close, focus to `#compose-priority-picker`.
5. Otherwise → existing app behaviour (topmost overlay / clear search). **The panel layer is gone**;
   with nothing open inside the row, the row is permanent and Escape falls through, which is
   exactly the spec's "the permanent metadata row and draft remain unchanged".

The keydown listener moves from `#compose-options-panel` to `#compose-meta-row`.

Enter is unchanged: the tag suggestion menu owns it while open, `#message-input` submits, and a
control inside the row activates itself and never submits.

Outside click is unchanged — `index.ts:1509-1516` already hides both compose menus and resets their
`aria-expanded`.

### 5. Success announcement names the destination

The spec's announcement is `Added “<title>” to <list>.`; `composeFeedback.ts` currently writes
`Added “<text>”.`. `addTask()` already computes the effective `listId` before the call, so it can
pass the resolved label (`state.lists.find(...)?.name`, or `No list` when the destination is
`null`) to `announceComposeSuccess(text, listLabel)`. This matters more once the destination can be
overridden from a permanently visible control: the announcement becomes the AT-side equivalent of
what the row shows.

The spec's error string `Could not save the task. Keep the draft and try again.` is
`errorConceptFixture` text, i.e. deterministic fixture evidence rather than product copy, so the
shipped `Couldn’t add the task. Your draft is kept — try Add again.` stays.

### 6. Responsive

The `@media (max-width: 480px)` block is re-scoped from `.compose-options-panel …` to
`.compose-meta-row .priority-picker`, `.compose-meta-row .reminder-picker`,
`.compose-meta-row .date-picker-trigger` → `min-height: 44px`; `#add-button` keeps 44×44; the
`flex-direction: column` rule for the panel is dropped, because the row already wraps by design.
`#add-task-template`'s wrap rule stays. Still scoped to Quick Add only; whole-app narrow layout
remains P5.4's.

### 7. Deliberately unchanged

`state.composeListId`'s tri-state, `composeSeed()`, the `addTask()` precedence and `repeatStart`
correction, `#compose-error`/`#compose-status`, blank-submit semantics, the tag-suggestion path,
and every backend/IPC contract.

## Files to Modify

### `index.html`

Replace lines 229-282 with the feedback container plus the permanent row:

- `.compose-options` keeps `#compose-error` and `#compose-status`; the toggle button is deleted.
- `<div id="compose-meta-row" class="compose-meta-row" role="group" aria-label="Details for the
  next task">` containing, in order:
  - `.compose-field.compose-field--list` > `.modal-list-select-wrap` semantics inlined on the field
    wrapper > `#compose-list-picker` (`.reminder-picker`, `aria-haspopup="menu"`,
    `aria-expanded="false"`, `aria-controls="compose-list-menu"`) holding
    `<span class="compose-field-icon" aria-hidden="true">` (inline list glyph SVG),
    `#compose-list-value` (`.compose-value`, text `Current list`) and `.priority-caret`; then
    `#compose-list-menu` (`.modal-list-menu`, `role="menu"`, `aria-label="Task list"`).
  - `.compose-field.compose-field--priority` > `#compose-priority-picker` (`.priority-picker`,
    same ARIA) holding `#compose-priority-chip`, `#compose-priority-value` (`.compose-value`) and
    the caret; then `#compose-priority-menu` (`.priority-menu`, `role="menu"`,
    `aria-label="Priority"`) with its four `.priority-menu-item[data-value]` rows (their element
    type depends on Open Question 3).
  - `.compose-field.compose-field--reminder[data-menu-align="end"]` >
    `<input id="compose-reminder-date" type="date" class="reminder-picker compose-trigger"
    aria-label="Reminder" />`.
- Keep the existing comment explaining why this is static markup.

The three `.compose-option-label` elements, the `<label for>`, `#compose-options-toggle` and
`#compose-options-panel` are removed.

### `src/renderer/dom.ts`

Remove `composeOptionsToggle` and `composeOptionsPanel` (lines 127-128); add `composeMetaRow`,
`composeListField`, `composePriorityField`, `composeReminderField` (the wrappers that carry
`data-set`). The remaining nine compose refs are unchanged.

### `src/renderer/composeOptions.ts`

- Delete `isComposeOptionsOpen`, `closeComposeOptions`, `openComposeOptions`, `paintToggleState`
  and the toggle listener. `hasComposeOptions` is deleted unless Open Question 4 keeps a consumer.
- `paintComposeListLabel` also writes the trigger's `aria-label` (`Task list: <value>`) and
  `data-set` on `refs.composeListField` and `refs.composeListPicker`. Keep the existing
  `Current list` override for `composeListId === undefined` and the explicit `refs.composeListValue`
  argument to `renderListOptions` (or the edit dialog's label is repainted instead).
- `paintComposePriority` likewise writes `Priority: <value>` and `data-set`.
- A new `paintComposeReminder()` writes `data-set` on the reminder field/trigger after each change;
  the trigger's own `aria-label` and label text are already maintained by `datepicker.ts`'s
  `refreshTrigger`.
- The Escape handler moves to `refs.composeMetaRow` and loses its panel branch (Proposed Solution
  §4).
- `resetComposeOptions()` keeps clearing all three fields but no longer collapses anything —
  subject to Open Question 2.
- `attachDatePicker(refs.composeReminderDate, { accessibleName: 'Reminder' })` is unchanged.

### `src/renderer/composeFeedback.ts` and `src/renderer/actions.ts`

`announceComposeSuccess(text, listLabel)` writes `Added “<text>” to <listLabel>.`; `addTask()`
resolves that label from the `listId` it already computed (line 72) and passes it. No other change
to `actions.ts`.

### `src/renderer/activeSmartList.ts`

Only if Open Question 4 removes the compose-driven chips: the memo key, the
`hasComposeMetadata` guard, the `composeListId` destination branch and the compose priority/reminder
chips revert to their pre-`quick-add-options-disclosure` form. Otherwise unchanged.

### `src/renderer/index.ts`

No wiring change is required — `setupComposeOptions()` (line 1605), the `#message-input` `input`
listener calling `clearComposeFeedback()` (line 741) and the document-click menu closer (lines
1509-1516) all keep working. Only the two deleted refs must be checked for stray references.

### `styles.css`

- Replace `.compose-options-panel*`, `.compose-option`, `.compose-option-label` and
  `.compose-options-toggle[data-active]` (2762-2790) with `.compose-meta-row`, `.compose-field`,
  `.compose-field-icon`, `.compose-value`, the trigger width/menu-geometry overrides and the
  reminder glyph reversal from Proposed Solution §3.
- `.compose-options` keeps its flex row for the feedback line; `.compose-error` is unchanged.
- Re-scope the `@media (max-width: 480px)` block per Proposed Solution §6.
- The `.compose-options-panel[hidden]` rule is deleted with the panel it protected; note in a
  comment why no `[hidden]` guard is needed any more.
- Dark mode needs no new rules — every value is an existing token.

### `scripts/quick-add-selftest.mjs`

Rewrite the toggle-dependent scenarios (see Tests). The isolation posture, the protected-file guard
and the SQLite assertions are untouched.

### Documentation

Update the `Quick Add options` section of root `CLAUDE.md` to describe the permanent Value row: why
it is static markup, why the disclosure was dropped, the shortened Escape ladder, why the accessible
name carries the field name now that the visible label is gone, and why `#compose-reminder-date`
carries the `reminder-picker` class.

## Implementation Steps

1. **Markup.** Replace the toggle/panel with `#compose-meta-row` and the three label-free fields;
   move `#compose-error`/`#compose-status` into the slimmed `.compose-options`.
2. **Refs.** Drop the two removed refs; add the three field wrappers and `composeMetaRow`.
3. **CSS.** Add the row/field/trigger/menu rules, the reminder glyph reversal, delete the panel
   rules, re-scope the 480px block.
4. **`composeOptions.ts`.** Delete the disclosure code; add `aria-label` and `data-set` painting to
   the three paint functions; move the Escape handler to the row and drop its panel branch.
5. **Announcement.** Extend `announceComposeSuccess` and its one caller.
6. **Menu semantics.** Apply Open Question 3's answer (either implement the concept's
   `menuitemradio` keyboard behaviour here, or leave the menus exactly as they are and keep
   F-01/F-02 filed).
7. **Hints row.** Apply Open Question 4's answer.
8. **Tests.** Update `scripts/quick-add-selftest.mjs`; add the new Value-row scenarios.
9. **Docs.** Update root `CLAUDE.md`.
10. **Verify.** `npm run build`, `npm run check:ux-boundary`, `node scripts/query-selftest.mjs`,
    `node scripts/shortcuts-selftest.mjs`, `npm run test:isolation`, `npm run test:quick-add`,
    `npm run storybook:build`.

## Edge Cases

| Case | Expected behavior |
|---|---|
| Long list name (`Quarterly planning and stakeholder review`) | The trigger stops at its 200px maximum and ellipsises; the full name stays in the accessible name and in `renderListOptions`' `title`. The row wraps rather than pushing the reminder past the column's right edge. |
| Narrow column (about 315px) with all three fields set | The row wraps to two lines; no horizontal page overflow; each trigger stays ≥44px tall under the 480px block. |
| Nothing set | Fields read `Current list`, `None`, `Select date` with no distinguishing styling, per the spec; `data-set="false"` is still exposed. |
| Reminder popover open, Escape pressed | `datepicker.ts` closes it and restores its trigger; the row is untouched. |
| List menu open, click outside the composer | `index.ts`'s document click handler closes it and resets `aria-expanded`; no value changes. |
| Priority menu open, Tab pressed | Focus leaves; the menu must not trap. (If Open Question 3 adopts the concept semantics, Tab explicitly closes the menu without restoring focus.) |
| A list is renamed/deleted while the row is idle | The list menu is repainted on open (`paintComposeListLabel` in the picker's click handler), and `renderListOptions` already falls back to its first entry for a stale id. |
| `composeListId === undefined` | The trigger reads `Current list`; the task lands wherever the view/template would already send it. Unchanged. |
| Explicit `No list` chosen | `composeListId === null`; the task is unfiled regardless of the view. Unchanged. |
| Add succeeds | Draft cleared, focus back in `#message-input`, announcement names the task and its destination. Whether the three metadata values reset is Open Question 2. |
| Add fails | Text, pending tags and all three metadata values are preserved; `#compose-error` names the failure and the retry. Unchanged. |
| Blank submit | No task and no tag; `Enter a task before adding.`; focus back in the field. Unchanged. |
| A running smart list sets `priority:high` and the row shows `Low` | `Low` wins (compose beats template, unchanged) — and the permanently visible row now shows the winning value directly. |

## Error Handling

No new error conditions. Both existing ones keep their behaviour and copy:

1. **Blank text** — client-side, never reaches IPC: `Enter a task before adding.` in
   `#compose-error`, focus returned to `#message-input`.
2. **Recoverable save failure** — `{ error }` or a thrown IPC error alike: whole draft preserved
   (text, pending tags, and every metadata value in the row), `Couldn’t add the task. Your draft is
   kept — try Add again.`, focus returned, `console.error` retained for the thrown case, and the
   server's own message never surfaced.

The removal of the disclosure introduces no failure mode of its own: with no `hidden` panel there is
nothing that can be left in an inconsistent expanded/collapsed state, and the `[hidden]`-versus-flex
hazard the panel needed a rule for disappears with it.

## Tests

All runs use the shared isolated environment (`scripts/lib/isolated-electron.mjs`); nothing may
touch the development database or user-data directory.

### `scripts/quick-add-selftest.mjs` — changes

| # | Scenario | Change |
|---|---|---|
| 1-6 | Success, blank submit, tag-only, error-clears | Unchanged, except scenario 1 also asserts `#compose-status` matches `Added “<text>” to <list>.` |
| 7, 8, 8a, 8b | Metadata applied to the created task | Drop `openOptions()`; interact with the always-visible controls directly. Database assertions unchanged. |
| 8c | Default label | Unchanged: `#compose-list-value` reads `Current list` before any selection. |
| 9 | Reset after success | Replace the panel/toggle assertions with the value assertions only, per Open Question 2's answer. |
| 10 | Chips | Per Open Question 4's answer. |
| 11, 11a | Compose beats the template | Unchanged apart from removing `openOptions()`. |
| 12 | Tag suggestion keyboard | Unchanged. |
| 13 | Escape layering | Now two layers: with the priority menu open, Escape closes it and focuses `#compose-priority-picker`; a second Escape leaves the row untouched and opens no overlay. |
| 14 | Escape from `#message-input` | The row stays visible, no overlay opens. |
| 16, 17 | Responsive and touch | Replace `#compose-options-toggle` with the three row triggers; assert each is ≥44px high at the narrow viewport and that `#compose-meta-row` does not overflow `.main-body`. |
| 18 | Light and dark | Replace the `data-active` toggle assertion with `#compose-meta-row`'s triggers rendering in both schemes with a contrasting error colour. |

### New scenarios

| # | Scenario | Assertions |
|---|---|---|
| 19 | **The row is permanent** | `#compose-meta-row` is visible at load, `#compose-options-toggle` and `#compose-options-panel` do not exist, and the row is still visible after a successful add. |
| 20 | **Group and field naming** | `#compose-meta-row` has `role="group"` and accessible name `Details for the next task`; the three triggers' accessible names read `Task list: Current list`, `Priority: None`, `Reminder: Select date`, and update after a selection. |
| 21 | **Tab order** | From `#message-input`, four Tabs reach `#add-button`, `#compose-list-picker`, `#compose-priority-picker`, then the reminder trigger, in that order. |
| 22 | **Truncation** | With a list whose name exceeds the trigger's maximum, `#compose-list-picker`'s width is ≤ its maximum, its `scrollWidth` exceeds its `clientWidth` (i.e. it is clipped), and the full name is still in its accessible name. |
| 23 | **No unset-state styling** | The computed colour/background of a set and an unset trigger are identical, per the spec's "the visible value word is the only signal". |

Regression: `npm run test:isolation` (same check count), `node scripts/query-selftest.mjs`,
`node scripts/shortcuts-selftest.mjs`, `npm run storybook:build`, `npm run check:ux-boundary`.

Manual evidence for the implementation review: light/dark screenshots of the row set and unset, a
narrow-width screenshot showing the wrap, and a keyboard walkthrough of the tab order and Escape
ladder.

## Acceptance Criteria

1. The compose block renders exactly two rows: the input row, then a permanently visible metadata
   row; no Options toggle and no disclosure panel remain in the DOM or the stylesheet.
2. The metadata row is a `role="group"` named `Details for the next task` and shows no visible
   field labels.
3. Task list, Priority and Reminder appear in that order, each with a leading glyph, its current
   value and a caret, and each exposing `<field>: <value>` as its accessible name, kept in sync
   after every selection.
4. Each trigger is content-sized up to its maximum, truncates with an ellipsis beyond it, and the
   row wraps instead of overflowing.
5. Unset fields read `Current list`, `None` and `Select date` with no separate visual treatment,
   while `data-set` is exposed on the wrapper and trigger.
6. Tab order is Task, Add task, Task list, Priority, Reminder.
7. Escape closes exactly one open menu or date popover and restores its trigger; with nothing open
   the row and draft are unchanged and no overlay opens.
8. Clicking outside the composer closes any open metadata surface without changing a value.
9. A task created with row values set is persisted with the chosen `list_id`, `priority` and
   `reminder_date`, and an explicit row value still beats a running smart list's template.
10. Success announces `Added “<title>” to <list>.`; blank submit and recoverable failure keep their
    current copy, draft preservation and focus behaviour.
11. Every trigger is at least 44px tall at ≤480px, and there is no horizontal overflow at the
    verified viewports.
12. `npm run build`, `npm run check:ux-boundary`, `node scripts/query-selftest.mjs`,
    `node scripts/shortcuts-selftest.mjs`, `npm run test:isolation`, `npm run test:quick-add` and
    `npm run storybook:build` all pass.
13. No file under `server/`, `src/main.ts`, `src/preload.ts` or `ui-ux/` is modified.

## Non-goals

- **The data path.** `state.compose*`, `composeSeed()`, the destination precedence and the
  `repeatStart` correction are not redesigned.
- **New metadata.** No reminder time, repeat rule or details in the compose row; no schema,
  endpoint or `TaskSeed` change.
- **The edit dialog.** `#priority-picker`, `#reminder-picker`, `#modal-list-picker` and the
  `modal*` state keep their single-owner relationship with the edit modal.
- **The other three concept layouts.** Meta chips, Same-line cluster and Unified context bar are
  explicitly not selected; none of their CSS ships.
- **`ui-ux/` concept code.** No `.qaim-*` class, `createMenuField`, `createComposer`,
  `app-shell-preview` or fixture is imported or copied; the layout rules are re-authored under
  production names.
- **The shortcut registry.** No new shortcut id; the row is reached by Tab.
- **App-wide responsive layout and `src/main.ts`'s `minWidth: 600`.** Still P5.4's.
- **Storybook.** No production compose-row story is added; the concept file stays concept code.

## Decision Log

### `2026-08-29 — Value row is the layout to implement`

- Source: `SPECIFICATION`
- Decision: Implement `A · Value row` — three permanently visible, label-free fields in the order
  Task list, Priority, Reminder — and no other concept layout.
- Reason: `spec/ui/quick-add-inline-metadata-value-row.md` records the 2026-08-29 human decision
  resolving OQ-003.
- Supersedes: `None`

### `2026-08-29 — Reuse the shipped compose data path unchanged`

- Source: `CODE EVIDENCE`
- Decision: Keep `state.composeListId`'s tri-state, `composeSeed()`, the
  compose-beats-template-beats-sidebar destination rule and the `repeatStart` correction exactly as
  implemented; this plan changes presentation only.
- Reason: `src/renderer/actions.ts:69-90` and `src/renderer/composeOptions.ts:82-99` already satisfy
  the specification's Data and Validation sections, including the OQ-011 defaults; rebuilding them
  would be change without a requirement.
- Supersedes: `None`

### `2026-08-29 — Fixture values and the fixture error string are not product copy`

- Source: `SPECIFICATION`
- Decision: Keep empty priority/reminder and the current view's list as new-task defaults, and keep
  the shipped failure message rather than the concept's
  `Could not save the task. Keep the draft and try again.`
- Reason: OQ-011 records the fixture selections as comparison examples; the error string comes from
  `errorConceptFixture`, which the spec labels deterministic fixture data.
- Supersedes: `None`

### `2026-08-29 — The reminder trigger is restyled through its input's class, not a new component`

- Source: `CODE EVIDENCE`
- Decision: Give `#compose-reminder-date` the `reminder-picker` class so `attachDatePicker`'s
  generated trigger inherits the same sunken pill as the other two fields, and reverse its glyph
  order in CSS.
- Reason: `datepicker.ts:98` builds the trigger's `className` from the input's, and
  `.date-picker-trigger` (`styles.css:2133`) declares no border or background of its own — so no new
  control is needed to make the three fields read alike.
- Supersedes: `None`

## Revision Log

### `r001 — 2026-08-29 — started`

- Summary: First draft of the Value row plan: replace the Quick Add Options disclosure with a
  permanent, label-free metadata row, reusing the shipped compose data path, feedback surfaces and
  date picker. Five open questions recorded.
- Trigger: `/implementation-plan start spec=spec/ui/quick-add-inline-metadata-value-row.md`.

## Open Questions

1. **Removing the disclosure contradicts approved UX decision 0001.** Decision 0001 requires
   "Optional metadata is exposed by a clearly named disclosure" and lists "Keep a visible, named
   disclosure" as a risk mitigation. Value row makes the metadata permanently visible instead.
   Confirm that the 2026-08-29 Value row decision supersedes that requirement — and whether decision
   0001 should be amended or superseded by a new UX decision record first (that record is the
   Product Designer's or Spec Owner's to write, not this plan's).
2. **Do the three metadata values persist after a successful add?** The specification states, as a
   fact about the concept, that "Metadata selections remain unchanged after successful submission".
   The shipped behaviour is the opposite: `resetComposeOptions()` clears all three. No human
   decision resolves this. Persisting suits repeated capture into one list; resetting prevents a
   forgotten High priority from silently attaching to the next unrelated task — and it is far more
   visible now that the row is permanent. Which is intended?
3. **Are the concept's menu semantics in scope here?** The concept's Task list and Priority menus use
   real `<button role="menuitemradio" aria-checked>` rows with Arrow/Home/End movement, Enter/Space
   selection, Tab-closes and Escape-with-focus-restore. The shipped menus are role-less `<div>`s with
   a click-only handler — filed as F-01 (High) and F-02 (Medium) in
   `ui-ux/handoffs/phase3-handoff.md`. OQ-012 deliberately keeps those defects out of this
   specification. Fix them inside this plan (the markup is being rewritten anyway, so the marginal
   cost is small), or leave them for P4.4?
4. **Do the compose values still appear as chips in `#add-task-template`?** The disclosure needed
   that row because a chosen list was otherwise invisible; a permanently visible Task list control
   states the destination directly, so the chips now duplicate it and cost the vertical space this
   redesign is meant to save. Keep them (one summary of everything the next task gets, including the
   smart-list template's own values), or drop the compose-driven chips and let
   `renderTemplateHints()` return to describing only the running query?
5. **Is 44px at ≤480px still verifiable, and does it still matter?** The shipped window floor is
   `minWidth: 600` (`src/main.ts:809`); the existing suite reaches 390px only by relaxing that floor
   from the test and degrades gracefully when the platform refuses. Keep that approach for the new
   row's touch-target checks, or drop the narrow-viewport assertions until P5.4 makes a narrow
   window reachable in the shipped app?

## Implementation Status

`DRAFT`
