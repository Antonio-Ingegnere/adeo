# UI/UX Modernization Plan

Based on a hands-on review of the running app (2026-08-09, commit `3cb11f9`) against current desktop UI/UX practice, with special attention to the search bar. Findings were captured by driving a live instance with representative data (lists, tags, priorities, reminders, repeats, markdown details, completed tasks) and probing keyboard/focus behavior.

## Findings

### Search bar (priority area)

| # | Finding | Severity |
|---|---|---|
| S1 | The fluid field now stretches edge-to-edge (~1900px at wide windows). Line lengths that long are hard to scan and look unbalanced; every major app caps its toolbar search (~600-720px). | Medium |
| S2 | Focus ring is the OS default (`outline: auto`) — a loud accent-colored double ring that fights the input's rounded shape. No consistent custom `:focus-visible` styling anywhere in the app. | Medium |
| S3 | **Premature error display**: typing `tag:` shows a red "⚠ Expected value after tag:" *while the autocomplete dropdown is open offering the values* — the user is mid-token and being told they're wrong. Errors should surface only after a short idle (~500ms) or when the suggest dropdown is closed. | High |
| S4 | **Stale-results confusion**: incremental typing makes intermediate barewords valid (`tag` before `tag:`), so an invalid query shows last-good results that can be "No tasks match your search" *plus* a red error — two conflicting signals. The results area should visually indicate staleness (e.g. reduced opacity) while the query is invalid, and the empty-state should not claim "no match" for a stale predicate. | High |
| S5 | "Search results" title has no result count. Add "Search results · 3" (and "0 results" instead of relying on the empty box alone). | Low |
| S6 | No discoverability of Cmd/Ctrl+F: placeholder should hint it (`Search ⌘F` / `Ctrl+F`, platform-aware). | Low |
| S7 | Advanced mode discoverability rests entirely on the small ‹/› glyph. Add a tooltip is present (title attr) but consider showing the "?" help affordance in simple mode too, or a first-use hint. | Low |
| S8 | Autocomplete has no ARIA combobox semantics (`role="combobox"`, `aria-expanded`, `aria-activedescendant`, `role="listbox/option"`), so screen readers announce nothing. Same for the add-box tag autocomplete. | Medium |

### App-wide

| # | Finding | Severity |
|---|---|---|
| A1 | **Typography**: `font-family: Arial` (dated, non-native). Use the system stack (`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`). Metadata is 10px (task reminder line, chips) — below comfortable minimums; establish a type scale (11/12/13/14/16) and stop at 11px. | High |
| A2 | **No design tokens**: every color is a hardcoded hex repeated across 2000+ lines (grays `#444/#666/#888/#d6d6d6/#e0e0e0`, blue `#1d72f3`, priority colors duplicated in 2 TS files + HTML). Introduce `:root` CSS custom properties (color, spacing, radius, shadow). This is the prerequisite for dark mode and for consistent restyling. | High |
| A3 | **No dark mode** — the most-expected modern feature for a desktop app. After A2, add a `prefers-color-scheme: dark` token set (and optionally a settings override). | Medium |
| A4 | **Contrast**: `#888` on white is 3.5:1 — below WCAG AA (4.5:1) for the small text it's used on (status hints, tag counts, suggest hints, placeholder-ish text). `#999` (drag handles) is worse. Darken secondary text to ≥ `#6e6e6e`. | Medium |
| A5 | **Keyboard reach**: kebab menus (list/tag rename/delete) and drag handles are invisible until mouse hover and effectively unreachable by keyboard. Add `:focus-within` reveal + make rows a sensible tab sequence. The add-task input suppresses its focus outline entirely (border-bottom color change only). | High |
| A6 | **Motion**: menus/popovers/modals appear with instant display toggles. Add 120–160ms fade/scale transitions behind a `prefers-reduced-motion` guard — the single cheapest "feels modern" change. | Medium |
| A7 | **Modal polish**: edit modal is near-fullscreen with mostly empty space (cap ~860px width, center); it has no title ("Edit task"); Settings labels wrap awkwardly ("Time format" on two lines); ✕/✓ icon-only round buttons carry no visible labels (aria-labels exist, but text labels "Cancel"/"Save" or tooltips would help). | Medium |
| A8 | **Inconsistencies**: tags show open-task counts, lists don't (add list counts); the add-task input is an underline style while search is a rounded bordered field — two input languages on one screen (unify toward the rounded style); "Search results" grouping headers reuse the page-title style at same weight (reduce hierarchy clash). | Low |
| A9 | Empty states are plain dashed boxes with text; fine, but tone/copy varies ("Nothing added yet. Enter a task and hit Add." vs "No tasks match your search"). Normalize copy, optionally add a small glyph. | Low |
| A10 | No `BrowserWindow` `minWidth/minHeight` — the layout can be crushed below usable width. Set ~640×480 minimums in `main.ts`. | Low |

## Plan (phased, each phase shippable)

### Phase 1 — Search-bar polish (highest user-visible value)
Files: `styles.css`, `src/renderer/querySearch.ts`, `src/renderer/tasks.ts`, `index.html`.
1. Cap the field: `.lists-search-field { max-width: 680px; }` (keeps fluidity, fixes S1).
2. Error debounce (S3): keep parsing every keystroke, but only *display* the ⚠ status after ~500ms without input **and** when the suggest dropdown is closed; show a neutral "…" state meanwhile. (`renderSearchStatus` gains a small timer; suggest-open check via existing module state.)
3. Stale-results treatment (S4): when `queryError !== null`, add a `.results-stale` class to the tasks list (opacity ~0.55 + "Showing last valid results" note next to the title) instead of pretending the stale result set is current; never show the "No tasks match" empty box while the query is invalid.
4. Result count (S5): `updateTasksTitle` renders "Search results · N" (count from the same filter pass; export it or recompute cheaply).
5. Placeholder hint (S6): `Search (⌘F)` / `Search (Ctrl+F)` via `navigator.platform`, simple mode only.
6. Custom focus ring (S2, part of A5): global `:focus-visible { outline: 2px solid #4c9ffe; outline-offset: 2px; }` + `outline: none` on plain `:focus` for mouse users; remove the OS default ring on the search input and add-task input.

### Phase 2 — Design tokens + typography (foundation)
Files: `styles.css` (top), all rules mechanically migrated; `src/renderer/tasks.ts`/`modals.ts` priority-color maps read from CSS vars via `getComputedStyle` or stay TS-side but sourced from one exported constant.
1. `:root` tokens: `--bg`, `--surface`, `--surface-raised`, `--border`, `--border-strong`, `--text`, `--text-secondary`, `--text-faint`, `--accent`, `--danger`, `--radius-s/m/l`, `--shadow-menu/modal`, `--space-1..6`.
2. Replace hex literals with `var(...)` (mechanical; keep visual output identical except A4 contrast bumps: secondary text `#888→#6e6e6e`, faint `#999→#8a8a8a` only where large).
3. System font stack + type scale; raise 10px metadata/chips to 11px; monospace stack already correct for query mode.
4. Deduplicate priority colors into one source (TS constant exported from a new `src/renderer/theme.ts`, consumed by `tasks.ts`, `modals.ts`; inline HTML swatches get classes instead of inline styles).

### Phase 3 — Keyboard & screen-reader accessibility
Files: `styles.css`, `tags.ts`, `lists.ts`, `querySearch.ts`, `tagInput.ts`, `index.html`.
1. `:focus-within` reveals hover-only controls (kebabs, drag handles); kebab buttons get visible focus rings.
2. Combobox ARIA for both autocompletes (S8): `role="combobox"` + `aria-expanded` on inputs, `role="listbox"/"option"` + `aria-activedescendant` on menus; announce selection.
3. `aria-live="polite"` on the search status line so parse feedback is announced.
4. Sidebar rows: make list/tag pills real buttons (they're divs today) for correct tab order and Enter/Space activation.

### Phase 4 — Motion, modals, consistency
Files: `styles.css`, `index.html`, `modals.ts`, `main.ts`.
1. Transitions: opacity/transform 140ms ease-out on `.list-menu`, suggest menus, help popover, overlays (class-based show/hide instead of raw `display` where needed — smallest viable refactor: keep display toggles, animate via `@starting-style` or add/remove an `.open` class); wrap in `@media (prefers-reduced-motion: no-preference)`.
2. Edit modal: max-width 860px, centered; add "Edit task" heading; Settings: side-by-side labels fixed (no wrap), text labels on Save/Cancel.
3. List counts in the sidebar (match tags); unify add-task input to the rounded field style; soften search grouping headers (13px/600 vs page title).
4. `minWidth: 640, minHeight: 480` on the BrowserWindow.

### Phase 5 — Dark mode (after Phase 2)
1. Dark token set under `@media (prefers-color-scheme: dark)` (+ optional explicit setting later).
2. Audit: pastel tag palette gets a dark-mode variant (same hues, lower luminance backgrounds with light text), priority fills likewise; screenshots of every surface in both schemes.

## Verification (per phase)

Drive a parallel instance (playwright-core, `--user-data-dir` scratch profile + `ADEO_API_URL` to a scratch-DB API — see project memory) with the rich seed dataset; screenshot: main view, search simple/advanced/suggest/error/empty, edit modal, settings, narrow window. Phase-specific checks:
- P1: error appears only after idle; stale dimming + note during invalid query; count in title; capped field at 1600px window; custom focus rings on Tab.
- P2: pixel-compare pre/post screenshots (expect only font + contrast deltas); `node scripts/query-selftest.mjs` still green.
- P3: Tab-walk reaches kebabs/suggest; probe `aria-*` attributes in DOM.
- P4: transition smoke (menu opens animated, reduced-motion disables); window cannot shrink below min.
- P5: both schemes screenshot matrix.

## Explicitly out of scope
Saved filters, `created` query field, layout re-architecture, framework adoption — unchanged from earlier plans.
