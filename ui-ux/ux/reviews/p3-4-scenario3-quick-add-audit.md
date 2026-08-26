# UX implementation review: Quick Add Options disclosure

**Status:** DRAFT
**Reviewer:** Product Design Agent
**Review date:** 2026-08-26
**UX decision:** [0001 — Quick Add direction](../decisions/0001-quick-add-direction.md)
**Production commit/diff:** `8922503` (range `70c3d67..8922503`)
**Build under review:** none executed — static source inspection only (`git show`/`git diff`,
file reads). `npm run check:ux-boundary` was the one command run against this tree.

## Outcome

Read against the approved decision and the Phase 2 handoff, the four scope items the handoff
names — the `composeListId` tri-state, the Options-beats-template-beats-selection precedence,
blank-submit-before-tag-creation ordering, and the `renderTemplateHints` destination chip — are
all demonstrably implemented in source, at the cited lines, with no divergence found. Two
accessibility defects are settled by source alone and are reported as findings: the Quick Add
priority menu cannot be operated by keyboard (F-01), and both new compose menus declare
`role="menu"` without owned `menuitem` children (F-02). Everything that depends on what the
running Electron app actually renders, focuses, or announces is marked NOT TESTED: this agent
does not launch the real app, and Storybook contains only the pre-implementation *concept*
alternatives (`ux/concepts/quick-add-pilot.stories.ts`), not the shipped code path, so no story
exercises the production markup. This review reports against criteria; it approves nothing.

## Requirement-to-evidence traceability

| Requirement / acceptance criterion | Evidence (story, test, screenshot, selector, steps) | Result | Finding ID |
|---|---|---|---|
| `composeListId` is a tri-state sentinel: `undefined` = untouched/inherit, `null` = explicit "No list", number = explicit list | `src/renderer/state.ts:80-88` declares `composeListId: number \| null \| undefined` with that contract; `:135` initializes it `undefined`; `src/renderer/composeOptions.ts:38-44` renders "Current list" only while `=== undefined`, and `:129` writes `null` for the empty-value item | PASS | |
| An explicit compose list beats the running smart list's `list:` term, which beats the sidebar selection | `src/renderer/actions.ts:71-77` — `state.composeListId !== undefined ? state.composeListId : resolved?.listId !== undefined ? resolved.listId : state.selectedListId` | PASS | |
| An explicit Options priority/reminder beats the template-derived value field by field | `src/renderer/actions.ts:84` — `{ ...templateSeed(template), ...composeSeed() }`; `composeOptions.ts:82-87` emits only fields the user actually set, so unset fields do not clobber template values | PASS | |
| A compose reminder date that overrides the template's does not leave `repeatStart` disagreeing | `src/renderer/actions.ts:85-89` re-derives `repeatStart` from the merged `reminderDate` when a `repeatRule` is present | PASS | |
| Blank submit is checked *before* any tag is created and is a true no-op | `src/renderer/actions.ts:33-41`: `text` is computed and the early return fires before the `addTag` loop at `:54-67`. The diff confirms this is a reorder — the pre-commit code returned at old `actions.ts:57-63`, *after* tag creation, and called `renderTags()` | PASS | |
| Blank submit names the missing task text and keeps focus in the field | `actions.ts:38-40` calls `showComposeError('Enter a task before adding.')` then `input.focus()`; message renders into `#compose-error` (`index.html:232`, `role="alert"`) | PASS (code path) | |
| Focus actually returns to `#message-input` after a blank submit in the running app | Requires dispatching a real submit in the running Electron app and reading `document.activeElement`. Not performed — this agent does not launch the app, and no Storybook story mounts the production compose row | NOT TESTED | |
| Recoverable save failure preserves the whole draft (text, pending tags, chosen Options) | `actions.ts:94-98` and `:118-122` return/​catch without clearing `input.value`, `state.pendingTagIds`, or calling `resetComposeOptions()`; the only reset is on the success path at `:111` | PASS | |
| Failure message names the recovery path and never surfaces server error text | `actions.ts:95` and `:120` use one fixed string, "Couldn't add the task. Your draft is kept — try Add again."; the server's `{ error }` payload is discarded | PASS | |
| Success clears the draft, resets Options, and returns focus to the task field | `actions.ts:105-117`: `state.pendingTagIds = []`, `resetComposeOptions()`, `input.value = ''`, `input.focus()`; `composeOptions.ts:89-99` clears all three compose fields, repaints, closes the panel and forces a hints repaint | PASS (code path) | |
| Success is announced to assistive tech only, not shown visually | `index.html:233` — `#compose-status` is `.visually-hidden`, `role="status"`, `aria-live="polite"`; `composeFeedback.ts:9-21` clears then sets on the next frame so a repeated identical string re-announces | PASS (code path) | |
| The success announcement is actually spoken by a screen reader | Requires the running app plus an assistive-technology client. Not performed; no AT was driven and no live region was observed firing | NOT TESTED | |
| `renderTemplateHints()` shows a destination chip whenever `composeListId !== undefined`, even with no search running | `src/renderer/activeSmartList.ts:209-213` adds `hasComposeMetadata` to the early-return guard; `:224-238` emits the destination chip when `template \|\| searching \|\| state.composeListId !== undefined`, and the compose override is checked first | PASS | |
| The hints row does not memoize away a compose-only change | `activeSmartList.ts:203` — the memo key now includes `composePriority`, `composeReminderDate` and `composeListId`; every compose mutation additionally calls `renderTemplateHints(true)` (`composeOptions.ts:98,133,153,161`) | PASS | |
| A compose priority/reminder replaces the template chip for the same field — never both | `activeSmartList.ts:249-262`: `effectivePriority` prefers the compose value; the reminder chip is an `else if` over `template?.due` | PASS | |
| Optional metadata is exposed by a clearly named disclosure that reports its state | `index.html:230-231` — `<button id="compose-options-toggle">Options</button>` with `aria-expanded` and `aria-controls="compose-options-panel"`; toggled in `composeOptions.ts:65-77` | PASS | |
| Opening the panel puts focus on its first meaningful control | `composeOptions.ts:76` — `refs.composeListPicker?.focus()` | PASS (code path) | |
| Escape closes exactly one surface per press and restores focus to that surface's own trigger | `composeOptions.ts:164-184` implements list menu → priority menu → (defer to `datepicker.ts` when `isDatePickerOpen()`) → panel, each `stopPropagation()`-ing and refocusing its trigger | PASS (code path) | |
| Escape layering behaves that way in the running app, from real focus positions | Requires live key dispatch. `scripts/quick-add-selftest.mjs:519-545` covers it, but that suite builds and launches Electron; per this agent's guardrails it was not run, and the handoff's "passing" claim is second-hand | NOT TESTED | |
| Enter never opens or is swallowed by Options | `composeOptions.ts` registers no `keydown` handler other than the Escape one at `:164`, which returns early for any other key — necessary but not sufficient evidence; native Enter activation of the buttons inside the panel was not observed | NOT TESTED | |
| Every Options control is operable with keyboard alone | `index.html:258-274` — `.priority-menu-item` rows are `<div>`s with no `tabindex`, no `role`, and no key handler; `composeOptions.ts:143-154` binds `click` only. No arrow-key or focus management exists for this menu | **FAIL** | F-01 |
| Menu semantics: `role="menu"` containers own `menuitem` children | `index.html:245` (`#compose-list-menu` `role="menu"`, children are `<button class="modal-list-item">` from `lists.ts:73-82`) and `index.html:258` (`#compose-priority-menu` `role="menu"`, children are role-less `<div>`s). The pre-existing equivalents `#modal-list-menu` (`:320`) and `#priority-menu` (`:330`) carry no `role` at all | **FAIL** | F-02 |
| Options state has a non-color cue, not just the toggle's tint | `composeOptions.ts:56-63` drives `data-active` (styled color-only at `styles.css:2762-2765`), but the hints row's chips fire on exactly the same condition (`activeSmartList.ts:209-213`), so a textual cue is always present | PASS (structural) | |
| Light and dark themes meet contrast for the new surfaces | Requires rendering and measuring. `scripts/quick-add-selftest.mjs:647-675` only asserts a computed colour exists and differs from its background — no ratio is computed — and it was not run here | NOT TESTED | |
| New/touched spacing declarations use `--space-*` | `styles.css:2756-2801` uses `--space-2/8/16/0` exclusively; those tokens resolve in production because `styles.css:1-2` `@import`s `./styles/tokens.css`, which defines them at `styles/tokens.css:97-107`, and `package.json:9` copies `styles/*.css` into `dist/styles/` | PASS | |
| Concept code is not imported by production | `npm run check:ux-boundary` → "UX dependency boundary passed (44 production files scanned)" | PASS | |
| Production classes/DOM are reused rather than reinvented | `index.html:238-278` reuses `.modal-list-select-wrap`, `.reminder-picker`, `.modal-list-menu`, `.priority-select-wrap`, `.priority-picker`, `.priority-chip`, `.priority-menu`, `.priority-caret`, `.reminder-date-input`, `.view-bar-action` — all pre-existing selectors in `styles.css` | PASS (markup) | |
| The shipped surface renders with production fidelity (no invented borders/shapes) | Requires visual comparison of the running app against production components. Not performed; the only Quick Add stories are concept alternatives, which do not render this markup | NOT TESTED | |
| 44px touch targets for primary controls at 390px | `styles.css:2803-2822` declares `min-height`/`min-width: 44px` under `@media (max-width: 480px)` for `#add-button`, the toggle, and the panel's `.priority-picker`/`.reminder-picker`/`.date-picker-trigger`. Whether the computed boxes reach 44px was not measured | NOT TESTED | |
| No horizontal overflow at 1440 / 1024 / 768 / 390px | Requires live layout measurement at four viewports | NOT TESTED | |
| Reminder trigger label repaints when Options are reset | `composeOptions.ts:95` sets `refs.composeReminderDate.value = ''`, and `datepicker.ts:132-142` replaces the input's `value` setter with one that calls `refreshTrigger()` | PASS | |

Count: 31 rows — 21 PASS (six of them qualified "code path", "structural", or "markup", meaning
the source demonstrably implements the behavior but the rendered/runtime result was not
observed), 2 FAIL, 8 NOT TESTED.

## Evidence environment

- Source commit: `8922503` on branch `settings-tabs`, compared against `70c3d67`.
- OS/runtime: macOS (darwin 25.5.0). No Electron, no FastAPI server, and no Storybook instance
  was started for this review.
- Theme(s): none rendered. Every theme claim below is source-level only.
- Viewport(s): none rendered. Every viewport claim is source-level only.
- Fixture/database: none. No database file was opened, read, or written.
- Electron `userData` path: not applicable — the app was never launched.
- Commands: `git show 8922503 --stat`; `git diff 70c3d67 8922503 -- <paths>`;
  `git log -S'--space-2' -- styles.css`; `git blame -L 2222,2236 styles.css`;
  `npm run check:ux-boundary`; plus `grep`/`ls` and file reads of
  `src/renderer/{composeOptions,composeFeedback,actions,activeSmartList,dom,state,index,lists,datepicker}.ts`,
  `index.html`, `styles.css`, `styles/tokens.css`, `.storybook/preview.ts`,
  `scripts/quick-add-selftest.mjs`, `package.json`,
  `ui-ux/ux/concepts/quick-add-pilot.stories.ts`.
- Confirmation that real development/user data was unchanged: nothing was executed that can
  reach a database. `npm run check:ux-boundary` runs `scripts/check-ux-boundary.mjs`, a
  read-only static import scan, and printed "UX dependency boundary passed (44 production files
  scanned)". No build, no Electron launch, no server start.
- Second-hand, explicitly **not** reproduced here: `ui-ux/handoffs/phase2-handoff.md:36-40`
  states `npm run build` was clean and that `query-selftest`, `shortcuts-selftest`,
  `npm run test:isolation` (34 checks) and `npm run test:quick-add` (91 checks, rerun twice)
  passed. `package.json:15-16` confirms both test scripts exist and that each runs
  `npm run build` first. This review did not run them and does not count that claim as
  verified evidence.

## Findings

### F-01: The Quick Add priority menu cannot be operated by keyboard

**Severity:** High
**Requirement:** `ux/accessibility.md` — "All critical flows work with Tab/Shift+Tab plus
documented scoped shortcuts"; decision 0001's "Strong keyboard continuity" rationale for
Alternative A, and its risk row requiring keyboard interaction coverage for every revealed
surface.
**Reproduction (derived from source; not executed):**
1. `index.html:258-274` — `#compose-priority-menu` holds four `<div class="priority-menu-item">`
   rows with no `tabindex`, no `role`, and no `href`. A `div` in that state is not focusable, so
   Tab cannot reach it.
2. `src/renderer/composeOptions.ts:136-141` — the trigger's handler only flips `style.display`
   and `aria-expanded`; focus stays on the trigger.
3. `src/renderer/composeOptions.ts:143-154` — the only selection path is a `click` listener on
   the menu. There is no `keydown`, no arrow-key handling, and no roving tabindex in the module;
   its one other listener (`:164`) returns for every key except Escape.
**Evidence:** the three citations above. Corroborating but not decisive:
`scripts/quick-add-selftest.mjs:521-523` selects a priority with `.click()` and then has to call
`.focus()` on the trigger explicitly before pressing Escape — the suite never selects a priority
by keyboard, so a green run would not have caught this.
**Expected:** a keyboard user can open Options, reach Priority, and choose a value — as the
approved concept allowed: `ux/concepts/quick-add-pilot.stories.ts:425-437` built the compact
alternative's options as real `<button>`s with `aria-pressed`, fully tabbable.
**Actual:** the panel is tab-navigable as far as its three triggers (`#compose-list-picker`,
`#compose-priority-picker`, the date-picker trigger). List selection *is* keyboard-reachable
because `lists.ts:73-82` builds `<button>` items. Priority selection is pointer-only.
**Scope note:** the edit dialog's pre-existing `#priority-menu` (`index.html:330-346`) has the
same structure, so this is a faithfully copied pre-existing pattern rather than a newly invented
one — but it is now on the Quick Add path, which decision 0001 places at the center of the
"capture first" flow.
**Suggested scope:** make `.priority-menu-item` a `<button type="button">` (or add
`tabindex`/`role="menuitem"` plus key handling) in both menus, in one focused change, with no
visual change. Not a redesign.
**Owner / due task:** Architect Agent → implementation agent; first approved Quick Add/dialog
keyboard-accessibility task (P4 keyboard coverage). Requires production-code changes, so it is
outside this agent's boundary.

### F-02: `role="menu"` declared without owned `menuitem` children

**Severity:** Medium
**Requirement:** `ux/accessibility.md` — "Inspect accessible names, roles, states, and
announcements"; ARIA's required-owned-elements rule for `role="menu"`.
**Reproduction (derived from source; not executed):**
1. `index.html:245` — `<div id="compose-list-menu" class="modal-list-menu" role="menu">`, whose
   children are `<button class="modal-list-item">` built by `lists.ts:73-82` with no
   `role="menuitem"`.
2. `index.html:258` — `<div id="compose-priority-menu" class="priority-menu" role="menu">`, whose
   children are role-less `<div>`s.
3. Both triggers advertise `aria-haspopup="menu"` (`index.html:242`, `:255`).
**Evidence:** the citations above, plus the contrast with the pre-existing equivalents
`#modal-list-menu` (`index.html:320`) and `#priority-menu` (`index.html:330`), which declare no
`role` at all — so this markup *added* the role rather than inheriting it.
**Expected:** either owned `menuitem` children with menu keyboard semantics, or no `role="menu"`
and no `aria-haspopup="menu"` — whichever matches what the controls actually are.
**Actual:** a menu role whose children are not menu items. Assistive technology is told to expect
a menu and finds none; for priority it also cannot be operated, which is F-01 — the behavioral
half of the same defect.
**Suggested scope:** resolve together with F-01, as one decision covering both menus.
**Owner / due task:** Architect Agent → implementation agent; same task as F-01.

## Accessibility review

- [ ] Keyboard-only critical flow completed. — NOT DONE; requires the running app. Source review
  found F-01, which would block the priority control in such a pass.
- [ ] Focus order, dismissal, and restoration verified. — PARTIAL. The Escape ordering and the
  focus-restoration calls are present and correctly sequenced (`composeOptions.ts:164-184`), and
  no `tabindex` greater than 0 exists in the new markup, so DOM order should be tab order.
  Observed focus transitions: NOT TESTED.
- [x] Names, roles, states, and announcements inspected — statically. `aria-expanded` /
  `aria-controls` on the toggle, `aria-labelledby` pairs on both pickers, `role="alert"` on
  `#compose-error`, and `role="status"` + `.visually-hidden` on `#compose-status` are all present
  and internally consistent. Two role defects recorded as F-02.
- [ ] Axe run on every revealed state; report attached. — NOT DONE. Axe runs inside Storybook and
  no story renders the shipped markup.
- [ ] Light/dark and non-color state cues reviewed. — PARTIAL. The non-color cue (the hints-row
  chips) is structurally guaranteed by an identical condition; contrast in either theme was not
  measured.
- [ ] 200% zoom and reduced-motion behavior reviewed. — NOT DONE; requires rendering.
- [ ] Touch path reviewed where in scope. — NOT DONE; only the CSS declarations were read.

## Responsive review

| Viewport | Theme/state | Result | Evidence |
|---|---|---|---|
| 1440px | light + dark | NOT TESTED | No render performed. `scripts/quick-add-selftest.mjs:566-586` asserts no overflow here, but was not run for this review. |
| 1024px | light + dark | NOT TESTED | As above. |
| 768px | light + dark | NOT TESTED | As above. |
| 390px | light + dark | NOT TESTED | As above, plus the conditional-coverage gap recorded below. |

## Gaps and follow-up

- **All live behavior is untested by this review.** Eight rows are NOT TESTED because confirming
  them needs the running Electron app: real focus transitions, real Escape dispatch, screen-reader
  announcement, rendered fidelity, computed touch-target boxes, and overflow at four viewports.
  This agent does not launch Electron or the API, and Storybook carries only the pre-implementation
  concept alternatives. Owner: whoever runs `npm run test:quick-add` plus a manual keyboard/AT
  pass — Architect Agent to schedule.
- **The acceptance suite's 390px checks are conditional.** `scripts/quick-add-selftest.mjs:591-635`
  wraps the narrow-viewport and 44px assertions in `if (narrowVerified)` and otherwise logs and
  continues. A green "91 checks" run therefore does not by itself prove 390px was exercised on
  that machine. Owner: Architect Agent; due P5.4 responsive work.
- **The suite's light/dark checks assert presence, not contrast** (`:647-675`): no ratio is
  computed for `#compose-error` or the active toggle. Owner: Architect Agent; due P4 accessibility
  coverage.
- **Inferred, not verified — recorded so it is not lost.** The panel's Escape handler is bound to
  the panel, and on macOS clicking a `<button>` does not reliably focus it, so a pointer user whose
  focus is still in `#message-input` gets the "panel stays open" behavior that
  `scripts/quick-add-selftest.mjs:550-560` deliberately asserts. Whether that is the desired end
  state for a mouse-first user is a product question for the user, not a defect, and is raised
  here rather than filed as a finding.

## Final traceability check

- [x] Every blocking claim has reproducible evidence. Neither finding is marked Blocking; both
  cite file and line.
- [x] Expected visual changes link to the approved UX decision.
- [x] No baseline was regenerated merely to hide a regression. No baseline was touched;
  `ux/baselines/` was not written to.
- [x] Every new/touched component spacing declaration uses `--space-*` or records an inline
  `spacing-exception` and repeats its rationale in this review. Verified: `styles.css:2756-2801`
  uses only `--space-*`, and those tokens do resolve in production — `styles.css:1-2` `@import`s
  `./styles/tokens.css`, which defines `--space-0` … `--space-32` at `styles/tokens.css:97-107`,
  and `package.json:9` copies `styles/*.css` into `dist/styles/` at build time. The
  `min-height`/`min-width: 44px` values at `styles.css:2803-2822` are target-size constants from
  `ux/accessibility.md`, not spacing.
- [x] No production files, tests, dependencies, plans, or Git state were modified by the Product
  Design Agent during this review. The only file written is this review.
