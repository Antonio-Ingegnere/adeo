# UX concept review: P2.2 Quick Add pilot

**Status:** PASS — READY FOR USER REVALIDATION
**Reviewer:** Product Design Agent
**Review date:** 2026-08-24
**Reopened:** 2026-08-25
**Reopened again (shell adoption):** 2026-08-25
**UX decision:** [0001: Quick Add direction](../decisions/0001-quick-add-direction.md)
**Source:** `70c3d67` plus the isolated P2.2 UX worktree changes
**Build under review:** `npm run storybook` and `npm run storybook:build`

## Outcome

The user reopened P2.2 after finding that its task preview invented a left-edge priority line and
two-column task card instead of using Adeo's circular priority checkbox and production task-row
layout, then identified an oval substitute for Adeo's circular Add button in the Compact direction.
A subsequent full-surface review found that the simulated application still used a custom view
header, composer card, input geometry, and metadata styling. Those substitutes were removed. The
simulated application now starts from Adeo's production task-view structure and classes; only the
explicit interaction proposed by each alternative may diverge. A fourth correction restored
production expandable-task details and chevrons that the shared preview had omitted. Visual,
responsive, interaction, focus, touch-target, and axe evidence was rerun in Chrome. P2.2 passed
technically at that point; decision 0001 remained `PROPOSED` pending the user's review.

The user then reviewed the P2.1 app-shell rebuild (real sidebar, list/smart-list variety,
recurring/reminder states, drag-reorder, view picker) and asked for P2.2 to adopt it, since each
alternative was still rendering in an isolated card with no sidebar. See "Reopened 2026-08-25: shell
adoption" below. This changes how the same three interaction proposals are presented; it does not
change what is being proposed, and decision 0001 still remains `PROPOSED` until the user reviews
the (now shell-based) evidence.

## Reopened finding

**P2.2-F01 — concept task context diverged from production**

- Expected: existing task presentation uses `styles.css` through the production structure from
  `src/renderer/tasks.ts`: drag handle, circular checkbox carrying `data-priority`, task main
  content, reminder, and tag chips.
- Previous: `quick-add-pilot.css` styled custom `<li>` cards with a priority-colored left border,
  and `quick-add-pilot.stories.ts` placed title, metadata, and Open/Completed text in a custom
  grid.
- Correction: custom task-row CSS is removed; the concept now renders `.tasks-list`,
  `.task-row`, `.drag-handle`, the production checkbox priority mapping, `.task-main`,
  `.task-reminder`, `.task-tags`, and shared production tag chips in production order.
- Revalidation: Chrome passed all viewport/theme, interaction, focus, visual, and axe checks
  recorded below. **Finding status: CLOSED.**

**P2.2-F02 — Compact Add control was oval instead of matching production**

- Expected: the Compact/current-direction Add control matches `#add-button` in production: a
  `.primary-button.icon-btn` with a fixed 34×34 circular box and the 20×20 `.icon-add` SVG.
- Previous: the concept used a text `+` inside `.quick-add-submit--icon`; its custom minimum height
  and the stretching compose row produced an oval control.
- Correction: Compact now uses the production `.primary-button.icon-btn` classes and the exact
  production plus SVG; the obsolete custom icon-submit rule was removed.
- Revalidation: Chrome measured 34×34, `border-radius: 50%`, zero border and padding, and a 20×20
  icon at desktop and 390px; no horizontal overflow occurred. Add still creates the task, clears
  the draft, announces success, and restores input focus. **Finding status: CLOSED.**

**P2.2-F03 — the surrounding simulated application used a concept-only visual system**

- Expected: all existing Adeo UI in the comparison uses production structure and CSS. A concept
  may diverge only where the alternative explicitly proposes a new interaction.
- Previous: `.quick-add-mock-app`, `.quick-add-context`, `.quick-add-composer`,
  `.quick-add-compose-row`, and `.quick-add-input` created a rounded mock-app card, custom heading,
  bordered composer card, and non-production input geometry. That made unchanged application UI
  look like part of the proposal.
- Correction: every story now uses production `.view-bar`, `.view-picker`, `.view-count`,
  `.compose-block`, `.input-row`, `.add-task-input-wrap`, `.text-input`, `.primary-button.icon-btn`,
  `.tag-suggest-menu`, `.tag-suggest-item`, `.template-chip`, and production task presentation.
  Compact and Command retain the 34px production input/Add row. Touch-first alone keeps an explicit
  44px composer because that is the alternative being evaluated. Storybook fixture controls are
  visibly labelled “not part of Adeo.”
- Revalidation: 24 cases (three alternatives × four widths × two themes) reported the required
  production structure, exact baseline geometry where applicable, zero obsolete mock-shell nodes,
  and no horizontal overflow. **Finding status: CLOSED.**

**P2.2-F04 — production expandable tasks were absent from every alternative**

- Expected: a task with details renders production `.task-details` within `.task-main` and an
  `.expand-btn` containing `.expand-chevrons` at the row's right edge.
- Previous: concept fixtures had no details data, and the shared task renderer stopped after tags.
- Correction: the populated/error fixtures now include deterministic expanded and collapsed
  details. The shared renderer uses production Markdown detail parsing, CSS classes, double-chevron
  paths, titles, and interactive expansion.
- Revalidation: every alternative starts with two expanders, one expanded details block, and one
  collapsed block. Clicking Expand reveals the second block, changes the control to Collapse, and
  restores focus. All 24 P2.2 viewport/theme cases retain this state without overflow.
  **Finding status: CLOSED.**

**P2.2-F05 — expanded details did not visibly prove Markdown support**

- Expected: the expanded example demonstrates Adeo's production Markdown treatment.
- Previous: details used only plain prose and bullets, so the rendered state did not communicate
  support for headings, emphasis, code, or separators.
- Correction: the shared expanded fixture now passes a level-two heading, bold text, inline code,
  bullets, horizontal rule, and paragraphs through production `createDetailsElement`.
- Revalidation: all three alternatives rendered the expected `h2`, `strong`, `code`, list,
  `.md-hr`, and paragraph nodes without overflow; six P2.2 light/dark axe scans reported zero
  violations. **Finding status: CLOSED.**

## Reopened 2026-08-25: shell adoption

P2.1 was reopened the same day and gained a real app-shell fixture (`concepts/app-shell-preview.ts`):
the actual Lists/Smart lists/Tags sidebar, multiple lists, a smart list, recurring/reminder badges,
sidebar drag-reorder, and a working view picker (see `p2-1-concept-fixtures-review.md`, findings
P2.1-F04–F07). That pass explicitly left P2.2 untouched, so each Quick Add alternative still
rendered inside its own isolated `.quick-add-adeo-canvas` card with no sidebar — the same isolation
problem P2.1 had just fixed elsewhere. The user confirmed the shell looked good and asked to bring
P2.2 onto it.

**P2.2-F06 — each alternative rendered in isolation instead of inside the real app shell**

- Expected: comparing Quick Add directions means comparing them inside Adeo's actual layout
  (sidebar included), consistent with how P2.1's fixture catalog now renders.
- Previous: `createQuickAddPilot` built its own `.quick-add-adeo-canvas` mock (a view-bar +
  input-row + task list) with no `.lists-rail`/`.lists-panel` sidebar at all.
- Correction: `app-shell-preview.ts`'s `createAppShellPreview` gained an injectable-composer option
  (`options.composer`) plus a handle (`selectView`, `setViewTasks`, `setComposer`) so a caller can
  mount a custom composer into the shell's real `.compose-block` and update the task list without
  tearing down the sidebar/view-picker. `quick-add-pilot.stories.ts` now builds each alternative's
  existing composer (`createCompactComposer`/`createCommandComposer`/`createTouchComposer`,
  interaction logic unchanged) and mounts it into the shared shell via `createAppShellPreview(...,
  { composer })`; the old `.quick-add-adeo-canvas`/`.quick-add-main-body` mock and its now-dead CSS
  were removed.
- Tag-set consistency: the shell's Tags panel for this story uses this file's own
  `quickAddShellTags` (derived from the same `Design`/`Planning`/`Personal` set the composer's
  `#tag` suggestions already offered), not `conceptShellFixture.tags` (`Design`/`Planning`/`Urgent`,
  P2.1's own set) — so the sidebar Tags panel always matches exactly what the composer can add.
  The reused Work/Personal lists and Today smart list carry no tasks in this story (switching to
  them shows the real production empty state) rather than tasks tagged from P2.1's different tag
  set.
- Revalidation: a headless Chromium pass (see Verification) confirmed the sidebar
  (`.lists-rail`, 3 `.lists-panel` sections), view-picker, composer, and task rows are all present
  together at all four required viewport/theme cases for all three alternatives, with zero
  horizontal overflow. **Finding status: CLOSED.**

**P2.2-F07 — interactions had to be reverified after the shell swap**

- Expected: submit/blank/error announcements, the view-picker, and sidebar drag-reorder all still
  work with a Quick Add composer mounted in the shared shell.
- Revalidation: for all three alternatives, the headless check opened the view-picker menu, typed
  and submitted a task (task appeared in the list, status announced it, focus returned to the
  input), submitted blank (announced `Enter a task before adding.`), and dragged the Work list pill
  past Personal in the Lists panel (order changed from `All lists, Work, Personal` to `All lists,
  Personal, Work`) — all without rebuilding the sidebar. **Finding status: CLOSED.**
- Not re-touched by this pass: the save-error retry path and the tag-suggestion/command-palette/
  touch-tag-surface keyboard interactions already covered by P2.2-F01–F05 above use the same
  composer code, unchanged, and were not expected to regress; they were not re-run exhaustively
  here beyond the submit/blank checks.

## Alternatives for the P2.3 decision

| Alternative | Stable Storybook ID | Benefits | Trade-offs | Estimated implementation complexity |
|---|---|---|---|---|
| Compact/current-direction | `concepts-quick-add-pilot--compact-current-direction` | Best continuity with Adeo's current fast, dense capture loop; optional metadata stays progressive | Metadata is less discoverable; the compact row adapts less naturally to narrow mobile widths | Low–medium |
| Command-style | `concepts-quick-add-pilot--command-style` | Fastest path for keyboard-heavy users; commands and tags share one predictable palette | Requires syntax learning, parsing, and careful conflict/error handling; weakest fit for mobile discovery | High |
| Touch-first | `concepts-quick-add-pilot--touch-first` | Strongest touch and metadata discoverability; no hover or command knowledge required | Uses the most space and can slow plain capture by exposing more choices | Medium–high |

The table itself is not approval. The earlier Compact/current-direction preference remains review
history, but decision 0001 is `PROPOSED` until the corrected comparison is explicitly reviewed.

## Requirement-to-evidence traceability

| Requirement / acceptance criterion | Evidence | Result |
|---|---|---|
| Three separate interactive stories with stable IDs | Story IDs listed above and present in the Storybook build index | PASS |
| Benefits, trade-offs, complexity, keyboard, error, and platform implications | Visible `Evaluation` section beside every interactive preview | PASS |
| 1440, 1024, 768, and 390px in light and dark | Corrected 24-case P2.2 matrix passed with the requested theme/width and zero horizontal overflow | PASS |
| Deterministic success, blank, and save-error behavior | Chrome reran all three stories: success added the task and restored focus; blank named the missing task; failure preserved the draft and focus | PASS |
| Existing task presentation matches production structure and style | Every case used production task classes/order, circular priorities, tags, expandable details, Markdown rendering and chevrons; zero custom task cards remained | PASS |
| Compact Add control matches production | Production `.primary-button.icon-btn` and `.icon-add` SVG; Chrome measured a 34×34 circle with a 20×20 icon at desktop and mobile | PASS |
| Existing task-view surface matches production | All stories use production view, compose, input, suggestion, metadata, Add, and task classes; Compact and Command measured 34px input/Add geometry | PASS |
| P1.2 spacing scale | Concept stylesheet spacing declarations use `--space-*`; no exception is present | PASS |
| No production-data or Electron dependency | Stories import deterministic fixtures and production presentation helpers only; no database, Electron bridge, current time, or randomness | PASS |
| User approval recorded before handoff | Decision 0001 returned to `PROPOSED` when P2.2 reopened | PENDING |

## Interaction evidence

The following interactions were rerun against the corrected stories.

- Expandable tasks: Compact, Command, and Touch-first each rendered one expanded and one collapsed
  details row. Expand revealed the hidden production details, changed to Collapse, and restored
  focus to the re-rendered control.

- Compact/current-direction: `#p` selection added Planning without losing Design; Arrow and
  Enter selected suggestions; Escape closed suggestions and Options with focus restoration.
  The corrected production row added `Validate compact Adeo parity`, cleared the draft, announced
  success, and returned focus. Blank submit announced
  `Enter a task before adding.` Save error announced `Could not save the task. Keep the draft
  and try again.` while preserving the draft.
- Command-style: `/h` selected High priority and removed the command from `Plan`;
  Arrow, Enter, and Escape operated the palette. Enter added the task and restored input
  focus. The corrected success row retained the production circle/tag structure. Blank and save-error announcements matched the brief, and the save-error draft
  remained `Schedule project follow-up`.
- Touch-first: Tags opened the named `Choose tags` dialog and focused Design; Escape closed
  it and returned focus to Tags. Today and Priority remained explicit. Enter added
  `Validate touch Adeo parity` and restored focus. Blank and save-error announcements matched the
  brief, and the error draft was preserved.

## Accessibility review

- Six axe scans covered three alternatives × light/dark after the full-surface correction.
- All six scans reported zero violations, 30 passes, and one inconclusive contrast rule. Axe cannot
  determine the background of inherited reminder/tag nodes through the production
  `.task-row::after` pseudo-element. Previously measured manual ratios still pass: reminder
  5.36:1 light/7.66:1 dark and Design tag 7.75:1 light/9.78:1 dark.
- The Markdown audit also reproduced two production debts: task-list checkboxes lack accessible
  names, and literal deep heading levels can violate heading order. Both are recorded in
  `../accessibility.md`; neither was patched only in Storybook or suppressed from axe.
- Keyboard focus, dismissal, restoration, accessible names, expanded/pressed state, status,
  and alert behavior were manually verified.
- At 390px, every actionable touch-first control measured at least 44px high: Today,
  Priority, Tags, four tag options, the removable selected-tag chip, and Add task.
- The production task checkbox remains 18px, accurately exposing the existing responsive debt
  already owned by P5.4 rather than concealing it with concept-only styling.

## Responsive review

| Viewport | Themes | Stories | Result |
|---|---|---:|---|
| 1440 × 900 | Light and dark | 3 | PASS — correct direction/theme, required evaluation sections and fixtures, no horizontal overflow |
| 1024 × 768 | Light and dark | 3 | PASS — same checks |
| 768 × 1024 | Light and dark | 3 | PASS — same checks |
| 390 × 844 | Light and dark | 3 | PASS — single-column adaptation and no horizontal overflow |

## Visual evidence

| Alternative | 1440 light | 390 dark |
|---|---|---|
| Compact/current-direction | [desktop](evidence/p2-2-compact-desktop-1440-light.jpg) | [mobile](evidence/p2-2-compact-mobile-390-dark.jpg) |
| Command-style | [desktop](evidence/p2-2-command-desktop-1440-light.jpg) | [mobile](evidence/p2-2-command-mobile-390-dark.jpg) |
| Touch-first | [desktop](evidence/p2-2-touch-desktop-1440-light.jpg) | [mobile](evidence/p2-2-touch-mobile-390-dark.jpg) |

These screenshots were recaptured again on 2026-08-25 to show the shell-adoption pass below (same
filenames): the real Lists/Smart lists/Tags sidebar and view picker now frame the same production
task-view surface, compose row, circular Add control, and metadata. They use deterministic fixtures
only; no development database or Electron `userData` directory was opened.

## Verification

- `npm run build`
- `npm run storybook:build`
- `npm run check:ux-boundary`
- `node scripts/query-selftest.mjs`
- `node scripts/shortcuts-selftest.mjs`
- `npm run test:isolation`
- Browser interaction, axe, viewport, overflow, and touch-target checks described above

### 2026-08-25 shell-adoption pass

All six commands above passed again after the shell-adoption change. The `claude-in-chrome` tool
was not connected in this environment (confirmed by a direct tool error, not assumed), so browser
verification used a local Storybook dev server (`npm run storybook`) driven by `playwright-core`
(already a project dependency; the headless Chromium binary itself is not part of any commit) from
a temporary scratch script, deleted after use, for all three alternatives × the four required
viewports × light/dark:

```text
Structure (sidebar + view-picker + composer + task rows present together)   PASS x24
Horizontal overflow                                                          PASS x24 (none)
Interaction (view-menu opens, submit adds + announces, blank submit)         PASS x9 (3 per alternative)
Sidebar drag-reorder with composer mounted (Work/Personal order changes)     PASS x3
Axe accessibility scan, light + dark                                        PASS x6 (0 violations, 40-41 passes each)
```

## Gaps and next gate

- Screen-reader output and 200% zoom were not separately exercised for this non-production
  comparison. Semantic structure, names, state, and reflow were inspected; production
  implementation requires the broader review policy.
- The save-error retry path and the tag-suggestion/command-palette/touch-tag-surface keyboard
  interactions documented in P2.2-F01–F05 use composer code that did not change in the shell-adoption
  pass; they were not re-run exhaustively here beyond the submit/blank checks noted in P2.2-F07.
- The Work/Personal lists and Today smart list in this story's shell fixture intentionally carry no
  tasks (production empty state) rather than tasks from a mismatched tag set — see P2.2-F06.
- P2.3 is blocked only on the user's corrected-evidence review and explicit reconfirmation,
  change, or rejection. P2.4 must not start before that decision. This pass changes how the
  evidence is presented (inside the real app shell); it does not itself constitute or imply
  approval of any direction.

## Boundary confirmation

- P2.2 changed only `ui-ux/ux/` concept, brief, review, and evidence files plus this roadmap
  progress record.
- No production source, test, dependency, package, database, Electron profile, or
  architecture plan was changed by the P2.2 work.
- Concept code remains outside the production bundle and is guarded by
  `npm run check:ux-boundary`.
- The 2026-08-25 shell-adoption pass changed only `ui-ux/ux/concepts/app-shell-preview.ts`,
  `quick-add-pilot.stories.ts`, `quick-add-pilot.css`, `fixture-catalog.css` (a shared
  `display: contents` rule), this review, `ux/README.md`, and the roadmap progress table. Decision
  0001 was not touched and remains `PROPOSED`. No git staging or commits were made.
