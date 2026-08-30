# Feature: Quick Add inline metadata — Value row

Mode: STANDARD
Status: COMPLETED
Escalated From: None
Full Plan: None
Approved Snapshot: None

## Goal

Replace the shipped Quick Add **Options disclosure** (toggle + stacked-label panel) with the
selected `A · Value row` layout: Task list, Priority and Reminder in one compact, label-free,
wrapping row under the input row. Each control is self-describing — leading glyph + current
value + caret — with `<field>: <value>` as its accessible name. The row is revealed by
composer activity (focus inside the compose block, a non-empty draft, or an open metadata
surface) and collapses to defaults otherwise.

Presentation/discoverability change only. The shipped data path is reused unchanged:
`state.composeListId` (tri-state), `state.composePriority`, `state.composeReminderDate`,
`composeSeed()`, the compose-beats-template-beats-sidebar destination rule in `addTask()`,
and `#compose-status` / `#compose-error`.

## References (do not duplicate)

- Concept: `ui-ux/ux/concepts/quick-add-inline-metadata-layouts.stories.ts` → `ValueRow`
  (`concepts-quick-add-inline-metadata-layouts--value-row`); comparison write-up
  `ui-ux/ux/concepts/quick-add-inline-metadata-layouts.md`.
- Spec: `spec/ui/quick-add-inline-metadata-value-row.md`.
- Prior DRAFT plan `.claude/plans/active/quick-add-inline-metadata-value-row.md` — use its
  "Current Behavior" inventory and Acceptance Criteria 1–13 as the detailed reference; this
  STANDARD spec supersedes it as the governing artifact.

## Acceptance Criteria

- Compose block = input row (task field + icon-only Add) then a `role="group"` metadata row
  named `Details for the next task`, no visible group or per-field labels. No Options toggle
  or `#compose-options-panel` remains in DOM or stylesheet.
- Row is hidden at rest; shown whenever focus is inside the compose block, the draft is
  non-empty, or a compose metadata surface is open. Fields are not Tab-reachable while hidden.
- Task list, Priority, Reminder in that order; each has a glyph, current value, caret, and a
  kept-in-sync `<field>: <value>` accessible name. Triggers are content-sized up to a max,
  truncate with ellipsis, and the row wraps rather than overflowing.
- Un-overridden Priority reads `None`, Reminder `Select date`; `data-set` exposed on wrapper
  and trigger. Un-overridden Task list names the **resolved** destination (selected list, a
  running smart list's `list:` term, or `No list`) and follows view/query changes; an
  explicit choice does not. Displayed name always equals the `list_id` the task receives.
- Every shown→hidden transition (activity rule or Escape) resets all three fields to defaults
  — a hidden row never leaves metadata armed.
- Tab order: Task, Add task, Task list, Priority, Reminder.
- Escape closes exactly one open menu / date popover and restores its trigger; with nothing
  open it collapses the row, resets values, leaves draft and pending tags untouched, opens no
  overlay; with the row already hidden it falls through to existing app behaviour.
- Click outside the composer closes any open metadata surface without changing a value.
  Focus into the reminder popover does not collapse the row; mouse priority selection (blur
  to `<body>`) still applies.
- Task created with row values persists chosen `list_id` / `priority` / `reminder_date`; an
  explicit row value still beats a running smart-list template. Success/blank/failure copy,
  draft preservation and focus behaviour unchanged.
- ≥44px trigger height at ≤480px; no horizontal overflow at verified viewports.
- Passes: `npm run build`, `npm run check:ux-boundary`, `node scripts/query-selftest.mjs`,
  `node scripts/shortcuts-selftest.mjs`, `npm run test:isolation`, `npm run test:quick-add`,
  `npm run storybook:build`.

## Constraints

- No change under `server/`, `src/main.ts`, `src/preload.ts`, or `ui-ux/`. No schema,
  endpoint, or `TaskSeed` change. No new shortcut id.
- No `.qaim-*` class, `createMenuField`, `createComposer`, or fixture imported/copied from
  the concept; layout rules re-authored under production names.
- Edit dialog controls (`#priority-picker`, `#reminder-picker`, `#modal-list-picker`, the
  `modal*` state) keep their single-owner relationship with the edit modal.
- `resolveComposeDestination()` only *extracts* the existing precedence so the label and the
  created task share one owner; it must not change the result for any input. Tri-state
  `undefined` still means "inherit the chain" — displaying the resolution must never write it
  into `state.composeListId`.
- Reminder trigger is restyled via its input's class (as `attachDatePicker` already does),
  not a new component.

## Open Decisions

None. Resolved for this STANDARD scope (approver may override):
- Compose-driven chips in `#add-task-template` are **dropped**; `renderTemplateHints()`
  returns to describing only the running query. (Collapse-resets means there is no armed
  compose metadata to summarise while the row is hidden.)
- Shipped role-less `<div>` priority/list menu rows (F-01/F-02) are **left as-is** — out of
  scope for this change; the row is reached by Tab and menus keep today's click behaviour.
- After Escape collapses the row, it returns when focus leaves the compose block and
  re-enters (no clear-on-keystroke).
- Narrow-viewport (≤480px / 44px) assertions keep the existing suite's approach of relaxing
  the window floor from the test and degrading gracefully.

## Likely Impacted Areas

- `index.html` (~227–287) — replace `.compose-options` toggle + `#compose-options-panel`
  with the metadata `role="group"` row; glyphs, value spans, carets; remove stacked labels.
- `src/renderer/composeOptions.ts` — drop toggle/open/close-panel logic; add activity-driven
  visibility lifecycle, `resolveComposeDestination()`, resolved Task list label, reset on
  hide, revised Escape ordering.
- `src/renderer/dom.ts` — `refs` for the new/removed elements.
- `src/renderer/activeSmartList.ts` (`renderTemplateHints`) — revert compose-driven chips.
- `src/renderer/actions.ts` — confirm destination precedence still routes through the shared
  resolver; no behavioural change expected.
- `styles.css` (~1749–1900, 2756–2823) — new `.value row` layout rules; delete
  `.compose-options*` panel styles and the Quick-Add `@media (max-width:480px)` panel block.
- `scripts/quick-add-selftest.mjs` — rewrite scenarios 7–9, 13, 14, 16, 17 (toggle/panel
  assertions) against the activity-revealed row.

## Readiness Review
BLOCKING:
None.

NON-BLOCKING:
None.

READY FOR IMPLEMENTATION: YES

## Verification

Implemented on branch `settings-tabs`. Changed: `index.html`, `styles.css`,
`src/renderer/{composeOptions,activeSmartList,actions,composeFeedback,dom,state,index,querySearch}.ts`,
`scripts/quick-add-selftest.mjs`, `CLAUDE.md`. No `server/`, `src/main.ts`,
`src/preload.ts` or `ui-ux/` change.

All green:
- `npm run build` + `npm run check:ux-boundary`
- `node scripts/query-selftest.mjs` (103), `node scripts/shortcuts-selftest.mjs` (132)
- `npm run test:workflow`
- `npm run test:isolation` (34 checks, protected files byte-identical)
- `npm run test:quick-add` (114 checks — rewrote toggle/panel scenarios; added
  activity-reveal, collapse-resets, Escape-collapse, date-popover-no-collapse,
  group/field naming, tab-order, destination-label-tracks-view)
- `npm run storybook:build`

Visual: light/dark set+unset and 390px-wrap screenshots captured and eyeballed —
content-sized pills, glyph-led fields, no unset-state styling, sunken-pill reminder.

Final review: implementation matches the STANDARD spec and the four resolved
Open Decisions (chips dropped, F-01/F-02 left filed, dismissed-flag clears on
re-entry, narrow-viewport keeps the relaxed-floor test approach). No blockers.
