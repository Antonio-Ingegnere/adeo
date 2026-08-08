# UI/UX Modernization Plan

Based on a hands-on review of the running app (2026-08-09, commit `3cb11f9`) against current desktop UI/UX practice, with special attention to the search bar. Findings were captured by driving a live instance with representative data (lists, tags, priorities, reminders, repeats, markdown details, completed tasks) and probing keyboard/focus behavior.

Revised 2026-08-09 after a code-level verification pass against the tree (see "Verified against code" below): one finding was withdrawn, the phase order was inverted so the token layer lands first, and the S3/S4 fix was re-specified as a parser-state change rather than a display timer.

## Status — all phases implemented (2026-08-09)

Every phase below is done and verified against a running instance. Deviations from the plan as written, and why:

| # | Planned | What shipped |
|---|---------|--------------|
| 1a | `--space-1..6` spacing tokens | **Not done.** Colour, elevation, radius and (in 1b) typography are tokenised; spacing is not. Rewriting ~200 padding/margin/gap declarations is wide, risky churn that buys nothing for dark mode or restyling, so it was left out rather than half-applied. |
| 1a | "Deduplicate priority colors into one source" | The premise was wrong: only `priorityFillColors` was duplicated. The modal swatch and the task-row checkbox border have always used *different* palettes (low is `#7ED957` in the modal, `#6ecb4d` in the list). All three are now `--priority-*` tokens, kept distinct rather than silently unified. |
| 2 | S3/S4 via pending-token classification | Done as specified — no timer needed. `isPendingTail()` in `querySearch.ts`. |
| 3 | "make list/tag pills real buttons" | `role="button"` + `tabindex` + Enter/Space instead. Each pill *contains* its kebab `<button>`, and a button inside a button is invalid HTML that browsers reparent. Same keyboard behaviour, valid markup. |
| 3 | "verify dialogs trap focus" | They did not — focus escaped into the page after 8 tabs, and adding the pills to the tab order made it worse. Fixed with `src/renderer/focusTrap.ts`. |
| 4 | Text labels on Save/Cancel | `title` tooltips instead. Converting every modal's icon-only round action button to a text button is a larger visual change than this phase's remit. |
| 4 | 140ms transitions on menus | Enter-only CSS *animations*, not transitions. The menus are raw `display:none` ↔ `display:flex` toggles driven from JS; an animation replays on redisplay with no change to the show/hide logic, where an exit transition would require keeping elements displayed after JS hides them. |
| 5 | Dark mode | Done, plus `color-scheme: dark` so native controls follow, and dark copies of the two things tokens cannot reach (the search icon's `data:` URI, the checkbox tick). |
| — | A4 contrast | Extended slightly: `--text-faint` `#777` → `#767676`, which was 4.48:1 and failed AA by a hair. |

Known gaps, deliberately not addressed: drag handles are still pointer-only (keyboard reordering is a feature, not a polish item), and the background behind an open modal is not `aria-hidden`.

## Findings

### Search bar (priority area)

| # | Finding | Severity |
|---|---|---|
| S1 | The fluid field now stretches edge-to-edge (~1900px at wide windows). Line lengths that long are hard to scan and look unbalanced; every major app caps its toolbar search (~600-720px). Confirmed: `.lists-search-field` (`styles.css:56`) is `flex: 1 1 auto` with no `max-width`. | Medium |
| S2 | Focus ring is the OS default (`outline: auto`) — a loud accent-colored double ring that fights the input's rounded shape. Confirmed: no `:focus-visible` rule exists anywhere; only 5 bare `:focus` rules in the whole stylesheet. | Medium |
| S3 | **Premature error display**: typing `tag:` shows a red "⚠ Expected value after tag:" *while the autocomplete dropdown is open offering the values* — the user is mid-token and being told they're wrong. | High |
| S4 | **Stale-results confusion**: incremental typing makes intermediate barewords valid (`tag` before `tag:`), so an invalid query shows last-good results that can be "No tasks match your search" *plus* a red error — two conflicting signals. Confirmed at `src/renderer/querySearch.ts:113`: on parse failure the code sets `queryError` but deliberately retains the last-good `queryPredicate`. | High |
| S5 | "Search results" title has no result count. Add "Search results · 3" (and "0 results" instead of relying on the empty box alone). | Low |
| S6 | No discoverability of Cmd/Ctrl+F: placeholder is bare `Search` (`index.html:16`); it should hint the shortcut (`Search ⌘F` / `Ctrl+F`, platform-aware). | Low |
| S7 | Advanced-mode discoverability rests entirely on the small ‹/› glyph. A tooltip is present (`title` attribute), but consider surfacing the "?" help affordance in simple mode too, or a first-use hint. | Low |
| S8 | Autocomplete has no ARIA combobox semantics (`role="combobox"`, `aria-expanded`, `aria-activedescendant`, `role="listbox/option"`), so screen readers announce nothing. Same for the add-box tag autocomplete. | Medium |

### App-wide

| # | Finding | Severity |
|---|---|---|
| A1 | **Typography**: `font-family: Arial` (`styles.css:7`) — dated, non-native. Use the system stack (`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`). Metadata is 10px (`styles.css:302, 1406, 1753, 1996, 2050`) — below comfortable minimums; establish a type scale (11/12/13/14/16) and stop at 11px. | High |
| A2 | **No design tokens**: 172 hex literals across `styles.css`'s 2095 lines and **zero** CSS custom properties (grays `#444/#666/#888/#d6d6d6/#e0e0e0`, blue `#1d72f3`). Priority colors are triplicated: `src/renderer/modals.ts:9`+`:17`, `src/renderer/tasks.ts:86`+`:93`, and inline `style="background:…"` in `index.html:180-192`. Introduce `:root` custom properties (color, spacing, radius, shadow). This is the prerequisite for dark mode and for consistent restyling. | High |
| A3 | **No dark mode** — the most-expected modern feature for a desktop app. After A2, add a `prefers-color-scheme: dark` token set (and optionally a settings override). | Medium |
| A4 | **Contrast**: `#888` on white is 3.5:1 — below WCAG AA (4.5:1) for the small text it's used on (status hints, tag counts, suggest hints, placeholder-ish text). `#999` (drag handles) is worse. Darken secondary text to ≥ `#6e6e6e`. | Medium |
| A5 | **Keyboard reach**: kebab menus (list/tag rename/delete) and drag handles are invisible until mouse hover and effectively unreachable by keyboard. Add `:focus-within` reveal + make rows a sensible tab sequence. The add-task input suppresses its focus outline entirely (`.text-input:focus` at `styles.css:145` is `outline: none` plus a border-color change). | High |
| A6 | **Motion**: menus/popovers/modals appear with instant display toggles (5 `transition` declarations in the entire stylesheet). Add 120–160ms fade/scale transitions behind a `prefers-reduced-motion` guard — the single cheapest "feels modern" change. | Medium |
| A7 | **Modal polish**: edit modal is near-fullscreen with mostly empty space (cap ~860px width, center); it has no title ("Edit task"); Settings labels wrap awkwardly ("Time format" on two lines); ✕/✓ icon-only round buttons carry no visible labels (aria-labels exist, but text labels "Cancel"/"Save" or tooltips would help). | Medium |
| A8 | **Inconsistencies**: tags show open-task counts, lists don't (add list counts); the add-task input is an underline style while search is a rounded bordered field — two input languages on one screen (unify toward the rounded style); "Search results" grouping headers reuse the page-title style at same weight (reduce hierarchy clash). | Low |
| A9 | Empty states are plain dashed boxes with text; fine, but tone/copy varies ("Nothing added yet. Enter a task and hit Add." vs "No tasks match your search"). Normalize copy, optionally add a small glyph. | Low |
| A11 | `styles.css` declares `.lists-search-input` twice (`:62` and `:1917`) in unrelated sections, and the file has no section ordering or token layer. Since the token migration touches every rule anyway, fold a consolidation pass into it. | Low |
| A12 | `BrowserWindow` sets no `backgroundColor` (`src/main.ts:664`), so the window paints white before first render. Invisible today; becomes a visible white flash on every launch the moment dark mode ships. Set it alongside the dark token set. | Low |

### Withdrawn

| # | Finding | Why withdrawn |
|---|---|---|
| ~~A10~~ | ~~No `BrowserWindow` `minWidth`/`minHeight`.~~ | **False.** `src/main.ts:667-668` already sets `minWidth: 600, minHeight: 480` (commit `01429bd`, an ancestor of HEAD). No action needed. If the header layout turns out to break between 600 and 640px, measure first and bump then — don't change it blind. |

## Plan (phased, each phase shippable)

Ordering note: the original draft put search polish first and tokens second. That was inverted, because Phase 2's new CSS (focus rings, stale-state colors) would have been written as hardcoded hexes one phase before every hardcoded hex was deleted. The token layer is a few hours of mechanical work and is the named prerequisite for Phases 2, 3, 4, and 5, so it goes first and everything after it is written in tokens natively. The cost is that the first shippable phase is visually near-invisible to users.

### Phase 1a — Design tokens (foundation, visually a no-op)
Files: `styles.css` (all rules mechanically migrated), `src/renderer/theme.ts` (new), `src/renderer/tasks.ts`, `src/renderer/modals.ts`, `index.html`.
1. `:root` tokens: `--bg`, `--surface`, `--surface-raised`, `--border`, `--border-strong`, `--text`, `--text-secondary`, `--text-faint`, `--accent`, `--danger`, `--radius-s/m/l`, `--shadow-menu/modal`, `--space-1..6`.
2. Replace all 172 hex literals with `var(...)`. **Strictly value-preserving** — no contrast or color changes in this phase, so the output is pixel-identical and a screenshot diff is a real regression test.
3. Deduplicate priority colors into one source (TS constant exported from a new `src/renderer/theme.ts`, consumed by `tasks.ts` and `modals.ts`; inline HTML swatches get classes instead of inline styles).
4. Consolidate the duplicate `.lists-search-input` blocks and impose section ordering on `styles.css` (A11).

Land this alone and merge it fast — it is a wide diff that will conflict with anything else in flight.

### Phase 1b — Typography & contrast
Files: `styles.css`.
1. System font stack + type scale (11/12/13/14/16); raise 10px metadata/chips to 11px. Monospace stack is already correct for query mode.
2. Contrast bumps (A4): secondary text `#888→#6e6e6e`, faint `#999→#8a8a8a` only where large.

Separated from 1a because a font-stack swap changes text metrics on every line — the pixel-diff check that protects 1a is pure noise here, so this phase is reviewed by eye.

### Phase 2 — Search-bar polish (highest user-visible value)
Files: `styles.css`, `src/renderer/querySearch.ts`, `src/renderer/query.ts`, `src/renderer/tasks.ts`, `index.html`.
1. Cap the field: `.lists-search-field { max-width: 680px; }` (keeps fluidity, fixes S1).
2. **Pending-token state (S3 + S4 together).** S3 and S4 are one bug: the grammar accepts barewords, so `tag` parses and `tag:` doesn't, and mid-token keystrokes are reported as errors against a result set that is silently stale. Fix it at the parser boundary rather than with a display timer: if the parse fails **at the final token** *and* the caret is at end-of-input, classify the query as `pending` rather than `invalid` — suppress the error, skip the re-filter, leave the results untouched. Model the status line as three explicit states:
   - `pending` — neutral hint, results unchanged, no dimming, no error.
   - `valid` — "✓ Valid query", results current.
   - `invalid` (parse fails somewhere other than a trailing token, or the caret has moved away from it) — show the ⚠ error, dim the tasks list (`.results-stale`, opacity ~0.55) with a "Showing last valid results" note, and never show the "No tasks match" empty box.

   This subsumes S3 with no timer and no suggest-open coupling. Fallback if the trailing-token classification proves fiddly in the grammar: debounce the *display* of the error by ~500ms and gate dimming on the error actually being visible, so results are never dimmed without an on-screen explanation.
3. Result count (S5): `updateTasksTitle` renders "Search results · N" (count from the same filter pass; export it or recompute cheaply).
4. Placeholder hint (S6): `Search (⌘F)` / `Search (Ctrl+F)`, platform-aware, simple mode only.
5. Custom focus ring (S2, part of A5): global `:focus-visible { outline: 2px solid var(--accent-focus); outline-offset: 2px; }` + `outline: none` on plain `:focus` for mouse users; remove the OS default ring on the search input and add-task input.

### Phase 3 — Keyboard & screen-reader accessibility
Files: `styles.css`, `tags.ts`, `lists.ts`, `querySearch.ts`, `tagInput.ts`, `index.html`.
1. `:focus-within` reveals hover-only controls (kebabs, drag handles); kebab buttons get visible focus rings.
2. Combobox ARIA for both autocompletes (S8): `role="combobox"` + `aria-expanded` on inputs, `role="listbox"/"option"` + `aria-activedescendant` on menus; announce selection.
3. `aria-live="polite"` on the search status line so parse feedback is announced. Note the interaction with Phase 2: the `pending` state should not be announced, or every keystroke chatters.
4. Sidebar rows: make list/tag pills real buttons (they're divs today) for correct tab order and Enter/Space activation.
5. Verify focus is actually trapped in the `role="dialog" aria-modal="true"` overlays (`index.html:145, 256, 271, 286, 328`) — the attributes are present but the behavior is unconfirmed.

### Phase 4 — Motion, modals, consistency
Files: `styles.css`, `index.html`, `modals.ts`.
1. Transitions: opacity/transform 140ms ease-out on `.list-menu`, suggest menus, help popover, overlays (class-based show/hide instead of raw `display` where needed — smallest viable refactor: keep display toggles, animate via `@starting-style` or add/remove an `.open` class); wrap in `@media (prefers-reduced-motion: no-preference)`. `@starting-style` is safe here — Electron 39 ships Chromium ~142.
2. Edit modal: max-width 860px, centered; add "Edit task" heading; Settings: side-by-side labels fixed (no wrap), text labels on Save/Cancel.
3. List counts in the sidebar (match tags); unify add-task input to the rounded field style; soften search grouping headers (13px/600 vs page title).

### Phase 5 — Dark mode (after Phase 1a)
Files: `styles.css`, `src/main.ts`.
1. Dark token set under `@media (prefers-color-scheme: dark)` (+ optional explicit setting later).
2. Set `BrowserWindow.backgroundColor` (A12) to the dark surface token when the OS reports dark, otherwise the light one — without it, every launch flashes white before first paint.
3. Audit: pastel tag palette gets a dark-mode variant (same hues, lower luminance backgrounds with light text), priority fills likewise; screenshots of every surface in both schemes.

## Verification (per phase)

Drive a parallel instance (playwright-core, `--user-data-dir` scratch profile + `ADEO_API_URL` pointed at a scratch-DB API — note that `ADEO_DB_PATH` is ignored by the spawned API, so the scratch DB must be supplied via a separately-started API process) with the rich seed dataset; screenshot: main view, search simple/advanced/suggest/error/empty, edit modal, settings, narrow window. Phase-specific checks:
- **P1a**: screenshot diff against pre-migration must be **empty** — any delta is a bad substitution. `node scripts/query-selftest.mjs` still green.
- **P1b**: visual review only (font metrics shift every line; a pixel diff proves nothing here). Spot-check contrast ratios of the changed grays.
- **P2**: mid-token typing (`tag:`) shows no error and does not re-filter; a genuinely broken query (`tag:x AND AND`) dims results with the note; count in title; field capped at a 1600px window; custom focus rings on Tab.
- **P3**: Tab-walk reaches kebabs/suggest; probe `aria-*` attributes in DOM; confirm dialogs trap focus.
- **P4**: transition smoke (menu opens animated, reduced-motion disables).
- **P5**: both schemes screenshot matrix; cold-launch in dark mode shows no white flash.

## Verified against code

The findings above were re-checked against the tree on 2026-08-09. A2, A1, A3, A4, A5, A6, S1, S2, S4, and S6 were each confirmed at the file/line references now inlined in the tables. A10 was found to be false and is withdrawn. A11 and A12 were added during that pass.

## Explicitly out of scope
Saved filters, `created` query field, layout re-architecture, framework adoption — unchanged from earlier plans.
