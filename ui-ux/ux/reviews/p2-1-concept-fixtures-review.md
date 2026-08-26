# P2.1 implementation review: concept fixtures and dependency boundary

**Status:** DONE — REVALIDATED 2026-08-25 (reopened same day for app-shell coverage)
**Reviewer:** Codex implementation verification
**Review date:** 2026-08-24
**Reopened and revalidated:** 2026-08-25
**Reopened again (app-shell coverage):** 2026-08-25
**Classification:** Approved design-lab infrastructure; no product-direction change
**Production base:** `70c3d67` plus the isolated P2.1/P2.2 UX worktree diff
**Build under review:** `npm run build` and `npm run storybook:build`

## Outcome

P2.1 is complete after a production-style fidelity correction. Storybook has a top-level `Concepts` hierarchy with the stable story
`concepts-fixture-catalog--deterministic-states`. Its populated, empty, and recoverable-error
fixtures use fixed IDs, a fixed ISO clock, explicit task/tag data, and runtime-frozen arrays
and objects. They do not read Electron services, application state, the current time, or
random values.

The user reopened P2.1 after the catalog was found to represent tasks with invented left-edge
priority stripes and custom cards. That presentation was removed. The fixture catalog and P2.2
stories now share `concepts/production-task-preview.ts`, which mirrors production task order and
uses `.tasks-list`, `.task-row`, `.drag-handle`, the circular checkbox with `setPriorityAttr`,
`.task-main`, `.task-reminder`, `.task-tags`, production tag chips, completion strike-through,
`.task-details`, `.expand-btn`, `.expand-chevrons`, and `.empty-state`. The populated state includes
one expanded and one collapsed details row. No concept stylesheet restyles those task elements.

The fixture catalog also consumes production sidebar pills, shortcut keycaps, CSS, and design
tokens. The reverse direction is blocked: `npm run check:ux-boundary` scans
production TypeScript, JavaScript, Python, CSS, and HTML imports and fails when a resolved
specifier enters `ui-ux/ux`. The guard includes a rejecting self-check and runs before both
the production and Storybook builds. The production `dist` contains no concept markers.

## Reopened expandable-task finding

**P2.1-F02 — production expandable tasks were omitted**

- Expected: tasks with details use production `.task-details` inside `.task-main` and the
  production `.expand-btn`/`.expand-chevrons` control at the right edge.
- Previous: the shared preview did not carry fixture details or render the expansion control.
- Correction: deterministic tasks now carry explicit details and initial expansion state. The
  shared preview uses the production Markdown details renderer, classes, double-chevron paths,
  titles, and toggle behavior.
- Revalidation: the catalog renders four details controls across populated/error fixtures, with
  two initially expanded and two collapsed. Toggling expands the hidden details, changes the
  control to Collapse, and restores focus. **Finding status: CLOSED.**

**P2.1-F03 — expanded details did not visibly demonstrate Markdown support**

- Expected: the deterministic expanded state proves that task details use Adeo's production
  Markdown renderer rather than displaying only unformatted prose.
- Previous: the details example contained a paragraph and bullets, which did not visibly
  distinguish Markdown rendering from hand-authored DOM.
- Correction: the expanded fixture now renders a level-two heading, bold text, inline code, bullet
  list, horizontal rule, and paragraphs through `createDetailsElement`.
- Revalidation: Chrome found the expected `h2`, `strong`, `code`, list items, `.md-hr`, and paragraph
  nodes in P2.1 and every P2.2 alternative. **Finding status: CLOSED.**

## Reopened 2026-08-25: app-shell coverage

The user reopened P2.1 a second time the same day, after the fidelity-corrected catalog above
was reviewed: it still only ever showed one flat task list in an isolated Storybook card, so it
did not represent enough of Adeo's real feature surface to be useful as a design lab. Asked which
gaps to close, the user selected all four: no app shell/sidebar, no list/smart-list variety, no
recurring-task/reminder states, and no interaction coverage (drag-reorder, view picker, keyboard).

**P2.1-F04 — no sidebar or app-shell context**

- Expected: concept comparisons render inside the real Lists/Smart lists/Tags sidebar
  (`.lists-rail`, `.lists-panel`, `.lists-header`, `.list-pill`), not an isolated card.
- Previous: the catalog and Quick Add pilot showed only a compose row and task list.
- Correction: added `concepts/app-shell-preview.ts`, a new `AppShell` story
  (`concepts-fixture-catalog--app-shell`) rendering the production `.content-grid` /
  `.lists-rail` / `.main-column` structure, with all three sidebar panels built from the real
  `createSidebarPill` factory (`src/renderer/uiElements.ts`) and manual `.tag-pill` markup
  mirroring `src/renderer/tags.ts`. The existing `DeterministicStates` story and its stable ID are
  unchanged.
- Revalidation: a headless Chromium check (see Verification) confirmed `.lists-rail`,
  3 `.lists-panel` sections, and populated `.list-pill`/`.smart-list-pill`/`.tag-pill` elements at
  all four required viewports/themes.
- **Note:** the sidebar panels' "+" add-item buttons and per-pill "more" menus (rename/delete) are
  intentionally omitted — production wires those to `window.electronAPI`, and reproducing them
  would either fake persistence or require stubbing Electron, neither appropriate for a
  deterministic concept fixture. **Finding status: CLOSED (with documented scope cut).**

**P2.1-F05 — no list/smart-list variety or aggregation**

- Expected: fixtures demonstrate multiple lists, a smart list, and an "All lists" aggregate, with
  real switching between them.
- Previous: fixtures used one flat task array under a single `activeList` string.
- Correction: `fixtures.ts` adds `conceptShellFixture` with two lists (Work, Personal), one smart
  list (Today), a tags panel, and `tasksByView` mapping each view to its own deterministic task
  set. `app-shell-preview.ts` wires a real, production-marked-up view picker
  (`.view-picker` / `.view-menu[role=listbox]`) that switches the active view and re-renders the
  task list, list-pill selection state, and sidebar counts accordingly.
- Revalidation: the headless check opened the menu, selected "Personal", and confirmed the label
  updated to "Personal" and the task list changed to exactly the one Personal-list task
  ("Pick up groceries") at all four viewport/theme cases.
- Full query-syntax search (typing a filter expression) was intentionally left out of scope: it is
  a separate, much larger feature (`query.ts`/`searchMatches.ts`) not required to demonstrate list
  variety or aggregation, and forcing it in risked exactly the kind of invented/partial concept
  code this project has twice had to correct. **Finding status: CLOSED (with documented scope
  cut).**

**P2.1-F06 — no recurring-task or reminder states**

- Expected: a fixture task shows an active reminder and a recurring badge using production
  markup (`.task-reminder`, `.task-repeat`, `.task-repeat-icon`) and the real
  `repeatSummaryFromRule` helper (`src/renderer/repeat.ts`).
- Previous: no fixture task had a `repeatRule`, and `production-task-preview.ts` had no code path
  to render one.
- Correction: `ConceptTaskFixture` gained an optional `repeatRule` field. `production-task-preview.ts`
  now renders `.task-repeat`/`.task-repeat-icon` with `repeatSummaryFromRule(task.repeatRule)`
  exactly matching `src/renderer/tasks.ts` (~line 300-330), additively — existing fixtures/stories
  without a `repeatRule` are byte-for-byte unaffected. Two shell tasks demonstrate this: "Daily
  design standup" ("Every day") and "Consolidate research notes" ("Every week on Monday"),
  alongside existing reminder-only tasks.
- Revalidation: the headless check found `.task-repeat` present and `.task-reminder-text` reading
  "Today, 10:00" at all four cases; the evidence screenshots show both the reminder time and the
  repeat icon/text rendering correctly in light and dark. **Finding status: CLOSED.**

**P2.1-F07 — no interaction coverage (drag-reorder, view picker, keyboard)**

- Expected: sidebar drag-and-drop reorder, the view-picker dropdown, and keyboard task navigation
  are genuinely wired, not simulated.
- Previous: none of the three existed in any concept file.
- Correction:
  - Sidebar drag-reorder on the Lists (and Smart lists/Tags) panels uses the real, dependency-free
    `attachPillDnD` from `src/renderer/pillDnD.ts` against a local fixture-array reorder callback
    — the same function production uses, not a reimplementation.
  - The view-picker dropdown (open/close, `aria-expanded`, outside-click-to-close, `role=listbox`
    options) is self-contained concept code because `viewBar.ts` reads global renderer `state`
    (flagged production-only in `component-inventory.md`), but reuses its exact markup/classes.
  - `production-task-preview.ts` gained a roving arrow-key cursor (Up/Down/Home/End) across
    `.task-row` elements, shared by both the fixture catalog and (unchanged) P2.2 stories.
- Revalidation: a headless Chromium script dispatched a real HTML5 `dragstart`/`dragover`/`drop`
  sequence against the Lists panel and confirmed pill order changed (`All lists, Work, Personal`
  → `All lists, Personal, Work`); confirmed the view menu opens/closes and Enter/click selection
  updates the view; confirmed `ArrowDown` moves DOM focus from one `.task-row` to the next. All
  four viewport/theme cases passed identically.
- **Deliberate limitation, not fixed:** task-row drag-and-drop (reordering tasks themselves) stays
  structural only — the existing `.drag-handle` renders, but reorder logic is not wired.
  Production task reordering is deeply coupled to `state.tasks`, IPC persistence, and focus
  restoration (`src/renderer/tasks.ts`); wiring a parallel implementation in a concept fixture
  would either fork that logic or fake persistence, and component-inventory.md already flags task
  rows as production-only pending a real extraction boundary. **Finding status: PARTIALLY CLOSED
  — sidebar DnD, view picker, and keyboard navigation are real; task-row DnD remains a known,
  documented gap.**

## Verification (2026-08-25 reopened pass)

The claude-in-chrome browser tool was not connected in this environment, so verification used a
headless Chromium (installed via `npx playwright install chromium` for this pass; the browser
binary itself is not part of any commit) driven directly with `playwright-core`, which was already
a project dependency. The script navigated `iframe.html?id=concepts-fixture-catalog--app-shell`
at each required viewport/theme combination and is not part of the repository (run from a
temporary, deleted scratch file).

```text
npm run check:ux-boundary       PASS (42 production files)
npm run build                   PASS
npm run storybook:build         PASS (no TypeScript errors, story indexed)
node scripts/query-selftest.mjs      PASS (103 cases)
node scripts/shortcuts-selftest.mjs  PASS (132 cases)
npm run test:isolation          PASS (34 checks)

Headless Chromium matrix (1440x900 light, 1024x768 dark, 768x1024 light, 390x844 dark):
  horizontal overflow            PASS x4 (scrollWidth === clientWidth at every case)
  sidebar/tag/smart-list/view-picker/task-list structure   PASS x4
  view-picker open + list switch (All lists -> Personal)   PASS x4
  keyboard roving cursor (ArrowDown moves task-row focus)   PASS x4
  sidebar drag-reorder (native DragEvent dragstart/dragover/drop)   PASS x4
  axe-core scan   0 violations x4 (36-37 passes each)
```

Evidence: [light desktop 1440](evidence/p2-1-shell-light-desktop-1440.jpg),
[dark mobile 390](evidence/p2-1-shell-dark-mobile-390.jpg).

## Requirement-to-evidence traceability

| Requirement / acceptance criterion | Evidence | Result |
|---|---|---|
| Add `ux/concepts/` under top-level `Concepts` | `.storybook/main.ts` explicitly discovers `ux/concepts/**/*.stories.ts`; the Storybook index contains the stable `Concepts/Fixture catalog` story | PASS |
| Create deterministic UI fixtures | `concepts/fixtures.ts` exports frozen populated, empty, and error fixtures with fixed IDs and `2026-08-24T09:30:00+02:00`; Chrome rendered the same three IDs and timestamps in all eight cases | PASS |
| Concepts may consume production components and tokens | The catalog imports production factories; the shared preview imports `createTagChip` and `setPriorityAttr`; Storybook loads production CSS and theme tokens | PASS |
| Existing task presentation matches production | Chrome found five task rows, matching drag/priority/main/reminder/tag structure, four detail expanders, two expanded states, production-rendered Markdown, and zero custom task cards or empty states | PASS |
| Production imports no UX concept code | `npm run check:ux-boundary` passed across 42 production files; its self-check rejects a representative `src/renderer` → `ui-ux/ux` import | PASS |
| Enforce direction at build time | `npm run build` and `npm run storybook:build` both execute the guard first | PASS |
| Keep concept code out of production output | Search of `dist` found no fixture IDs, catalog title, or catalog bundle marker | PASS |
| Preserve accessibility enforcement | The story inherits project-wide `a11y.test: 'error'`; light and dark each report zero violations | PASS |
| Preserve the spacing policy | Every concept-owned margin, padding, and gap uses `--space-*`; no exception is required | PASS |

## Chrome matrix

| Viewport | Light | Dark | Horizontal overflow |
|---|---:|---:|---:|
| 1440×900 | PASS | PASS | None |
| 1024×768 | PASS | PASS | None |
| 768×1024 | PASS | PASS | None |
| 390×844 | PASS | PASS | None |

All eight cases rendered the expected theme, three fixture IDs, fixed timestamp, recoverable
error, production task structure, expanded/collapsed details, 18px circular priority controls,
and zero horizontal overflow. At 1440px, each theme reports 0 axe violations, 30 passes, and 1
inconclusive contrast rule.
The rule covers symbol-only keycaps and production reminder/tag nodes whose background axe cannot
determine through `.task-row::after`. Manual ratios pass: keycap 14.85:1 light/14.48:1 dark,
reminder 5.74:1 light/7.10:1 dark, and Design tag 7.75:1 light/9.78:1 dark.

## Visual evidence

- [Light fixture catalog, desktop 1440](evidence/p2-1-fixtures-light-desktop-1440.jpg)
- [Dark fixture catalog, mobile 390](evidence/p2-1-fixtures-dark-mobile-390.jpg)

The refreshed captures confirm the three-column desktop catalog, single-column mobile flow,
readable fixed data, circular priority controls, production task order, expanded/collapsed details,
visible production Markdown formatting, double-chevron controls, `#tag` chips, completion
strike-through, light/dark theming, and the production empty state.

## Verification

```text
npm run check:ux-boundary
  PASS; guard self-check and 42 production files

npm run build
  PASS; dependency guard runs first

npm run storybook:build
  PASS; dependency guard runs first and concept story is indexed

Production dist concept-marker search
  PASS; no concept code markers found

node scripts/query-selftest.mjs
  PASS; all 103 query cases

node scripts/shortcuts-selftest.mjs
  PASS; all 132 shortcut cases

npm run test:isolation
  PASS; 34 checks and protected user data unchanged

Chrome rendered-state verification
  PASS; 8 of 8 theme/viewport cases, no horizontal overflow
  PASS; zero axe violations in light and dark

git diff --check
  PASS
```

## Gaps and next gate

- P2.1 deliberately supplies data and lab infrastructure only. It does not propose or imply
  approval of a Quick Add direction.
- Production persistence and editing remain outside deterministic fixtures. Details expansion,
  sidebar drag-reorder, the view picker, and task-row keyboard navigation are now genuinely
  interactive and local; none of it touches application or Electron state.
- Task-row drag-and-drop reorder is a documented, deliberate gap (P2.1-F07) — the drag handle
  renders but reorder is not wired, pending a real extraction boundary for `src/renderer/tasks.ts`.
- Full query-syntax search/filtering was intentionally left out of the app-shell fixture
  (P2.1-F05) as a separate, larger feature not needed to demonstrate list/smart-list variety.
- Sidebar "+" add-item buttons and per-pill rename/delete menus are intentionally omitted from the
  app-shell fixture (P2.1-F04) — they are Electron-backed in production and out of scope for a
  deterministic concept.
- The Markdown audit reproduced unlabeled production task-list checkboxes and heading-order risk
  for literal deep headings. Both are recorded in `../accessibility.md`; Storybook does not apply a
  concept-only fix or disable the relevant axe rules.
- P2.2 (Quick Add pilot) was not touched by this reopened pass and still renders inside an
  isolated preview card rather than the new app-shell context — adopting the shell there is a
  follow-up, not done here. P2.3 still requires explicit user review of the P2.2 evidence; nothing
  in this pass changes that gate.
- No real user/development database was accessed. Unrelated `.claude` changes were not
  modified. No git staging or commits were made.
