# Implementation Plan

## Plan Metadata

- Plan ID: `quick-add-options-disclosure`
- Revision: `1`
- Lifecycle Status: `APPROVED`
- Source Specification: `ui-ux/ux/decisions/0001-quick-add-direction.md`
- Created: `2026-08-26`
- Updated: `2026-08-29`

## Migration Note

This plan existed as a legacy full plan inside `.claude/plans/current.md` before the named-plan
lifecycle was adopted. Revision 1 is that plan preserved verbatim from `## Goal` onward; only
Plan Metadata, this note, a Decision Log and a Revision Log were added. Nothing was removed,
reworded, or renumbered — including the plan's own out-of-order section numbering in
`Proposed Solution` (§9 precedes §8) and the relative link in `## Goal`, which resolved from
`.claude/plans/current.md` and is one directory level short from `.claude/plans/active/`.

The working tree shows this plan as implemented (`src/renderer/composeOptions.ts`,
`src/renderer/composeFeedback.ts`, `scripts/quick-add-selftest.mjs`, the `Quick Add options`
section of root `CLAUDE.md`), but lifecycle status is only ever changed by an explicit action, so
it stays `APPROVED` here. Run
`/implementation-plan archive plan=quick-add-options-disclosure outcome=implemented` to close it.

## Goal

Implement P2.4: turn approved UX decision
[`ui-ux/ux/decisions/0001-quick-add-direction.md`](../../ui-ux/ux/decisions/0001-quick-add-direction.md)
(Alternative A — Compact/current-direction, story ID
`concepts-quick-add-pilot--compact-current-direction`) into production behavior in Adeo's real
compose row.

Investigation shows most of the approved direction already ships. The real gap is three things:

1. **No optional-metadata disclosure.** Task list, priority and reminder date cannot be set for the
   draft from the compose row today — priority/reminder are edit-dialog-only, and the destination
   list is implied by the view rather than choosable. The approved direction requires a clearly
   named disclosure attached to the current draft.
2. **No feedback on add.** Success is not announced, blank submit says nothing and can lose input
   focus, and a recoverable save failure is silent (`console.error` only).
3. **No narrow-width/touch adaptation** for the compose row.

Everything else the decision lists (context stays visible, Enter/Add submits plain text, inline
`#tag` suggestions with Arrow/Enter/Escape, focus back to the field on success) already works and
must not be rebuilt.

**No backend change is required.** `POST /tasks` (`server/app.py:298`) already accepts
`priority`, `reminderDate`, `reminderTime`, `repeatRule`, `repeatStart`, `done`; `TaskSeed`
(`src/types.ts:64`) already carries them; `ipcMain.handle('add-task')` (`src/main.ts:994`) already
spreads the seed straight into the request body. `listId` is not part of the seed at all — it is
already the **second positional argument** of `electronAPI.addTask(text, listId, tagIds, seed)`
(`src/types.ts:75`) and is forwarded as `listId: listId ?? null` (`src/main.ts:1004`), so a
list override changes only *which value the renderer passes*. This is renderer + markup + CSS +
tests only.

## Current Behavior

### The compose row

`index.html:192-231` — inside `.compose-block`:

- `.view-bar` (rendered by `src/renderer/viewBar.ts`)
- `.input-row` → `.add-task-input-wrap` → `#message-input` (`role="combobox"`,
  `aria-controls="tag-suggest-menu"`) + `#tag-suggest-menu`, then `#add-button`
  (`.primary-button.icon-btn`, 34×34 circle, 20×20 `.icon-add` SVG).

Siblings *after* `.compose-block`, still inside `.main-body`:

- `#add-task-tags` — pending tag chips, painted by `renderPendingTags()` (`tagInput.ts:29`).
- `#add-task-template` — "what the next task will get" chips, painted by `renderTemplateHints()`
  (`activeSmartList.ts:198`).

### Submission

`src/renderer/index.ts:732-737`:

```
refs.addButton?.addEventListener('click', addTask);
refs.input?.addEventListener('keypress', (event) => {
  if (event.key === 'Enter' && !isTagSuggestOpen()) addTask();
});
```

`addTask()` (`src/renderer/actions.ts:21-106`) currently:

1. Reads `refs.input.value`, strips inline `#tag` tokens into `tokenNames`.
2. Adds tag names the running smart-list template asks for (`missingTemplateTagNames`).
3. **Creates every tag in `tokenNames`** via `window.electronAPI.addTag`.
4. Computes `text`; if empty, calls `renderTags()` and returns **silently** — so a submit of only
   `#tags` creates tags but no task and says nothing.
5. Resolves the destination list (smart-list template's `list:` beats `state.selectedListId`).
6. Calls `window.electronAPI.addTask(text, listId, tagIds, templateSeed(template))`.
7. On success: pushes the task into `state.tasks`, clears `state.pendingTagIds`,
   `renderPendingTags()`, `renderTemplateHints(true)`, clears the input, `input.focus()`,
   `renderViewBar()`, `renderTasks()`.
8. On `{ error }` it returns silently; on a thrown error it `console.error`s. The draft in the
   input is preserved in both cases only because the clear happens after success.

### Tag suggestions

`src/renderer/tagInput.ts` already implements the whole approved suggestion behavior: `#`-token
detection, prefix-then-contains matching, a `Create "#name"` row, ArrowDown/ArrowUp, Enter/Tab to
select, Escape to close (with `stopPropagation()` so the app-level Escape does not also fire), and
`syncComboboxAria` keeping `aria-expanded`/`aria-activedescendant` correct.
`shortcuts.ts:148` makes the dispatcher stand down entirely while
`isTagSuggestOpen() || isQuerySuggestOpen() || isDatePickerOpen()`.

### Metadata today

Priority and reminder exist only in the edit dialog (`index.html:267-307`): `#priority-picker` /
`#priority-menu` with `.priority-menu-item[data-value]` and `.priority-chip` colour dots, and
`#reminder-picker` / `#reminder-menu` with `#reminder-date` (`type="date"`) and `#reminder-time`.
The edit dialog's **list** field is `#modal-list-picker` / `#modal-list-menu`
(`index.html:259-265`), painted by `renderListOptions(target, selectedId, labelEl)`
(`src/renderer/lists.ts:42`) via `renderModalLists()` (`modals.ts:427`). It renders `No list` plus
`state.lists` in `position` order as `.modal-list-item[data-value]` buttons, marks the active one
`.selected`, truncates names past 30 chars into a `title`, and writes the chosen label into the
label span. Its documented rule: **"No list" plus the lists, and never a smart list.** Selection is
handled in `index.ts:891-902`. **Note the fallback on `lists.ts:89`** —
`const labelTarget = labelEl || refs.modalListLabel` — so any new caller must pass its own label
element explicitly or it will silently repaint the edit dialog's label.

`index.ts:1590-1592` upgrades the three date inputs with `attachDatePicker()`
(`src/renderer/datepicker.ts:76`), which hides the native input, inserts a `.date-picker-trigger`
button, and renders a Monday-first `role="dialog"` popover with **Today** and **Clear** footer
buttons, Escape-to-close with focus restored to the trigger, and a module-level
`isDatePickerOpen()` the shortcut dispatcher already consults.

### Announcements

The only live region in the app is `#search-status-live`
(`index.html:53`, `.visually-hidden`, `role="status" aria-live="polite"`), written by
`announce()` in `querySearch.ts:101`. The compose row has none.

### Responsive

`styles.css` has breakpoints at 860px and 760px only, both about sidebar/Settings-rail width.
`src/main.ts:809` sets `minWidth: 600`, so the shipped Electron window cannot currently be
narrower than 600 CSS px. `ui-ux/ux/responsive.md` records 390px as a concept-only viewport until
responsive production work (P5.4) is approved.

## Desired Behavior

1. A named **Options** disclosure sits directly under the input row, inside `.compose-block`.
   Collapsed by default. It never blocks plain capture: Enter or Add still submits without ever
   opening it.
2. Opening Options reveals, in this order, **Task list**, **Priority** and **Reminder date**
   controls for the current draft. Chosen values appear as chips in the existing
   `#add-task-template` row, so the row that already answers "what will the next task get" is the
   only place that answers it.
3. Chosen values are applied to the created task through the existing `TaskSeed` path.
4. Escape closes exactly one surface at a time and restores focus to that surface's trigger.
5. Successful add: task created, draft cleared, pending tags cleared, compose options reset, focus
   returned to `#message-input`, and success announced in a compose live region.
6. Blank submit: nothing is created (no task **and no tags**), a visible message names the missing
   task text, and focus returns to `#message-input` even when Add was clicked.
7. Recoverable failure: the complete draft is preserved (text, pending tags, chosen options), a
   visible alert names the failure and the retry path, and focus returns to `#message-input`.
8. Light and dark use production tokens; state cues are not colour-only.
9. The compose row reflows without horizontal page overflow at the required viewports, and its
   primary controls reach 44px at touch/narrow widths.

## Relevant Architecture

Conventions this change must obey (all from root `CLAUDE.md` and verified in the code):

- **`refs` is a module-level literal** (`src/renderer/dom.ts:3`), so `byId` runs at import.
  Anything not in `index.html` at load time is `null` forever ⇒ **all new elements are static
  markup in `index.html`**, never generated.
- **Nothing shared may live at bare `src/`.** New runtime modules go under `src/renderer/`.
  `src/types.ts` stays type-only.
- **`[hidden]` loses to `display:flex`.** Any new panel that sets a flex/grid display needs an
  explicit `.selector[hidden] { display: none }` rule, or it stays in the tab order.
- **Menus close on the document `click` handler** (`index.ts:1479-1512`); menu contents
  `stopPropagation()` on click (see `refs.priorityMenu`/`refs.modalListMenu`).
- **Escape is `fixed`** in the shortcut registry — documented in help, never dispatched, never
  rebindable. Escape ownership is layered by `stopPropagation` in the module that owns the
  surface (`querySearch.ts`, `viewBar.ts`, `tagInput.ts`, `datepicker.ts`).
- **The shortcut dispatcher stands down** while a tag/query suggestion or a date picker is open
  (`shortcuts.ts:148`).
- **Spacing** in new/touched CSS uses the `--space-*` scale (`ui-ux/ux/patterns.md`); a raw value
  needs an adjacent `/* spacing-exception: <reason> */` comment.
- **Copy**: sentence case; "Reminder", not "Due date"; failures name the action and the recovery
  (`ui-ux/ux/content.md`).
- **Test isolation**: any automated Electron run must use the full `ADEO_UI_TEST` environment
  (`ADEO_UI_TEST=1` + absolute `ADEO_USER_DATA_DIR` + absolute `ADEO_DB_PATH`, no `ADEO_API_URL`).

Reused production pieces (do not re-implement):

| Piece | Location | Used for |
|---|---|---|
| `attachDatePicker`, `isDatePickerOpen` | `src/renderer/datepicker.ts` | The reminder-date control, its Today/Clear footer, Escape + focus restore |
| `renderListOptions` | `src/renderer/lists.ts:42` | Populating the task-list control's menu: "No list" + `state.lists`, truncation, `.selected` |
| `.modal-list-select-wrap` / `.modal-list-menu` / `.modal-list-item` / `.reminder-picker` (trigger) | `index.html:259-265`, `styles.css:1846-1889` | The task-list control's markup and styling — position-relative popover, no modal-specific geometry |
| `.priority-picker` / `.priority-menu` / `.priority-menu-item` / `.priority-chip` | `index.html:268-292`, `styles.css` | The priority control's markup and styling |
| `.view-bar-action` | `styles.css:322` | The quiet text-button treatment for the Options toggle |
| `template-chip`, `renderTemplateHints` | `activeSmartList.ts:181,198` | The single "what the next task gets" row |
| `formatDate` | `src/renderer/helpers.ts` | Displaying the chosen reminder date |
| `TaskSeed`, `templateSeed` | `src/types.ts:64`, `activeSmartList.ts:127` | Getting metadata onto the new task |
| `.visually-hidden`, `role="status"` pattern | `index.html:53`, `querySearch.ts:101` | Announcing success |
| `.view-bar-error` (`color: var(--danger)`) | `styles.css:361` | The visible failure/blank line |

## Proposed Solution

### 1. Compose metadata lives in `UIState`, seeded through the existing `TaskSeed`

Add `composePriority: Task['priority']`, `composeReminderDate: string | null` and
`composeListId: number | null | undefined` to `UIState`. Named `compose*` to keep them clearly
distinct from the edit dialog's `modal*` fields.

`composeListId` is tri-state, mirroring the sentinel `resolveTemplateNames` already returns
(`{ listId: number | null | undefined }`, `activeSmartList.ts:145`): **`undefined`** — untouched,
inherit whatever the view/template would already send the task to; **`null`** — the user explicitly
picked "No list" in Options; **a number** — the user explicitly picked that list. Two states
(`undefined` vs. everything else) is not enough: the edit dialog's own rule is "'No list' plus the
lists, and never a smart list" (root `CLAUDE.md`, "The view"), and the compose Options picker should
offer the same explicit "No list" choice for consistency, which a plain `number | null` field cannot
distinguish from "not touched."

A new leaf module `src/renderer/composeOptions.ts` owns the disclosure, the two controls, the
reset, and a `composeSeed(): Partial<TaskSeed>` builder.

### 2. Explicit options beat the smart-list template

`addTask` builds the seed as `{ ...templateSeed(template), ...composeSeed() }` — an explicitly
chosen value wins. This is the same principle already documented for the destination list, where a
running smart list's `list:` term beats `state.selectedListId` because it is the more specific
statement of intent; here the user's direct choice is the more specific statement still.

**The destination list is not part of `TaskSeed`** — `window.electronAPI.addTask(text, listId,
tagIds, seed)` (`src/types.ts:74-80`) takes it as its own positional argument, computed in
`actions.ts` today as:

```ts
const listId = resolved && resolved.listId !== undefined ? resolved.listId : state.selectedListId;
```

This becomes a three-tier precedence, compose beating template beating the sidebar selection —
the same "more specific statement of intent" ordering, now with one more tier:

```ts
const listId =
  state.composeListId !== undefined
    ? state.composeListId
    : resolved && resolved.listId !== undefined
      ? resolved.listId
      : state.selectedListId;
```

### 3. One row says what the next task gets

Rather than adding a second metadata summary, `renderTemplateHints()` grows to include the compose
values. Today it hides itself entirely when there is no search and no template
(`activeSmartList.ts:208-212`), on the reasoning that the view picker above already names the
destination list. **That reasoning only holds for priority and reminder, which never change the
destination.** A compose list override changes it, silently, the same way a running search does —
so the exact same fix already in place for search applies here:

- **No search, no template, compose priority/reminder set, `composeListId` untouched** → show the
  row with **only** the compose chips (no destination chip — the picker still names it, correctly).
- **No search, no template, `composeListId` set** (to a number or explicitly `null`) → show the row
  with a destination chip too, exactly like the existing "While a search is up... this is the only
  place left that can say where the next task will land" branch
  (`activeSmartList.ts:217-219`), because the picker no longer names the true destination. Resolve
  the label the same way that branch already does: the list's name for a number, `'No list'` for
  `null`.
- **Search/template running** → unchanged behaviour, except a compose value replaces the
  template-derived chip for the same field (never more than one chip per field, including the
  destination).
- **Nothing at all** → hidden, as today.

Its memo key gains all three compose values (including `composeListId`) so a change repaints.

### 4. Feedback

New static elements under the input row:

- `#compose-status` — `.visually-hidden`, `role="status" aria-live="polite"`. Success only.
  Success stays AT-only because the new task row is the visible confirmation
  (`ui-ux/ux/content.md`: "Keep successful routine actions quiet unless the outcome is not
  visible").
- `#compose-error` — visible, `role="alert"`, empty and hidden by default. Blank submit and
  recoverable failure.

A tiny leaf module `src/renderer/composeFeedback.ts` exposes
`announceComposeSuccess(text)`, `showComposeError(message)`, `clearComposeFeedback()` so
`actions.ts` can call them without importing anything that imports it back.

### 5. Escape and Enter precedence (explicit, per decision 0001's risk table)

Escape, in order — each layer `stopPropagation()`s so exactly one thing closes:

1. Tag suggestion menu open → close it, focus stays in `#message-input`. *(already implemented)*
2. Compose reminder date popover open → close it, focus to its trigger. *(already implemented by
   `datepicker.ts`)*
3. Compose list menu open → close it, focus to `#compose-list-picker`.
4. Compose priority menu open → close it, focus to `#compose-priority-picker`.
5. Compose Options panel open → close it, focus to `#compose-options-toggle`.
6. Otherwise → existing app behaviour (topmost overlay / clear search).

Enter:

1. Tag suggestion open → select the active suggestion, never submit. *(already implemented, twice:
   `tagInput.ts:159` preventDefaults, and `index.ts:734` guards on `isTagSuggestOpen()`)*
2. Focus in `#message-input` → submit.
3. Focus inside the Options panel → activate that control only; never submit.

### 6. Blank submit creates nothing

`addTask` currently creates tags *before* checking for empty text, so submitting `#foo` with no
task text creates the tag and adds nothing, silently. Reorder so the text check runs first: a blank
submit becomes a true no-op plus a message. This is a small, deliberate behaviour change required
to satisfy "Blank submission does not add a task".

### 7. Options are transient draft state

Reset `composePriority`/`composeReminderDate`/`composeListId` (back to `undefined`, not `null`) on
successful add (alongside the existing `state.pendingTagIds = []`); preserve them on failure and on
blank submit, since the decision requires a failure to preserve *the complete draft*. Options do
not persist across app restarts and are not written to settings.

### 9. Task list is the first Options control, reusing the edit dialog's picker verbatim

`#compose-list-picker` / `#compose-list-menu` / `#compose-list-value` reuse
`.modal-list-select-wrap`/`.modal-list-menu`/`.modal-list-item`/`.reminder-picker` (the trigger's
class) and are populated by calling `renderListOptions(refs.composeListMenu, ?, refs.composeListValue)`
— **note the `labelEl || refs.modalListLabel` fallback at `lists.ts:97-99`: the compose caller must
always pass `refs.composeListValue` explicitly, or it silently repaints the edit dialog's label
instead.**

The `undefined` sentinel needs one small deviation from `renderListOptions`'s own display logic,
which only knows `number | null`: while `state.composeListId === undefined`, `composeOptions.ts`
writes the trigger label itself — **`Current list`** — instead of calling `renderListOptions` for
the label (calling it would show `No list`, which is wrong: nothing has been overridden yet). The
moment the user picks anything from the menu, including its `No list` entry, `composeListId` becomes
a real `number | null` and every later repaint goes through `renderListOptions` normally, the same
as the modal.

Selection handling mirrors `index.ts:891-902` (the modal list menu's own click handler) exactly,
writing `state.composeListId` instead of `state.modalSelectedListId`, then calling
`renderTemplateHints(true)`.

### 8. Responsive / touch

A new `@media (max-width: 480px)` block, scoped to compose-row selectors only, raises
`#add-button`, `#compose-options-toggle`, `#compose-priority-picker` and the date-picker trigger to
`min-height: 44px` (and `min-width: 44px` for the icon button), stacks the Options panel to one
column, and lets the chips row wrap. It must not touch sidebar or dialog geometry — that is P5.4's.
See Open Question 2 for how this is verified.

## Files to Modify

### `index.html`

Add static markup only — no behaviour.

Inside `.compose-block`, immediately after the existing `.input-row` (still before the
`#add-task-tags` sibling), add:

- `<div class="compose-options">` containing
  - `<button id="compose-options-toggle" type="button" class="view-bar-action compose-options-toggle" aria-expanded="false" aria-controls="compose-options-panel">Options</button>`
  - `<p id="compose-error" class="compose-error" role="alert"></p>`
  - `<span id="compose-status" class="visually-hidden" role="status" aria-live="polite"></span>`
- `<div id="compose-options-panel" class="compose-options-panel" hidden>` containing three labelled
  fields, **task list first**:
  - **Task list** — `<p class="compose-option-label" id="compose-list-label">Task list</p>` plus
    a `.modal-list-select-wrap` with `#compose-list-picker` (`.reminder-picker`,
    `aria-haspopup="menu"`, `aria-expanded="false"`,
    `aria-labelledby="compose-list-label compose-list-value"`) holding `#compose-list-value`
    (`<span>Current list</span>`) and the `.priority-caret`; and `#compose-list-menu`
    (`.modal-list-menu`, `role="menu"`), populated at runtime by `renderListOptions` — no static
    `.modal-list-item` rows, since the list of lists is dynamic (unlike priority's fixed four
    values).
  - **Priority** — `<p class="compose-option-label" id="compose-priority-label">Priority</p>` plus
    a `.priority-select-wrap` with `#compose-priority-picker` (`.priority-picker`,
    `aria-haspopup="menu"`, `aria-expanded="false"`,
    `aria-labelledby="compose-priority-label compose-priority-value"`) holding
    `#compose-priority-chip` (`.priority-chip`, `aria-hidden="true"`),
    `#compose-priority-value` (`<span>None</span>`) and the `.priority-caret`; and
    `#compose-priority-menu` (`.priority-menu`, `role="menu"`) with the same four
    `.priority-menu-item[data-value]` rows as `#priority-menu`.
  - **Reminder** — `<label for="compose-reminder-date" class="compose-option-label">Reminder</label>`
    plus `<input id="compose-reminder-date" type="date" class="reminder-date-input" />`.
    `attachDatePicker` replaces it with its own trigger button at init.

Add a comment above the block explaining that it is static because `refs` resolves at import.

### `src/renderer/dom.ts`

Add refs: `composeOptionsToggle`, `composeOptionsPanel`, `composeError`, `composeStatus`,
`composeListPicker`, `composeListMenu`, `composeListValue`, `composePriorityPicker`,
`composePriorityMenu`, `composePriorityChip`, `composePriorityValue`, `composeReminderDate`.

### `src/renderer/state.ts`

Add to `UIState` and to the `state` literal:

- `composePriority: Task['priority']` (default `'none'`)
- `composeReminderDate: string | null` (default `null`)
- `composeListId: number | null | undefined` (default `undefined`)

Document in the type that these are the *compose row's* draft metadata, cleared on a successful
add, distinct from the `modal*` fields the edit dialog uses, and that `composeListId`'s `undefined`
specifically means "not overridden" — not the same as an explicit `null` ("No list").

### `src/renderer/composeOptions.ts` (new)

Leaf module. Imports only `dom.js`, `state.js`, `helpers.js`, `datepicker.js`, `lists.js` (for
`renderListOptions`), `activeSmartList.js` (for `renderTemplateHints`) and `../types`. Must not
import `actions.ts`, `index.ts` or `tasks.ts`.

Exports:

- `setupComposeOptions()` — wires the toggle, the list picker/menu, the priority picker/menu,
  attaches the date picker to `refs.composeReminderDate`, and installs the panel's Escape handler.
  Called once from `index.ts`'s init, after `attachDatePicker` for the modal inputs.
- `isComposeOptionsOpen(): boolean`
- `closeComposeOptions(restoreFocus: boolean)`
- `composeSeed(): Partial<TaskSeed>` — `{}` when nothing is set; otherwise `priority` and/or
  `reminderDate`. **Does not include the list** — `composeListId` is read directly by `actions.ts`
  as a separate `addTask()` argument, not through `TaskSeed` (see Proposed Solution §2).
- `resetComposeOptions()` — clears all three state fields (`composeListId` back to `undefined`,
  not `null`), repaints the list/priority label/chip (list back to `Current list`), clears the
  date input value (`refs.composeReminderDate.value = ''`, which the date picker's `value` setter
  intercepts to refresh its trigger), collapses the panel, and calls `renderTemplateHints(true)`.
- `hasComposeOptions(): boolean` — true when any of the three is set; used for the toggle's
  `data-active` cue.

Behaviour notes for the implementer:

- The toggle flips `panel.hidden`, mirrors `aria-expanded`, and focuses the list picker (now the
  first control) when opening; `closeComposeOptions(true)` returns focus to the toggle.
- The list menu follows the edit dialog's pattern exactly (`index.ts:885-901`): click on the picker
  toggles `style.display` between `'flex'` and `'none'` with `event.stopPropagation()`; a click on
  a `.modal-list-item` reads `dataset.value` (`''` ⇒ `null`, otherwise `Number(...)`), writes
  `state.composeListId`, calls `renderListOptions(refs.composeListMenu, state.composeListId,
  refs.composeListValue)` to repaint both the menu's `.selected` state and the trigger label, closes
  the menu, and calls `renderTemplateHints(true)`. Before any selection (`composeListId ===
  undefined`), `refs.composeListValue.textContent` is set directly to `Current list` instead —
  `renderListOptions` is not called with a `null` selectedId for the *initial* paint, since that
  would render `No list` as if it were already chosen (see Proposed Solution §9).
- The priority menu follows the same pattern: click on the picker toggles
  `style.display` between `'flex'` and `'none'` with `event.stopPropagation()`; a click on a
  `.priority-menu-item` reads `dataset.value`, writes `state.composePriority`, repaints the
  chip/label, closes the menu, and calls `renderTemplateHints(true)`.
- The panel's `keydown` handler closes whichever of the list menu / priority menu is open first (in
  that order, matching the panel's visual left-to-right order), otherwise closes the panel; either
  way `event.stopPropagation()` so `index.ts`'s document-level Escape does not also run.
- `refs.composeReminderDate` gets a `change` listener writing `state.composeReminderDate` (empty
  string ⇒ `null`) and calling `renderTemplateHints(true)`.
- The compose list menu and compose priority menu must both also be closed by the existing document
  `click` handler.

### `src/renderer/composeFeedback.ts` (new)

Leaf module importing only `dom.js`. Exports:

- `announceComposeSuccess(text: string)` — writes `Added “<text>”.` into `refs.composeStatus` and
  clears `refs.composeError`. Re-announcing an identical string must still fire: append a
  zero-width space or clear-then-set on the next frame so a repeated add is not swallowed
  (`querySearch.ts:103` deliberately does the opposite for its own debounced case — do not copy
  that guard here).
- `showComposeError(message: string)` — writes the message into `refs.composeError`, un-hides it,
  clears `refs.composeStatus`.
- `clearComposeFeedback()` — clears and hides both. Called from the `#message-input` `input`
  listener so a stale error disappears as soon as the user starts fixing it.

Copy (sentence case, names the action and the recovery):

| Case | Message |
|---|---|
| Blank submit | `Enter a task before adding.` |
| Save failure | `Couldn’t add the task. Your draft is kept — try Add again.` |
| Success (AT-only) | `Added “<task text>”.` |

### `src/renderer/actions.ts`

Rework `addTask()` only:

1. Compute `stripped`/`text` **before** creating any tags. If `!text`: call
   `showComposeError('Enter a task before adding.')`, `refs.input?.focus()`, and return. Create no
   tags and do not call `renderTags()`.
2. Then run the existing tag-creation loop (`tokenNames` + `missingTemplateTagNames`).
3. Change the `listId` computation to the three-tier precedence from Proposed Solution §2:
   `state.composeListId` (when not `undefined`) beats `resolved.listId` beats
   `state.selectedListId`.
4. Build the seed as `{ ...templateSeed(template), ...composeSeed() }`, dropping the object
   entirely if it has no keys (preserve the current `undefined` when nothing is seeded).
5. On the `{ error }` branch **and** in the `catch`: `showComposeError(...)`, `refs.input?.focus()`,
   return; do not clear the input, `state.pendingTagIds`, or the compose options. Keep the existing
   `console.error` in the catch.
6. On success: existing work, plus `resetComposeOptions()` before `renderTemplateHints(true)`, plus
   `announceComposeSuccess(text)`.

`resolveTemplateNames` and the missing-tag creation behaviour are unchanged; the destination-list
rule gains the one new tier described above.

### `src/renderer/activeSmartList.ts`

Change `renderTemplateHints()` only:

- Extend the memo key to
  `${state.searchMode}|${searching ? query : ''}|${state.selectedListId}|${state.composePriority}|${state.composeReminderDate}|${state.composeListId}`.
- Replace the early "hide when no template and not searching" return with: hide only when there is
  no template, no search, **and** no compose metadata at all (priority, reminder, or list).
- **Destination chip:** unchanged when a search/template is running. When nothing is running but
  `state.composeListId !== undefined`, render a destination chip too — resolve its label the same
  way the existing running-search branch already does (`state.lists.find(...).name`, or `'No list'`
  when `composeListId === null`) — because the picker no longer names the true destination. When
  nothing is running and `composeListId` is `undefined`, render no destination chip, as today (the
  picker still names it correctly).
- Priority chip: render `state.composePriority` when set, otherwise `template.priority`; never
  both. Keep the existing `el.dataset.priority = ...` so the chip keeps its priority tint (a
  non-colour cue is still present because the chip also carries the word).
- Reminder chip: render `Reminder ${formatDate(state.composeReminderDate)}` when the compose value
  is set; otherwise the existing `Due ${resolveDue(template.due)}` chip, unchanged.
- `formatDate` must be imported from `./helpers.js` (this module does not import it today).

### `src/renderer/index.ts`

- Call `setupComposeOptions()` in init, next to the existing `attachDatePicker(...)` calls.
- Add `clearComposeFeedback()` to the `#message-input` `input` listener path (add a listener; do not
  fold it into `tagInput.ts`'s).
- Extend the document `click` handler (`index.ts:1479-1512`) to hide `refs.composeListMenu` and
  `refs.composePriorityMenu`, alongside the existing `refs.priorityMenu`/`refs.reminderMenu`/
  `refs.modalListMenu` lines.
- Do **not** add a shortcut for the disclosure (see Non-goals).
- No change to the existing `refs.addButton` click / `keypress` Enter wiring.

### `styles.css`

New rules, appended in the compose-row region (after `.add-task-input-wrap`, before the narrow-window
section), all spacing via `--space-*`:

- `.compose-options` — flex row, `align-items: center`, `gap: var(--space-8)`.
- `.compose-options-toggle[data-active='true']` — `--surface-selected` background and
  `color: var(--text-body)`. The non-colour cue for "options are set" is the chip row below, which
  is always rendered when any option is set.
- `.compose-options-panel` — `display: flex`, `gap: var(--space-16)`, `flex-wrap: wrap`,
  `padding: var(--space-8) var(--space-0)`.
- `.compose-options-panel[hidden] { display: none; }` — **load-bearing**: without it the flex
  display beats `[hidden]` and the collapsed panel stays focusable.
- `.compose-option-label` — `font-size: var(--font-xs)`, `color: var(--text-hint)`.
- `.compose-error` — `color: var(--danger)`, `font-size: var(--font-xs)`, `margin: 0`;
  `.compose-error:empty { display: none; }`.
- `@media (max-width: 480px)` — compose-row selectors only: `#add-button` to 44×44,
  `.compose-options-toggle`/`.priority-picker`/`.reminder-picker` inside `.compose-options-panel`
  (the last one is `#compose-list-picker`'s trigger class) and `.compose-options-panel
  .date-picker-trigger` to `min-height: 44px`, `.compose-options-panel` to a single column,
  `#add-task-template` wraps. Add a comment stating the block is deliberately scoped to Quick Add
  and that whole-app narrow layout is P5.4's. No new CSS class is needed for the list picker itself
  — it reuses `.modal-list-select-wrap`/`.modal-list-menu`/`.modal-list-item` verbatim.

Dark mode needs no new rules: every value above is a token that already has a dark counterpart in
`styles/themes.css`.

### `scripts/lib/isolated-electron.mjs` (new)

Extract, unchanged in behaviour, from `scripts/test-isolation-selftest.mjs`:
`normalUserDataDir()`, the protected-path list, `snapshotFile`, `assertProtectedFilesUnchanged`,
`cleanEnvironment()`, python-bin resolution, temp-root creation/cleanup, and
`isolatedEnvironment()`. Export them so two scripts can share one definition of "safe launch".

### `scripts/test-isolation-selftest.mjs`

Import the helpers instead of defining them. **No behavioural change**: the fail-closed
configuration matrix, the isolated add/settings assertions, the SQLite verification, and the
byte-for-byte protected-file comparison all stay, and the run must still report the same number of
checks it does today.

### `scripts/quick-add-selftest.mjs` (new)

The Quick Add acceptance suite. Same shape and safety posture as the isolation self-test: launches
Electron through `playwright-core`'s `_electron` with the full `ADEO_UI_TEST` environment from the
shared helper, and re-asserts protected files unchanged in its `finally`.

### `package.json`

Add `"test:quick-add": "npm run build && node scripts/quick-add-selftest.mjs"`.

### Documentation

Add a short "Quick Add options" paragraph to the root `CLAUDE.md` architecture notes, in the style
of the existing sections: why the disclosure is static markup, why compose values beat the
smart-list template, why the hints row is the only metadata summary, and the Escape/Enter
precedence list. Update the "There is no general test suite" command list to include
`npm run test:quick-add`.

## Implementation Steps

1. **Markup.** Add the `.compose-options` block, `#compose-options-panel` (task list, then
   priority, then reminder), `#compose-error` and `#compose-status` to `index.html` inside
   `.compose-block`, after `.input-row`.
2. **Refs.** Add the twelve new entries to `src/renderer/dom.ts`.
3. **State.** Add `composeListId`, `composePriority` and `composeReminderDate` to `UIState` and the
   `state` literal in `src/renderer/state.ts`, with a comment distinguishing them from `modal*` and
   documenting `composeListId`'s `undefined`-vs-`null` sentinel.
4. **CSS.** Add the `.compose-options*`, `.compose-option-label`, `.compose-error` rules and the
   `@media (max-width: 480px)` block to `styles.css`. Verify `[hidden]` actually hides the panel.
5. **`composeFeedback.ts`.** Implement the three exports and the copy table.
6. **`composeOptions.ts`.** Implement the disclosure, the list picker/menu (mirroring
   `index.ts:885-901`, including the `undefined`-vs-`null` label handling from Proposed Solution
   §9), the priority picker/menu (mirroring `index.ts:905-920`),
   `attachDatePicker(refs.composeReminderDate, { accessibleName: 'Reminder' })`, the Escape
   layering across all three surfaces, `composeSeed`, `resetComposeOptions`, `hasComposeOptions`.
7. **Hints row.** Update `renderTemplateHints()` in `activeSmartList.ts`: memo key (now including
   `composeListId`), the hide condition, the compose-wins priority/reminder/list chips, and the
   destination-chip rule from Proposed Solution §3 (shown whenever `composeListId !== undefined`,
   not just while searching). Import `formatDate`.
8. **`addTask()`.** Reorder the blank check ahead of tag creation; apply the three-tier `listId`
   precedence from Proposed Solution §2; merge `composeSeed()` over `templateSeed(template)`; add
   the feedback calls on all three outcomes; add `resetComposeOptions()` to the success path; add
   `refs.input?.focus()` to the blank and failure paths.
9. **Wiring.** In `index.ts`: call `setupComposeOptions()` in init; add the `#message-input`
   `input` listener calling `clearComposeFeedback()`; add `refs.composeListMenu` and
   `refs.composePriorityMenu` to the document `click` closer.
10. **Test plumbing.** Extract `scripts/lib/isolated-electron.mjs`, repoint
    `scripts/test-isolation-selftest.mjs` at it, confirm `npm run test:isolation` still passes with
    the same check count.
11. **Quick Add suite.** Write `scripts/quick-add-selftest.mjs` covering the scenarios in Tests;
    add the npm script.
12. **Docs.** Update root `CLAUDE.md`.
13. **Verify.** Run `npm run build`, `npm run check:ux-boundary`, `node scripts/query-selftest.mjs`,
    `node scripts/shortcuts-selftest.mjs`, `npm run test:isolation`, `npm run test:quick-add`,
    `npm run storybook:build`.

## Edge Cases

| Case | Expected behavior |
|---|---|
| Submit with only `#tag` text and no task words | No task **and no tag** created; `Enter a task before adding.`; focus stays in `#message-input`. This is a deliberate change from today, where the tag was created silently. |
| Submit blank by **clicking Add** | Same message, and focus is explicitly moved back to `#message-input` (today it stays on the button). |
| Enter pressed while the tag suggestion menu is open | Selects the suggestion; does not submit. Unchanged. |
| Escape with both the Options panel and the priority menu open | Closes the priority menu only; focus to `#compose-priority-picker`. A second Escape closes the panel; focus to `#compose-options-toggle`. |
| Escape with the Options panel open and focus in `#message-input` | The panel's handler is on the panel, so this Escape falls through to existing app behaviour (clear search / close overlay). The panel stays open. Document this; do not add a document-level handler for it. |
| Escape with the reminder date popover open | `datepicker.ts` closes the popover and restores focus to its trigger. The Options panel stays open. Already correct; assert it. |
| Running smart list sets `priority:high` and the user picks Low in Options | Low is applied; the hints row shows exactly one priority chip, reading `Low`. |
| Running smart list sets `due:today` and the user picks a date in Options | The Options date is applied; one reminder chip, showing the Options date via `formatDate`. |
| Running smart list names `list:Work` and the user picks Personal in Options | Personal is applied (compose beats template beats sidebar); exactly one destination chip, reading `Personal`. |
| No search running, viewing the Work list, user picks Personal in the Options list picker | The task is created under Personal, not Work; a destination chip reading `Personal` appears in the hints row even though no search is running, because the view picker alone no longer names the true destination. |
| No search running, user opens Options and explicitly picks `No list` | `composeListId` becomes `null` (not `undefined`); the task is created unfiled regardless of the current view; destination chip reads `No list`. |
| Options opened, list picker never touched | `composeListId` stays `undefined`; trigger label reads `Current list`; no destination chip; task lands exactly where it would have without Options (sidebar/template rule, unchanged). |
| Options list picker opened while a list is deleted elsewhere (e.g. another window) mid-session | `renderListOptions` already handles a stale `selectedId` — falls back to its first entry (`No list`) — the same as the modal today; no special handling needed. |
| Smart list sets `repeat:weekly` and the user sets an Options reminder date | `templateSeed` derives `repeatStart` from *its own* `reminderDate`/today before the merge. After merging, `repeatStart` may disagree with the applied `reminderDate`. Recompute `repeatStart` from the effective reminder date when both a template repeat and a compose reminder date are present. |
| Options set, then the user switches list or runs a search | Options survive — they belong to the draft, not the view. The hints row repaints because its memo key includes them. |
| Options set, task added successfully | Options reset to `none`/`null`, panel collapses, chips disappear. |
| Options set, add fails | Options, pending tags and input text all preserved; a second Add retries. `POST /tags` is idempotent by name (`server/app.py:604-619` returns the existing row), so re-created tags do not duplicate. |
| Reminder date set but no time | `reminderTime` stays `null`. `GET /reminders/due` handles date-only rows as it does today; the compose row does not offer a time (see Open Question 1). |
| Very long task text with Options open | Panel and chips wrap; no horizontal page overflow at any required width. |
| `showCompleted` off and a smart list seeds `done:true` | Unchanged: the existing `Done` chip already warns, and the task vanishes on creation. The success announcement still fires, which is correct — the outcome is not visible. |
| Tag colours off (`settings.tagColors === false`) | Unchanged; the compose row adds no tag chips of its own. |

## Error Handling

Two new user-facing error conditions, both in `addTask()`:

1. **Blank text** — a client-side guard that already exists; it gains a message and a focus return.
   Never reaches IPC.
2. **Recoverable save failure** — either `window.electronAPI.addTask` resolves to
   `{ error: string }` (the main process's `apiRequest` converts any non-2xx into this,
   `src/main.ts:439-448`) or it throws (transport failure after main has already retried once,
   `src/main.ts:431-437`). Both are treated identically: keep the whole draft, show
   `Couldn’t add the task. Your draft is kept — try Add again.`, return focus to the field, keep
   the existing `console.error` for the thrown case. The server's own message is **not** surfaced;
   it is a FastAPI/HTTP detail and `ui-ux/ux/content.md` forbids exposing implementation terms.

No new error handling is required in `src/main.ts`, `src/preload.ts` or `server/app.py`.

Partial failure inside the tag-creation loop keeps its current behaviour (log and continue), so a
tag that cannot be created simply does not get attached.

## Tests

All automated UI runs use the shared isolated environment. Nothing may run against the development
database or Electron user-data directory.

### `scripts/quick-add-selftest.mjs` (new)

| # | Scenario | Assertions |
|---|---|---|
| 1 | **Success via Enter** | A uniquely named task appears in `.tasks-list`; `#message-input` is empty; `document.activeElement` is `#message-input`; `#compose-status` contains the task text; `#compose-error` is empty. |
| 2 | **Success via Add button** | Same outcome, including focus back on `#message-input`. |
| 3 | **Blank submit via Enter** | Task count unchanged; `#compose-error` reads `Enter a task before adding.`; `#message-input` still focused. |
| 4 | **Blank submit via Add click** | Same, and focus is on `#message-input`, not `#add-button`. |
| 5 | **Tag-only submit creates nothing** | Type `#zzz-unique` and submit: task count unchanged, and the tag is absent from the sidebar and from `GET /tags` (checked in the isolated SQLite file after close). |
| 6 | **Error clears on typing** | After scenario 3, typing one character empties `#compose-error`. |
| 7 | **Options apply priority** | Open Options, choose High, add a task; after close, the isolated database row for that task has `priority = 'high'`. |
| 8 | **Options apply reminder date** | Open Options, open the date popover, click **Today**, add a task; the row's `reminder_date` equals today's ISO date. |
| 8a | **Options apply an explicit list, overriding the current view** | While viewing the Work list, open Options, pick the Personal list, add a task; after close, the isolated database row's `listId` matches Personal's id, not Work's. |
| 8b | **Options apply an explicit "No list"** | While viewing the Work list, open Options, pick `No list`, add a task; the row's `listId` is `null`. |
| 8c | **List picker default label** | Before any selection, `#compose-list-value` reads `Current list`, not `No list` or the current view's name. |
| 9 | **Options reset after success** | After 7/8/8a, `#compose-list-value` reads `Current list`, `#compose-priority-value` reads `None`, the panel is `hidden`, `#compose-options-toggle` has `aria-expanded="false"`, and `#add-task-template` shows no priority/reminder/destination chip. |
| 10 | **Chips reflect Options with no search running** | With a priority chosen, no search, and the list picker untouched, `#add-task-template` is visible, contains the priority chip, and contains **no** destination-list chip. With the list picker set to a different list (or explicitly `No list`), the same row **does** contain a destination chip naming it, per test 8a/8b. |
| 11 | **Compose value beats the smart-list template** | Enter Query mode with `priority:low`, set Options priority to High, add a task; the stored `priority` is `high` and exactly one priority chip is shown. |
| 11a | **Compose list beats the smart-list template's list** | Enter Query mode with `list:Work`, set Options list to Personal, add a task; the stored `listId` matches Personal's id, and exactly one destination chip is shown, reading `Personal`. |
| 12 | **Tag suggestion keyboard** | Type `#`, ArrowDown moves `aria-activedescendant`, Enter inserts the chip and does not create a task, Escape closes the menu with focus still in the input. Regression cover for `tagInput.ts`. |
| 13 | **Escape layering** | With Options open and the priority menu open, Escape closes the menu only (`activeElement === #compose-priority-picker`); a second Escape closes the panel (`activeElement === #compose-options-toggle`, `aria-expanded="false"`). |
| 14 | **Escape does not leave the app in a broken state** | With Options open and focus in `#message-input`, Escape performs the existing search-clear behaviour and no overlay opens. |
| 15 | **Recoverable failure** | Make the isolated database directory read-only, submit a draft with text + a pending tag + a chosen priority; assert `#compose-error` names the failure, `#message-input` still holds the text, the pending tag chip is still in `#add-task-tags`, `#compose-priority-value` still reads the chosen priority, and focus is on `#message-input`. Restore permissions and re-submit; the task is created. **If the read-only technique proves unreliable on the implementer's platform, fall back to asserting the same outcome by pointing `ADEO_DB_PATH` at a path whose parent directory is removed after startup, and record the substitution in the implementation review.** |
| 16 | **Responsive** | At 1440×900, 1024×768 and 768×1024 (window resized through `electronApp.evaluate` on the `BrowserWindow`): `document.documentElement.scrollWidth <= clientWidth`, and the input row, Add button and Options toggle are all visible. See "Open Questions" for the 390px
verification approach. |
| 17 | **Touch targets** | At the narrow viewport, `#add-button`, `#compose-options-toggle` and the panel controls each report a bounding box of at least 44×44 (Add) / 44 high (the rest). |
| 18 | **Light and dark** | With `page.emulateMedia({ colorScheme: null })` and `updateTheme('light')` then `updateTheme('dark')`: `#compose-error` and `#compose-options-toggle[data-active='true']` both have a computed colour differing from their background, and the panel renders in both. |

### Regression coverage

- `npm run test:isolation` must still pass with the same check count and the same protected-file
  guarantee after the helper extraction.
- `node scripts/query-selftest.mjs` must still pass — `deriveTemplate`/`templateSeed` semantics are
  unchanged; only the merge on top of them is new.
- `node scripts/shortcuts-selftest.mjs` must still pass — no registry change is made.
- `npm run storybook:build` and `npm run check:ux-boundary` must still pass; no production module
  may import from `ui-ux/`.

### Manual evidence to attach to the P2.4 implementation review

- Screenshots of the compose row collapsed and expanded, light and dark.
- Keyboard walkthrough: Tab from `#message-input` → `#add-button` → `#compose-options-toggle`, and
  the full Escape ladder.
- A screen-reader pass confirming the success announcement and the blank/failure alert (axe on the
  Electron app is P4.4 and is not available yet).

## Acceptance Criteria

1. Typing a task and pressing Enter, or clicking Add, still creates the task with no extra step,
   clears the draft, and leaves focus in `#message-input`.
2. `#compose-options-toggle` is visible, reads `Options`, and carries `aria-expanded` synchronized
   with `#compose-options-panel[hidden]`.
3. Opening Options exposes, in order, a task-list control, a priority control, and a
   reminder-date control for the current draft; chosen values appear as chips in
   `#add-task-template` and no second summary exists.
4. A task added with Options set is persisted with the chosen `listId`/`priority`/`reminder_date`
   in the isolated SQLite database.
5. An explicit Options value overrides the value the running smart list's template would have
   seeded, for list, priority, and reminder date alike, and the hints row shows one chip per field.
6. Picking a list in Options that differs from the current view still shows a destination chip in
   the hints row, even when no search is running — the view picker no longer names the true
   destination once it has been overridden, so the hints row must.
7. The list picker's default (untouched) state reads `Current list`, is visually and behaviourally
   distinct from having explicitly picked `No list`, and both round-trip correctly through
   `resetComposeOptions()`.
8. Blank submit adds nothing (no task and no tags), shows `Enter a task before adding.`, and leaves
   focus in `#message-input` from both Enter and the Add button.
9. A recoverable save failure preserves the input text, the pending tag chips and the chosen
   Options, shows the failure/retry message, returns focus to `#message-input`, and a retry after
   the fault is cleared succeeds.
10. Escape closes exactly one surface per press, in the documented order, restoring focus to that
    surface's trigger each time.
11. Enter never submits while the tag suggestion menu is open.
12. No horizontal page overflow at the verified viewports; the compose row's primary controls meet
    44px at the narrow viewport.
13. Light and dark both render the new surfaces from production tokens, with a non-colour cue for
    "options are set" (the chips row) and for the error (the message text).
14. `npm run build`, `npm run check:ux-boundary`, `node scripts/query-selftest.mjs`,
    `node scripts/shortcuts-selftest.mjs`, `npm run test:isolation`, `npm run test:quick-add` and
    `npm run storybook:build` all pass.
15. No file under `server/`, `src/main.ts`, `src/preload.ts`, or `ui-ux/` is modified.

## Non-goals

Explicitly out of scope; do not change:

- **Command syntax** of any kind in the add field (decision 0001 rejects alternative B).
- **The touch-first layout as the default** (alternative C rejected).
- **New metadata types or backend schema.** No column, endpoint, Pydantic model or `TaskSeed` field
  is added. `reminderTime`, `repeatRule`/`repeatStart` and `details` stay edit-dialog-only.
- **Reminder delivery.** `GET /reminders/due`, the 30s poll, the dedupe map and the native
  notification path are untouched.
- **Navigation, sidebar, view bar, search, smart lists.** `viewBar.ts`, `querySearch.ts`,
  `smartLists.ts`, `pillDnD.ts` are not modified. `deriveTemplate`/`parseQuery` semantics are not
  changed.
- **The edit dialog.** `#priority-picker`, `#reminder-picker`, `#repeat-picker`,
  `updatePriorityUI`/`updateReminderUI` and the `modal*` state fields keep their current
  single-owner relationship with the edit modal. The compose controls are separate elements.
- **The shortcut registry.** No new shortcut id, no rebinding-UI change, no menu-accelerator
  change. The disclosure is reached by Tab.
- **App-wide responsive layout.** The new media query is scoped to compose-row selectors; the
  sidebar, dialogs and `src/main.ts`'s `minWidth: 600` are P5.4's.
- **`ui-ux/` concept code.** Nothing from `quick-add-pilot.stories.ts` or `app-shell-preview.ts` —
  no fixture models, no `ConceptModel`, no `createCompactComposer` DOM building, no simulated
  failure control, no `.quick-add-*` classes — is copied into production.
- **The `#add-task-template` warning line and the existing `Due …` template chip wording.** The
  `Due` vs `Reminder` vocabulary mismatch there is pre-existing; fixing it is not part of this task.
- **Storybook stories.** No production compose-row story is added (that would require extracting
  the compose row into a factory, which no approved decision covers).

## Decision Log

### `2026-08-26 — Quick Add Options disclosure plan approved`

- Source: `HUMAN DECISION`
- Decision: Approve this plan as written — Options field order (task list, priority, reminder), the
  `composeListId` tri-state, the compose-beats-template-beats-sidebar precedence, the
  destination-chip rule in `renderTemplateHints`, the feedback/error copy, the Escape/Enter
  ordering, and the responsive verification approach.
- Reason: Antonio Ingegnere approved after a full walkthrough of the gap analysis; no changes were
  requested. Recorded verbatim in `## Implementation Status` below.
- Supersedes: `None`

### `2026-08-29 — Legacy plan migrated into the named-plan lifecycle`

- Source: `CODE EVIDENCE`
- Decision: Preserve this plan as the named plan `quick-add-options-disclosure` at revision 1 with
  lifecycle status `APPROVED`, rather than overwriting it when `current.md` became a pointer.
- Reason: `.claude/plans/current.md` held this full plan when
  `/implementation-plan start spec=spec/ui/quick-add-inline-metadata-value-row.md` ran. The
  Architect's migration rule requires the legacy plan to be preserved, not discarded, and lifecycle
  status may only change through an explicit lifecycle action.
- Supersedes: `None`

## Revision Log

### `r001 — 2026-08-29 — migrated`

- Summary: Legacy full plan from `.claude/plans/current.md` preserved verbatim as the named plan
  `quick-add-options-disclosure`, with Plan Metadata, a Migration Note, a Decision Log and this
  Revision Log added. No original content removed or edited.
- Trigger: `/implementation-plan start spec=spec/ui/quick-add-inline-metadata-value-row.md`, which
  required `current.md` to be converted to pointer mode.

## Open Questions

None.

Both prior open questions are resolved:

- **Metadata scope.** The Options panel exposes, in order, **Task list**, **Priority**, and
  **Reminder** (date only). The user's answer added the task list to what this plan originally
  proposed (Priority + Reminder alone); Proposed Solution §§1, 2, 3, 9 and every "Files to Modify"
  entry above reflect the three-field version. Still explicitly excluded: reminder *time*, repeat,
  and details — none of those were asked for and each is a materially larger change (time reuses
  `#reminder-time`'s `normalizeTimeInput` but doubles the panel; repeat pulls in the whole
  custom-RRULE builder).
- **390px.** Author the compose-row narrow CSS now and verify it in the automated suite by
  temporarily relaxing the window minimum *from the test*, e.g.
  `electronApp.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setMinimumSize(320, 400); w.setSize(390, 844); })`.
  That touches no production code and keeps the shipped floor at 600 (`src/main.ts:809`). If the
  window cannot actually be driven to 390 on the implementer's platform, verify at the 600px floor
  instead and record 390px as an explicit P5.4 gap in the implementation review. See Tests #16/#17
  and Proposed Solution §8.

## Implementation Status

`APPROVED`

Approved by Antonio Ingegnere on 2026-08-26 after a full walkthrough of the gap analysis, the
Options field order, the task-list tri-state design, the list/priority/reminder precedence rule,
the destination-chip fix in `renderTemplateHints`, feedback/error handling, Escape/Enter ordering,
and the responsive verification approach. No changes requested.
