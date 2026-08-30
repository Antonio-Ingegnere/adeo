# Implementation Plan

## Plan Metadata

- Plan ID: `quick-add-inline-metadata-value-row`
- Revision: `2`
- Lifecycle Status: `DRAFT`
- Source Specification: `spec/ui/quick-add-inline-metadata-value-row.md`
- Created: `2026-08-29`
- Updated: `2026-08-29`

## Goal

Turn the shipped Quick Add **Options disclosure** into the selected `A · Value row` inline
metadata layout: Task list, Priority and Reminder in one compact, label-free row directly under
the input row, each control self-describing through a leading glyph, its current value and a
caret, with `<field>: <value>` as its accessible name.

**The row is revealed by composer activity rather than being permanently visible** (2026-08-29
human decision). It appears while the compose block is being used — focus inside it, a non-empty
draft, or an open metadata surface — and collapses back to defaults otherwise. This is a
deliberate, recorded deviation from the source specification, which describes the row as
permanent; see the Decision Log and Open Question 1.

The Task list field, while the user has not overridden it, **names the destination the task would
actually reach** — the list in view, or the one a running smart list's `list:` term resolves to —
rather than the generic `Current list`.

This is a presentation and discoverability change on top of work that already ships. The data path
built by the `quick-add-options-disclosure` plan — `state.composeListId` (tri-state),
`state.composePriority`, `state.composeReminderDate`, `composeSeed()`, the
compose-beats-template-beats-sidebar destination rule in `addTask()`, `#compose-status` /
`#compose-error` — is correct against this specification and is **reused unchanged**. What changes
is the surface: no toggle, no stacked labels, content-sized triggers that truncate, a `role="group"`
wrapper, an activity-driven visibility lifecycle, and a Task list trigger that reports the resolved
destination instead of a placeholder.

The tri-state remains essential and is *not* collapsed by the new label behaviour: `undefined`
still means "untouched, inherit the precedence chain" even though the trigger now displays the
name that chain currently resolves to. Displaying the resolution must never write it into
`state.composeListId`, or changing view would leave a stale explicit override behind.

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

From `spec/ui/quick-add-inline-metadata-value-row.md`, as amended by the 2026-08-29 human
decisions recorded below. Items 1, 6, 8 and 12-15 deviate from the specification; every other item
is the specification unchanged.

1. The composer is two rows: the task input plus the icon-only Add button, then a **wrapping
   metadata row** holding Task list, Priority and Reminder in that order, shown while the composer
   is active (item 12) rather than permanently.
2. That row is a `role="group"` named `Details for the next task` and carries **no visible group
   label and no per-field visible labels**.
3. Task list and Priority are buttons built from a leading glyph/swatch, the current value and a
   caret; each exposes `<field>: <value>` as its accessible name and controls its menu.
4. Reminder uses the production date picker; its trigger shows the formatted value or
   `Select date`, exposes `Reminder: <value>`, and places its calendar glyph **before** the value
   so all three fields lead with a glyph.
5. Each trigger is content-sized up to a fixed maximum and truncates an over-long value with an
   ellipsis; the row wraps when the three no longer fit on one line.
6. An un-overridden Priority reads `None` and an un-overridden Reminder reads `Select date`; an
   un-overridden **Task list names the resolved destination** (item 13) instead of `Current list`.
   The Value row gives the unset state **no separate visual treatment** — the value word is the
   only signal. Set state is still exposed on the field wrapper and trigger as data.
7. Tab order: Task, Add task, Task list, Priority, Reminder.
8. Escape closes one open menu or date popover and restores its trigger; with nothing open it
   **collapses the row** (item 14). The draft text is never affected by Escape.
9. Clicking outside the composer closes any open metadata surface without changing values.
10. Every trigger is at least 44px tall at viewport widths up to 480px.
11. New-task defaults stay: current view's list if one is selected, otherwise no list; priority
    empty; reminder empty (OQ-011).
12. **Visibility follows composer activity.** The row is shown when any of these holds, and hidden
    when none does: focus is inside the compose block (the input, the Add button, or any of the
    three fields); the draft is non-empty regardless of where focus is; or a compose metadata
    surface is open (list menu, priority menu, or the date popover).
13. **The Task list trigger names the real destination while un-overridden.** It shows the name
    that `state.composeListId ?? template.listId ?? state.selectedListId` resolves to — the list
    selected in the sidebar, or the list a running smart list's `list:` term names — and `No list`
    when that resolves to unfiled. It tracks view and query changes live.
14. **Collapsing restores defaults.** Whenever the row goes from shown to hidden — by the activity
    rule or by Escape — Task list, Priority and Reminder return to their defaults, so a hidden row
    can never leave metadata silently armed for the next task.
15. Collapsing never alters the draft text, the pending tags, or `#compose-error`.

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
- **The date popover is not inside the compose block.** `datepicker.ts:120` appends it to
  `options.popoverParent ?? document.body`, and no compose caller passes `popoverParent`. A naive
  `:focus-within` or `focusout` visibility rule would therefore collapse the row the instant focus
  entered the calendar, destroying the trigger the popover was positioned against. This is why the
  visibility predicate is written over *open surfaces* rather than DOM containment (Proposed
  Solution §1).
- **The priority menu rows are non-focusable `<div>`s** (`index.html:259-274`). Pressing the mouse
  on one blurs the trigger and moves `document.activeElement` to `<body>` *before* the click lands,
  so a focus-only visibility rule would hide the row mid-click and swallow the selection. The
  "a compose surface is open" term of the predicate covers this case too; it is not optional.
- `activeSmartList.ts` already exports `activeTemplate()` and `resolveTemplateNames()`, and
  `composeOptions.ts` already imports `renderTemplateHints` from it. The resolved destination can
  therefore be computed for the Task list trigger **with no new import edge and no cycle**, and the
  precedence currently inlined at `actions.ts:72-74` can be lifted into a single shared helper that
  both callers use.
- `renderTemplateHints`'s memo key (`activeSmartList.ts:203`) already includes `state.searchMode`,
  the trimmed query, `state.selectedListId` and all three compose values — i.e. exactly the inputs
  the resolved destination label depends on. Its existing call sites are therefore the correct
  repaint points for the Task list label as well.
- `.compose-meta-row` is `display: flex`, so a `[hidden]` attribute alone will not hide it: the
  `.compose-meta-row[hidden] { display: none }` rule is **load-bearing**, exactly as
  `.compose-options-panel[hidden]` was. Revision 1 claimed this hazard disappeared with the
  disclosure; the activity-driven reveal brings it back.

## Proposed Solution

### 1. The disclosure becomes an activity-revealed row

`#compose-options-toggle` and `#compose-options-panel` are replaced by a single
`#compose-meta-row` (`role="group"`, `aria-label="Details for the next task"`) whose visibility is
**derived from composer activity, never toggled by a control**. Removed with them:
`openComposeOptions`/`closeComposeOptions`/`isComposeOptionsOpen`, the `data-active` toggle cue and
`hasComposeOptions`'s only consumer.

The predicate lives in one function in `composeOptions.ts`:

```
shouldShowComposeMeta() =
  !state.composeMetaDismissed
  && ( focusWithinComposeBlock()      // activeElement inside .compose-block
     || draftNonEmpty()               // #message-input.value.trim() !== ''
     || anyComposeSurfaceOpen() )     // list menu | priority menu | isDatePickerOpen()
```

Three notes on why it is written this way rather than as CSS `:focus-within`:

- `anyComposeSurfaceOpen()` is what keeps the row alive while the date popover has focus, since
  that popover lives in `document.body` (Relevant Architecture), and what keeps it alive across the
  blur-to-`<body>` that pressing the mouse on a `<div>` priority row causes.
- `draftNonEmpty()` keeps the row up when the user types and then clicks away, which is the state
  where a metadata choice is most likely still wanted.
- It is a single derived predicate with one applier, so no code path can leave the row's visibility
  disagreeing with the state that produced it — the same reasoning that makes `activeSmartList()`
  derived rather than stored.

`syncComposeMetaRow()` applies it: sets/clears `hidden` on `#compose-meta-row`, and on a
**shown → hidden** transition calls `resetComposeOptions()` (Proposed Solution §4). It is invoked
from a `focusin`/`focusout` pair on `document`, from `#message-input`'s existing `input` listener,
from every place that opens or closes one of the three surfaces, and once at init.

**This supersedes an explicit requirement of approved UX decision 0001** ("Optional metadata is
exposed by a clearly named disclosure"; risk mitigation "Keep a visible, named disclosure") **and
deviates from the source specification**, which states the row is permanent. Both are recorded in
the Decision Log; the standing residue is that no approved UX record yet describes an
activity-revealed row, which is Open Question 1.

`.compose-options` survives as the feedback container: it keeps `#compose-error` and
`#compose-status`, loses the toggle, and is **always visible** — a save failure must not be able to
disappear because focus moved, and its `role="alert"`/`role="status"` regions must stay in the DOM
for announcements to fire.

### 1b. The Task list trigger names the resolved destination

While `state.composeListId === undefined`, the trigger no longer reads `Current list`. It reads the
name of the list the task would actually reach, computed by a new shared helper — placed in
`activeSmartList.ts`, which both `actions.ts` and `composeOptions.ts` already import:

```
resolveComposeDestination(): number | null   // the list id, or null for unfiled
  = state.composeListId
 ?? resolveTemplateNames(activeTemplate()).listId   // undefined when unresolvable
 ?? state.selectedListId
```

This is the precedence already inlined at `actions.ts:72-74`; lifting it makes the label and the
task provably agree instead of restating the rule twice. `actions.ts` then calls the helper rather
than repeating the expression.

The user's "there are cases when it's impossible" maps onto existing behaviour, and in every one of
them the destination is still knowable, so the trigger always has a truthful name to show:

| Case | `resolveTemplateNames` result | Trigger shows |
|---|---|---|
| A list is selected in the sidebar | no template, or template names no list | that list's name |
| `All lists` is selected | same | `No list` |
| Running smart list with `list:Work` | `listId` = Work's id | `Work` |
| Query names a deleted list | `missing` non-empty, `listId` `undefined` | the sidebar fallback; `#add-task-template` already shows the `⚠ not applied` warning |
| Query constrains `list:` under `OR`/`NOT`, or twice with different values | `deriveTemplate` puts it in `skipped`, no `listName` | the sidebar fallback |

`Current list` therefore disappears from the UI. That is a deviation from the specification's stated
unset label and it costs one distinction: an un-overridden field resolving to Work and an explicit
choice of Work now read identically. No *outcome* information is lost — both send the task to Work —
and `data-set` still separates them for tests and future layouts. Recorded as a decision; see Open
Question 2 if the placeholder should be preserved for the un-overridden case.

Repaint: `paintComposeListLabel()` must now run wherever the resolved destination can change —
view selection, search query changes, smart-list run/edit/delete, and list rename/delete. These are
exactly `renderTemplateHints`'s existing call sites (`querySearch.ts:215`, `actions.ts:110`,
`composeOptions.ts`, and the view-selection path implied by `selectedListId` being in its memo key);
the implementer must confirm each one and add the paint call beside it.

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

Each paint also writes `data-set` on both the field wrapper and the trigger: `list` set only when
`composeListId !== undefined` (an explicit override — *not* merely a resolved destination name),
`priority` set unless `none`, `reminder` set unless empty. Per the spec the Value
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

### 4. Escape, collapse-resets-to-default, Enter and outside click

Escape, one surface per press, each `stopPropagation()`-ing:

1. Tag suggestion menu → close, focus stays in `#message-input`. *(unchanged)*
2. Reminder date popover → `datepicker.ts` closes it and restores its trigger. *(unchanged)*
3. Compose list menu → close, focus to `#compose-list-picker`.
4. Compose priority menu → close, focus to `#compose-priority-picker`.
5. **Row shown, nothing open → collapse the row**: set `state.composeMetaDismissed = true`, run
   `syncComposeMetaRow()` (which hides and resets), and move focus to `#message-input` so the
   caret is not stranded on a hidden control. The draft text and pending tags are untouched.
6. Row already hidden → fall through to existing app behaviour (topmost overlay / clear search).

The keydown listener moves from `#compose-options-panel` to the **compose block**, because Escape
must now be catchable while focus is in `#message-input`, not only while it is inside the row.
Layer 1 (tag suggestions) continues to run before this handler and keeps its precedence.

`state.composeMetaDismissed` is a new transient boolean in `UIState` — it is not persisted and not
part of `Settings`. Without it, layer 5 could not work at all: the draft is typically non-empty
when the user presses Escape, so the activity predicate would immediately re-show the row it just
collapsed. It is cleared whenever focus **enters** the compose block from outside (a `focusin`
whose `relatedTarget` is outside the block), which is what lets the user bring the row back after
dismissing it. Whether typing should also clear it is Open Question 3.

**Collapse resets to defaults.** Every shown → hidden transition, whichever rule caused it, runs
`resetComposeOptions()`: `composePriority = 'none'`, `composeReminderDate = null`,
`composeListId = undefined`, all three repainted, and `renderTemplateHints(true)`. This makes
"hidden" and "at defaults" the same state, which is the invariant the 2026-08-29 decision asks for
and the reason a hidden row can never silently arm the next task. It does mean Escape discards
metadata selections, which is new for Escape in this app — see Open Question 4.

Enter is unchanged: the tag suggestion menu owns it while open, `#message-input` submits, and a
control inside the row activates itself and never submits.

Outside click is unchanged — `index.ts:1509-1516` already hides both compose menus and resets their
`aria-expanded`. It runs before the resulting `syncComposeMetaRow()`, so closing a menu by clicking
away collapses the row in the same gesture when nothing else keeps it active.

### 5. Success announcement names the destination

The spec's announcement is `Added “<title>” to <list>.`; `composeFeedback.ts` currently writes
`Added “<text>”.`. `addTask()` already computes the effective `listId` before the call, so it can
pass the resolved label (`state.lists.find(...)?.name`, or `No list` when the destination is
`null`) to `announceComposeSuccess(text, listLabel)` — reading it from
`resolveComposeDestination()`, so the announcement, the Task list trigger and the stored `list_id`
are all the same computation. The announcement is the AT-side equivalent of what the row shows, and
it matters more now that the row can be hidden at the moment of submission.

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

### 6b. Layout shift is accepted

Showing and hiding the row moves everything below it — the tag row, the template hints and the task
list — by the row's height on every focus in and out of the composer. **No space is reserved**:
reserving it would forfeit the vertical saving the reveal is for, and the 2026-08-29 decision
explicitly accepts the jump as a first cut to be judged in use. No transition or animation is added
either; an animated collapse would need its own decision and would interact with the focus and
reset timing. Recorded so a later revision can revisit it rather than rediscover it.

### 7. Deliberately unchanged

`state.composeListId`'s tri-state, `composeSeed()`, the `addTask()` precedence and `repeatStart`
correction, `#compose-error`/`#compose-status`, blank-submit semantics, the tag-suggestion path,
and every backend/IPC contract.

## Files to Modify

### `index.html`

Replace lines 229-282 with the feedback container plus the metadata row:

- `.compose-options` keeps `#compose-error` and `#compose-status`; the toggle button is deleted.
- `<div id="compose-meta-row" class="compose-meta-row" role="group" aria-label="Details for the
  next task" hidden>` — **`hidden` in the markup**, because at load the composer is inactive and
  the draft empty; `syncComposeMetaRow()` at init is what agrees with that rather than contradicts
  it. Containing, in order:
  - `.compose-field.compose-field--list` > `.modal-list-select-wrap` semantics inlined on the field
    wrapper > `#compose-list-picker` (`.reminder-picker`, `aria-haspopup="menu"`,
    `aria-expanded="false"`, `aria-controls="compose-list-menu"`) holding
    `<span class="compose-field-icon" aria-hidden="true">` (inline list glyph SVG),
    `#compose-list-value` (`.compose-value`; its markup text is a placeholder that
    `paintComposeListLabel()` overwrites at init) and `.priority-caret`; then
    `#compose-list-menu` (`.modal-list-menu`, `role="menu"`, `aria-label="Task list"`).
  - `.compose-field.compose-field--priority` > `#compose-priority-picker` (`.priority-picker`,
    same ARIA) holding `#compose-priority-chip`, `#compose-priority-value` (`.compose-value`) and
    the caret; then `#compose-priority-menu` (`.priority-menu`, `role="menu"`,
    `aria-label="Priority"`) with its four `.priority-menu-item[data-value]` rows (their element
    type depends on Open Question 6).
  - `.compose-field.compose-field--reminder[data-menu-align="end"]` >
    `<input id="compose-reminder-date" type="date" class="reminder-picker compose-trigger"
    aria-label="Reminder" />`.
- Keep the existing comment explaining why this is static markup.

The three `.compose-option-label` elements, the `<label for>`, `#compose-options-toggle` and
`#compose-options-panel` are removed.

### `src/renderer/dom.ts`

Remove `composeOptionsToggle` and `composeOptionsPanel` (lines 127-128); add `composeMetaRow`,
`composeBlock` (the activity boundary the focus predicate tests against), `composeListField`,
`composePriorityField`, `composeReminderField` (the wrappers that carry `data-set`). The remaining
nine compose refs are unchanged.

### `src/renderer/state.ts`

Add `composeMetaDismissed: boolean` to `UIState`, initialised `false` beside the other `compose*`
fields (lines 80-89 / 135-137). Transient interaction state; never persisted.

### `src/renderer/composeOptions.ts`

- Delete `isComposeOptionsOpen`, `closeComposeOptions`, `openComposeOptions`, `paintToggleState`
  and the toggle listener. `hasComposeOptions` is deleted unless Open Question 5 keeps a consumer.
- Add `shouldShowComposeMeta()` and `syncComposeMetaRow()` (Proposed Solution §1), the
  `focusin`/`focusout` wiring, and the shown → hidden reset. Export `syncComposeMetaRow` so
  `index.ts` and `actions.ts` can drive it; the module stays a leaf (no import of `actions.ts`,
  `index.ts` or `tasks.ts`).
- `paintComposeListLabel` now resolves its text through `resolveComposeDestination()` instead of
  overriding with `Current list`, and writes the trigger's `aria-label` (`Task list: <value>`) plus
  `data-set` on `refs.composeListField` and `refs.composeListPicker`. Keep passing
  `refs.composeListValue` explicitly to `renderListOptions`, or the edit dialog's label is
  repainted instead (`lists.ts:89`'s `labelEl || refs.modalListLabel` fallback).
- `paintComposePriority` likewise writes `Priority: <value>` and `data-set`.
- A new `paintComposeReminder()` writes `data-set` on the reminder field/trigger after each change;
  the trigger's own `aria-label` and label text are already maintained by `datepicker.ts`'s
  `refreshTrigger`.
- The Escape handler moves to `refs.composeBlock`, drops its panel branch and gains the
  collapse-the-row layer (Proposed Solution §4).
- `resetComposeOptions()` keeps clearing all three fields; it no longer calls
  `closeComposeOptions`. It is now called from the shown → hidden transition as well as after a
  successful add.
- `attachDatePicker(refs.composeReminderDate, { accessibleName: 'Reminder' })` is unchanged; the
  popover deliberately keeps its default `document.body` parent (Proposed Solution §1).

### `src/renderer/activeSmartList.ts`

- Add the exported `resolveComposeDestination()` helper (Proposed Solution §1b).
- Only if Open Question 5 removes the compose-driven chips: the memo key, the `hasComposeMetadata`
  guard, the `composeListId` destination branch and the compose priority/reminder chips revert to
  their pre-`quick-add-options-disclosure` form. Otherwise unchanged.

### `src/renderer/composeFeedback.ts` and `src/renderer/actions.ts`

`announceComposeSuccess(text, listLabel)` writes `Added “<text>” to <listLabel>.`; `addTask()`
resolves that label from the `listId` it computes, and now computes it by calling
`resolveComposeDestination()` rather than repeating the precedence inline at lines 72-74.
`addTask()` also calls `syncComposeMetaRow()` after `resetComposeOptions()`, so the row's
visibility re-derives once the draft is empty.

### `src/renderer/index.ts`

`setupComposeOptions()` (line 1605) and the document-click menu closer (lines 1509-1516) keep
working. Two additions: the `#message-input` `input` listener (line 741) also calls
`syncComposeMetaRow()`, and the view-selection path calls `paintComposeListLabel()` beside its
existing `renderTemplateHints()` so the destination label follows the view. The two deleted refs
must be checked for stray references.

### `styles.css`

- Replace `.compose-options-panel*`, `.compose-option`, `.compose-option-label` and
  `.compose-options-toggle[data-active]` (2762-2790) with `.compose-meta-row`, `.compose-field`,
  `.compose-field-icon`, `.compose-value`, the trigger width/menu-geometry overrides and the
  reminder glyph reversal from Proposed Solution §3.
- `.compose-options` keeps its flex row for the feedback line; `.compose-error` is unchanged.
- Re-scope the `@media (max-width: 480px)` block per Proposed Solution §6.
- **Carry the `[hidden]` guard across**: `.compose-options-panel[hidden]` is deleted, but
  `.compose-meta-row[hidden] { display: none }` replaces it and is load-bearing for the same reason
  — `.compose-meta-row` sets `display: flex`, which beats the UA `[hidden]` rule. Keep the
  explanatory comment.
- Dark mode needs no new rules — every value is an existing token.

### `scripts/quick-add-selftest.mjs`

Rewrite the toggle-dependent scenarios (see Tests). The isolation posture, the protected-file guard
and the SQLite assertions are untouched.

### Documentation

Update the `Quick Add options` section of root `CLAUDE.md` to describe the Value row: why it is
static markup, why the disclosure was dropped, that visibility is a single derived predicate and
why that predicate is written over open surfaces rather than DOM containment (the `document.body`
popover and the `<div>` menu rows), the hidden ⟺ defaults invariant, the five-layer Escape ladder
and the `composeMetaDismissed` flag it needs, why the accessible name carries the field name now
that the visible label is gone, why the Task list trigger names the resolved destination without
writing it into `state.composeListId`, and why `#compose-reminder-date` carries the
`reminder-picker` class.

## Implementation Steps

Steps 1-5 are the layout; 6-8 are the reveal lifecycle and the destination label. Each step leaves
the app buildable and runnable.

1. **Markup.** Replace the toggle/panel with `#compose-meta-row` (initially `hidden`) and the three
   label-free fields; keep `#compose-error`/`#compose-status` in the slimmed `.compose-options`.
2. **Refs.** Drop the two removed refs; add `composeMetaRow`, `composeBlock` and the three field
   wrappers.
3. **CSS.** Add the row/field/trigger/menu rules, the `[hidden]` guard, the reminder glyph
   reversal; delete the panel rules; re-scope the 480px block.
4. **`composeOptions.ts` painting.** Delete the disclosure code; add `aria-label` and `data-set`
   painting to the three paint functions. At this step the row is permanently visible — that
   intermediate state is the r001 design and is worth eyeballing before the reveal goes on top.
5. **Announcement.** Extend `announceComposeSuccess` and its one caller.
6. **Destination label.** Add `resolveComposeDestination()` to `activeSmartList.ts`, switch
   `actions.ts:72-74` to it, repoint `paintComposeListLabel`, and add the paint call to the view,
   search and list-mutation paths. Verify by switching views and running a smart list with a
   `list:` term, including the deleted-list and `OR` cases.
7. **Reveal lifecycle.** Add `state.composeMetaDismissed`, `shouldShowComposeMeta()`,
   `syncComposeMetaRow()`, the `focusin`/`focusout` wiring, the input-listener call, and the
   shown → hidden reset. Verify the two hazards explicitly: focus into the date popover must not
   collapse the row, and clicking a `<div>` priority row must still select.
8. **Escape.** Move the handler to the compose block, add the collapse layer and the dismissed
   flag; confirm the tag-suggestion layer still wins and that a hidden row lets Escape fall through
   to clear-search.
9. **Menu semantics.** Apply Open Question 6's answer (either implement the concept's
   `menuitemradio` keyboard behaviour here, or leave the menus as they are and keep F-01/F-02
   filed).
10. **Hints row.** Apply Open Question 5's answer.
11. **Tests.** Update `scripts/quick-add-selftest.mjs`; add the new scenarios.
12. **Docs.** Update root `CLAUDE.md`.
13. **Verify.** `npm run build`, `npm run check:ux-boundary`, `node scripts/query-selftest.mjs`,
    `node scripts/shortcuts-selftest.mjs`, `npm run test:isolation`, `npm run test:quick-add`,
    `npm run storybook:build`.

## Edge Cases

| Case | Expected behavior |
|---|---|
| Long list name (`Quarterly planning and stakeholder review`) | The trigger stops at its 200px maximum and ellipsises; the full name stays in the accessible name and in `renderListOptions`' `title`. The row wraps rather than pushing the reminder past the column's right edge. |
| Narrow column (about 315px) with all three fields set | The row wraps to two lines; no horizontal page overflow; each trigger stays ≥44px tall under the 480px block. |
| Nothing set | Priority reads `None`, Reminder `Select date`, Task list the resolved destination, all with no distinguishing styling; `data-set="false"` is still exposed. |
| Reminder popover open, Escape pressed | `datepicker.ts` closes it and restores its trigger; the row stays shown because a surface was open and focus returns into it. |
| Reminder popover open, focus inside the calendar | The row stays shown. The popover is in `document.body`, so only the "surface open" term of the predicate keeps it alive — the regression this case exists to catch. |
| Mouse pressed on a `<div>` priority row | `activeElement` becomes `<body>` before the click lands; the open-surface term keeps the row shown and the selection completes. |
| List menu open, click outside the composer | `index.ts`'s document click handler closes it and resets `aria-expanded`; no value changes; the row then collapses if nothing else keeps it active, which resets the values. |
| Priority menu open, Tab pressed | Focus leaves; the menu must not trap. (If Open Question 6 adopts the concept semantics, Tab explicitly closes the menu without restoring focus.) |
| A list is renamed/deleted while the row is idle | The list menu is repainted on open (`paintComposeListLabel` in the picker's click handler), and `renderListOptions` already falls back to its first entry for a stale id. The destination label is repainted on the same list-mutation path. |
| `composeListId === undefined` | The trigger names the resolved destination (view's list, template's list, or `No list`); the task lands there. The state stays `undefined` — the label is display only. |
| Explicit `No list` chosen | `composeListId === null`; the task is unfiled regardless of the view. Unchanged. |
| View changed while the row is shown and un-overridden | The Task list trigger follows the new view. If the user had explicitly chosen a list, it does **not** follow — the explicit choice is the more specific intent, exactly as in `addTask()`. |
| Smart list names a list that was deleted | Trigger shows the sidebar fallback; `#add-task-template` shows its existing `⚠ not applied` warning. The two must agree. |
| Draft typed, then focus clicked away | Row stays shown (non-empty draft) with its values intact. |
| Draft cleared to empty while focus stays in the input | Row stays shown — focus is still inside the compose block. |
| Focus leaves with an empty draft | Row hides and all three values reset to defaults. |
| Escape with the row shown and nothing open | Row collapses, values reset, `composeMetaDismissed` set, focus moves to `#message-input`; draft and pending tags untouched; no overlay opens and no search is cleared. |
| Escape again, immediately | The row is hidden, so Escape falls through to the app's existing behaviour. |
| After dismissing, focus leaves and re-enters the composer | `composeMetaDismissed` clears and the row shows again at defaults. |
| Add succeeds | Draft cleared, focus back in `#message-input`, announcement names the task and its destination, values reset (the row stays shown because focus is still inside). |
| Add fails | Text, pending tags and all three metadata values are preserved; `#compose-error` names the failure and the retry. Unchanged. |
| Blank submit | No task and no tag; `Enter a task before adding.`; focus back in the field. Unchanged. |
| A running smart list sets `priority:high` and the row shows `Low` | `Low` wins (compose beats template, unchanged), and while the row is shown it displays the winning value directly. Note the reveal's consequence: collapse the row and the override is gone, so the template's `High` applies again. |

## Error Handling

No new error conditions. Both existing ones keep their behaviour and copy:

1. **Blank text** — client-side, never reaches IPC: `Enter a task before adding.` in
   `#compose-error`, focus returned to `#message-input`.
2. **Recoverable save failure** — `{ error }` or a thrown IPC error alike: whole draft preserved
   (text, pending tags, and every metadata value in the row), `Couldn’t add the task. Your draft is
   kept — try Add again.`, focus returned, `console.error` retained for the thrown case, and the
   server's own message never surfaced.

Two notes specific to the reveal, neither of them a new user-facing error:

- **A failure must not hide its own message.** `#compose-error` lives in `.compose-options`, which
  is always visible and outside `#compose-meta-row`, so a collapse can never take the alert with
  it. On a recoverable failure the draft stays non-empty, so the row also stays shown with the
  user's metadata intact for the retry — the reset only ever runs on a real shown → hidden
  transition.
- **Visibility cannot desynchronise.** It is derived by one predicate and applied by one function,
  so there is no expanded/collapsed flag to get stuck. The `[hidden]`-versus-`display:flex` hazard
  does *not* disappear as revision 1 claimed — it moves to `.compose-meta-row[hidden]`, which is
  why that rule is called out as load-bearing.

## Tests

All runs use the shared isolated environment (`scripts/lib/isolated-electron.mjs`); nothing may
touch the development database or user-data directory.

### `scripts/quick-add-selftest.mjs` — changes

`openOptions()` is replaced throughout by a helper that focuses `#message-input` (or types into it)
and waits for `#compose-meta-row` to be unhidden — the row is now reached by activity, not a click.

| # | Scenario | Change |
|---|---|---|
| 1-6 | Success, blank submit, tag-only, error-clears | Unchanged, except scenario 1 also asserts `#compose-status` matches `Added “<text>” to <list>.` |
| 7, 8, 8a, 8b | Metadata applied to the created task | Activate the composer instead of `openOptions()`, then interact with the controls directly. Database assertions unchanged. |
| 8c | Default label | Now asserts the *resolved* label: with a list selected, `#compose-list-value` reads that list's name; under `All lists` it reads `No list`. |
| 9 | Reset after success | Values return to defaults; the row stays shown because focus is back in `#message-input`. |
| 10 | Chips | Per Open Question 5's answer. |
| 11, 11a | Compose beats the template | Unchanged apart from the activation helper. |
| 12 | Tag suggestion keyboard | Unchanged. |
| 13 | Escape layering | Now three layers: with the priority menu open, Escape closes it and focuses `#compose-priority-picker`; a second Escape collapses the row and resets values; a third falls through to the app (no overlay opened by the second). |
| 14 | Escape from `#message-input` | With the row shown, Escape collapses it and leaves the draft intact; with it hidden, existing app behaviour. |
| 16, 17 | Responsive and touch | Replace `#compose-options-toggle` with the three row triggers; assert each is ≥44px high at the narrow viewport and that `#compose-meta-row` does not overflow `.main-body`. |
| 18 | Light and dark | Replace the `data-active` toggle assertion with `#compose-meta-row`'s triggers rendering in both schemes with a contrasting error colour. |

### New scenarios

| # | Scenario | Assertions |
|---|---|---|
| 19 | **The row is activity-revealed** | Hidden at load; `#compose-options-toggle`/`#compose-options-panel` do not exist; shown on focusing `#message-input`; still shown after a successful add (focus is back in the input); hidden after blurring with an empty draft. |
| 20 | **A non-empty draft keeps it shown** | Type text, click a task row outside the composer: `#compose-meta-row` is still visible and its values are intact. Clear the draft and blur: hidden. |
| 21 | **Collapse resets to defaults** | Set list, priority and reminder; blur with an empty draft; re-activate: all three read their defaults and `#add-task-template` no longer shows compose chips. |
| 22 | **Escape collapses without touching the draft** | With text typed and metadata set, Escape (nothing open) hides the row, resets the three values, leaves `#message-input.value` unchanged, focuses `#message-input`, and opens no overlay. |
| 23 | **Dismissal is recoverable** | After the Escape collapse, the row stays hidden despite the non-empty draft; clicking a task row and then back into `#message-input` shows it again at defaults. |
| 24 | **The date popover does not collapse the row** | Open the reminder calendar, move focus into it: `#compose-meta-row` is still visible. Pick a date: the value lands and the row is still visible. |
| 25 | **Priority selection survives the blur-to-body** | With the priority menu open, click `High` with the mouse: `#compose-priority-value` reads `High`, the row is still visible, and the created task is `priority='high'` in SQLite. |
| 26 | **The destination label tracks the view** | Select list `Work`: trigger reads `Task list: Work`. Switch to `All lists`: `Task list: No list`. Run a smart list whose query is `list:Personal`: `Task list: Personal`. Explicitly choose `Work`, then switch views: it stays `Work`. |
| 27 | **The label agrees with where the task lands** | For each of the above, submit a task and assert its `list_id` in SQLite equals the list the trigger named. |
| 28 | **Group and field naming** | `#compose-meta-row` has `role="group"` and accessible name `Details for the next task`; the triggers read `Task list: <resolved>`, `Priority: None`, `Reminder: Select date`, and update after a selection. |
| 29 | **Tab order** | From `#message-input`, four Tabs reach `#add-button`, `#compose-list-picker`, `#compose-priority-picker`, then the reminder trigger, in that order — and no Tab from the input reaches a field while the row is hidden. |
| 30 | **Truncation** | With a list whose name exceeds the trigger's maximum, `#compose-list-picker`'s width is ≤ its maximum, its `scrollWidth` exceeds its `clientWidth`, and the full name is still in its accessible name. |
| 31 | **No unset-state styling** | The computed colour/background of a set and an unset trigger are identical, per the spec's "the visible value word is the only signal". |

Regression: `npm run test:isolation` (same check count), `node scripts/query-selftest.mjs`,
`node scripts/shortcuts-selftest.mjs`, `npm run storybook:build`, `npm run check:ux-boundary`.

Manual evidence for the implementation review: light/dark screenshots of the row set and unset, a
narrow-width screenshot showing the wrap, and a keyboard walkthrough of the tab order and Escape
ladder.

## Acceptance Criteria

1. The compose block renders the input row, and below it a metadata row that is hidden at rest and
   shown whenever focus is inside the compose block, the draft is non-empty, or a compose metadata
   surface is open; no Options toggle and no disclosure panel remain in the DOM or the stylesheet.
2. The metadata row is a `role="group"` named `Details for the next task` and shows no visible
   field labels.
3. Task list, Priority and Reminder appear in that order, each with a leading glyph, its current
   value and a caret, and each exposing `<field>: <value>` as its accessible name, kept in sync
   after every selection.
4. Each trigger is content-sized up to its maximum, truncates with an ellipsis beyond it, and the
   row wraps instead of overflowing.
5. An un-overridden Priority reads `None` and Reminder `Select date`, with no separate visual
   treatment, while `data-set` is exposed on the wrapper and trigger.
5a. An un-overridden Task list names the resolved destination — the selected list, the running
   smart list's `list:` term, or `No list` — and follows view and query changes; an explicit choice
   does not follow them. The name shown always matches the `list_id` the submitted task receives.
5b. Every shown → hidden transition, by the activity rule or by Escape, returns all three fields to
   their defaults; a hidden row never leaves metadata armed.
6. Tab order is Task, Add task, Task list, Priority, Reminder, and the fields are unreachable by
   Tab while the row is hidden.
7. Escape closes exactly one open menu or date popover and restores its trigger; with nothing open
   it collapses the row, resets the values, leaves the draft and pending tags untouched and opens
   no overlay; with the row already hidden it falls through to existing app behaviour.
8. Clicking outside the composer closes any open metadata surface without changing a value.
8a. Moving focus into the reminder date popover does not collapse the row, and selecting a priority
   with the mouse (which blurs the trigger to `<body>` first) still applies.
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
  `repeatStart` correction are not redesigned. `resolveComposeDestination()` *extracts* the existing
  precedence so the label and the created task share one owner; it must not change its result for
  any input.
- **Configurable defaults.** Making the reset target user-configurable is explicitly a separate
  story the user will raise; this plan resets to the OQ-011 defaults only.
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

### `2026-08-29 — The metadata row is revealed by composer activity, not permanent`

- Source: `HUMAN DECISION`
- Decision: Show the row while focus is inside the compose block, or the draft is non-empty, or a
  compose metadata surface is open; hide it otherwise. It is never toggled by a control.
- Reason: User instruction, 2026-08-29: "metadata elements visible only when the add new task is
  active", with the activity definition given as focus anywhere in the compose block *and* a
  non-empty draft regardless of focus. Answers revision 1's Open Question 1 with a third option
  that neither the specification nor UX decision 0001 anticipated.
- Supersedes: revision 1's Proposed Solution §1 (permanent row) and, in the same stroke, UX
  decision 0001's "Optional metadata is exposed by a clearly named disclosure" requirement. Both
  the specification's `[FACT]` "permanent metadata row" and decision 0001 now disagree with this
  plan; reconciling those records is Open Question 1.

### `2026-08-29 — Collapsing the row resets all three fields to their defaults`

- Source: `HUMAN DECISION`
- Decision: Every shown → hidden transition restores `composePriority='none'`,
  `composeReminderDate=null`, `composeListId=undefined`, whether the collapse came from the
  activity rule or from Escape. "Hidden" and "at defaults" are therefore the same state.
- Reason: User instruction, 2026-08-29, answering "when the row hides with values set, do the
  values survive?" with "resets to default". The invariant also removes the reveal's worst hazard —
  metadata armed for the next task with nothing on screen saying so. The user has noted that
  configurable default behaviour will be raised as a separate story.
- Supersedes: revision 1's Open Question 2 (whether values persist after a successful add), which
  is answered in the same direction as the shipped `resetComposeOptions()`.

### `2026-08-29 — Escape collapses the row when no surface is open`

- Source: `HUMAN DECISION`
- Decision: Add a fifth Escape layer: with the row shown and no menu or popover open, Escape hides
  it, resets the values, sets a transient `composeMetaDismissed` flag and returns focus to
  `#message-input`. The draft text and pending tags are never affected.
- Reason: User instruction, 2026-08-29: "yes, escape collapse the row". The dismissed flag is
  forced by the interaction of this decision with the activity rule — a non-empty draft would
  otherwise re-show the row immediately.
- Supersedes: revision 1's Proposed Solution §4 item 5 ("the panel layer is gone"), and the
  specification's "with no surface open, the permanent metadata row and draft remain unchanged".

### `2026-08-29 — The Task list trigger names the resolved destination while un-overridden`

- Source: `HUMAN DECISION`
- Decision: While `composeListId === undefined`, the trigger shows the name that
  `composeListId ?? template.listId ?? selectedListId` resolves to, or `No list` when that is
  unfiled, and tracks view and query changes. The placeholder `Current list` is dropped. Displaying
  the resolution must not write it into `state.composeListId`.
- Reason: User instruction, 2026-08-29: when a list or smart list is selected, the field should
  show that list where possible. The precedence already exists at `actions.ts:72-74`, so lifting it
  into `resolveComposeDestination()` makes the label and the created task provably agree.
- Supersedes: revision 1's `Current list` override in `paintComposeListLabel`, and the
  specification's `[FACT]` that an unset Task list reads `Current list`.

### `2026-08-29 — Visibility is predicated on open surfaces, not DOM containment`

- Source: `CODE EVIDENCE`
- Decision: `shouldShowComposeMeta()` includes an "any compose surface open" term rather than
  relying on `:focus-within` or `focusout` alone.
- Reason: The user delegated this to best practice. `datepicker.ts:120` parents the popover to
  `document.body`, so containment-based hiding would collapse the row when focus entered the
  calendar; and the priority menu's non-focusable `<div>` rows blur the trigger to `<body>` before
  their click lands, which would hide the row mid-selection. One predicate covers both.
- Supersedes: `None`

### `2026-08-29 — The reveal is allowed to shift the layout`

- Source: `HUMAN DECISION`
- Decision: Reserve no space for the hidden row and add no transition; content below moves as the
  row appears and disappears.
- Reason: User instruction, 2026-08-29: "let's try with jumps, refactor later if I don't like."
  Reserving space would forfeit the vertical saving the reveal exists to produce.
- Supersedes: `None`

## Revision Log

### `r001 — 2026-08-29 — started`

- Summary: First draft of the Value row plan: replace the Quick Add Options disclosure with a
  permanent, label-free metadata row, reusing the shipped compose data path, feedback surfaces and
  date picker. Five open questions recorded.
- Trigger: `/implementation-plan start spec=spec/ui/quick-add-inline-metadata-value-row.md`.

### `r002 — 2026-08-29 — updated`

- Summary: The row becomes activity-revealed rather than permanent; collapsing resets all three
  fields to defaults; Escape gains a collapse layer backed by a transient `composeMetaDismissed`
  flag; the Task list trigger names the resolved destination via a new shared
  `resolveComposeDestination()` helper instead of the `Current list` placeholder; layout shift is
  accepted. Six decisions recorded. Revision 1's Open Questions 1 and 2 are resolved; three of its
  five carry over, renumbered, and four new questions are raised by the reveal design.
- Trigger: User answers to revision 1's Open Question 1 and the follow-up sub-questions 1a-1e,
  2026-08-29.

## Open Questions

1. **Two approved records now disagree with this plan, and neither is mine to change.** The
   specification states as `[FACT]` that the metadata row is *permanent* and that an unset Task
   list reads `Current list`; UX decision 0001 requires a "clearly named disclosure". The
   activity-revealed row is a third design that neither anticipated, and it arguably weakens
   0001's discoverability mitigation further, since at rest there is now no affordance at all — not
   even an `Options` button. Should the Spec Owner add the 2026-08-29 human decisions to
   `spec/ui/quick-add-inline-metadata-value-row.md`, and should a new UX decision record supersede
   0001's disclosure requirement, before this plan is approved? The plan proceeds on your
   instruction either way, but it will knowingly contradict its own source until those records
   exist.
2. **Should `Current list` survive for the un-overridden case?** As planned, a Task list that
   resolves to Work and an explicit choice of Work read identically (`Task list: Work`); only
   `data-set` distinguishes them. That is what makes the trigger truthful about the destination,
   and no outcome information is lost. But it does remove the user's ability to see, at a glance,
   whether they have overridden anything — which matters more now that a collapse silently resets
   the override. Accept as planned, or keep a distinct un-overridden presentation (for example
   `Work (current)`)?
3. **After Escape collapses the row, what brings it back within the same draft?** As planned,
   `composeMetaDismissed` clears only when focus leaves the compose block and re-enters — so a user
   who dismisses mid-draft must click away and back. The alternative is to clear it on the next
   keystroke in `#message-input`, which is more forgiving but makes the dismissal feel like it did
   not take. Which?
4. **Confirm that Escape discarding metadata is intended.** It follows directly from your two
   answers (collapse resets; Escape collapses), and the plan implements it. It is worth one
   explicit confirmation because Escape is non-destructive everywhere else in Adeo — it closes
   surfaces and restores focus, never discards entered data. A user who sets High, presses Escape
   to dismiss the row, and submits will get a task with no priority.
5. **Do the compose values still appear as chips in `#add-task-template`?** Carried over from
   revision 1, and now more consequential: while the row is hidden the chips would be the *only*
   place the next task's metadata could be shown — except that the collapse-resets decision means
   there is never any compose metadata to show while hidden. That argument for keeping them has
   therefore evaporated, and the duplication argument for dropping them stands. Keep them (one
   summary of everything the next task gets, including the smart-list template's own values), or
   drop the compose-driven chips and let `renderTemplateHints()` return to describing only the
   running query?
6. **Are the concept's menu semantics in scope here?** The concept's Task list and Priority menus use
   real `<button role="menuitemradio" aria-checked>` rows with Arrow/Home/End movement, Enter/Space
   selection, Tab-closes and Escape-with-focus-restore. The shipped menus are role-less `<div>`s with
   a click-only handler — filed as F-01 (High) and F-02 (Medium) in
   `ui-ux/handoffs/phase3-handoff.md`. OQ-012 deliberately keeps those defects out of this
   specification. Fix them inside this plan (the markup is being rewritten anyway, so the marginal
   cost is small — and it would also retire the blur-to-`<body>` hazard by making the rows real
   buttons), or leave them for P4.4?
7. **Is 44px at ≤480px still verifiable, and does it still matter?** The shipped window floor is
   `minWidth: 600` (`src/main.ts:809`); the existing suite reaches 390px only by relaxing that floor
   from the test and degrades gracefully when the platform refuses. Keep that approach for the new
   row's touch-target checks, or drop the narrow-viewport assertions until P5.4 makes a narrow
   window reachable in the shipped app?
8. **Interpretation check.** Your phrase "when project in chips to be selected based on this" is
   read here as the Task list *trigger* in the metadata row showing the resolved list. If you meant
   the `#add-task-template` chips instead, say so — it changes Open Question 5's answer rather than
   this plan's §1b.

## Implementation Status

`IMPLEMENTED` via the STANDARD workflow (`.claude/workflow/current.md`), 2026-08-30.
This document was never FULL-approved; it served as the detailed reference. The
STANDARD mini spec is the governing artifact and records the resolutions of Open
Questions 3, 5, 6 and 7 (dismissed-flag clears on re-entry; compose chips dropped
from `#add-task-template`; F-01/F-02 menu semantics left filed; narrow-viewport
tests keep the relaxed-floor approach). Open Questions 1 and 2 (spec/UX-decision
reconciliation, and whether to keep a distinct un-overridden label) remain for the
Spec Owner / a UX decision record.
