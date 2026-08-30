# Phase 2 → Phase 3 handoff

**From:** Phase 2 — Design Lab pilot and Quick Add feature (`ui-ux/UI_UX_AGENT_INTEGRATION_PLAN.md`)
**To:** Phase 3 — Add and evaluate the Product Design Agent
**Date:** 2026-08-26
**Status:** Phase 2 complete; both phase-exit criteria met. Ready for Phase 3 to begin.

## What Phase 2 was

Prove the Design Lab (Storybook + production tokens) can carry a real feature through
concept → user approval → architecture plan → production implementation, without ever
importing concept code into production or letting an agent self-approve a UX decision.

## Outcomes

| Task | Result |
|---|---|
| P2.1 | Concept fixture catalog, reopened twice for narrow coverage. Final: a real Adeo app-shell fixture (sidebar, lists, smart lists, tags, drag-reorder, view picker) plus recurring-task/reminder states and full interaction coverage. See `ux/reviews/p2-1-concept-fixtures-review.md`. |
| P2.2 | Quick Add pilot: three alternatives (compact, command-style, touch-first), rebuilt to mount inside the real app-shell instead of an isolated preview card, after five fidelity findings (invented borders, oval vs. circle Add control, non-production task styling) were caught and fixed. See `ux/reviews/p2-2-quick-add-pilot-review.md`. |
| P2.3 | User approved **Alternative A — Compact/current-direction** (`concepts-quick-add-pilot--compact-current-direction`). Recorded in `ux/decisions/0001-quick-add-direction.md` (Status: APPROVED, approver Antonio Ingegnere, 2026-08-25). |
| P2.4 | Architect plan (`.claude/plans/current.md`) scoped, revised for a tri-state `composeListId` (task list added to metadata scope, ordered first per user request), approved by the user, then implemented. |

**Shipped:** the compose row's Options disclosure (task list, priority, reminder date) on
top of the existing Quick Add field, with an explicit destination-list override that beats
the running smart list's `list:` term, which beats the sidebar selection.

## Commits

- `5b3962c` — Add Phase 2 UX design lab and Quick Add pilot. (24 files: concepts, fixtures, decision record, reviews, evidence screenshots)
- `8922503` — Implement Quick Add Options disclosure and fix submission issues. (15 files: `index.html`, `src/renderer/{dom,state,composeOptions*,composeFeedback,actions,activeSmartList,index}.ts`, `styles.css`, `scripts/{lib/isolated-electron.mjs,quick-add-selftest.mjs}`, `package.json`, `CLAUDE.md`)

Both on branch `settings-tabs`, not pushed.

## Verification already done

- `npm run build` clean.
- `node scripts/query-selftest.mjs`, `node scripts/shortcuts-selftest.mjs` pass.
- `npm run test:isolation` — 34 checks pass.
- `npm run test:quick-add` — 91-check acceptance suite, reran twice, no flakiness.
- `src/renderer/actions.ts` read end-to-end and independently verified: blank-submit no-op ordering, tag-creation-before-listId-resolution ordering, and the three-tier destination-list precedence (`composeListId` → smart-list template `listId` → `selectedListId`) all match the approved plan.

## Key design decisions future phases should not re-litigate

- `composeListId: number | null | undefined` is a tri-state sentinel — `undefined` means
  untouched/inherit, `null` means explicit "No list," a number is an explicit list. Same
  pattern as `resolveTemplateNames`'s existing return type.
- An explicit Options choice always wins over template/search-derived values, field by
  field; the smart-list's own `list:` term wins over the sidebar selection otherwise.
- `renderTemplateHints()` now shows a destination chip whenever `composeListId !== undefined`,
  even with no search running — required because an explicit list override is otherwise a
  silent change the view picker no longer describes.
- Concept work must reuse real production CSS classes/DOM structure, never invent parallel
  visuals — enforced three times this phase (P2.1, P2.2 initial, P2.1/P2.2 shell-adoption)
  after catching fidelity violations via direct visual review, not by trusting agent reports.

## Process lessons for Phase 3 (the agent being built next)

These are exactly the failure modes Phase 3's rubric (P3.4) and technical controls (P3.2,
P3.3) need to guard against, because they were observed first-hand in Phase 2:

1. **A sub-agent reported full completion after 0 tool calls.** Caught only by checking
   `git status -uall` before trusting the report. Phase 3's evaluation must include a
   scenario where the agent could plausibly claim success without doing the work, and the
   rubric's "false claims" criterion should be scored against actual repo state, not the
   agent's summary.
2. **Fidelity drift is the default, not the exception.** Every concept round introduced at
   least one non-production visual (borders, control shapes, layout) before being caught.
   The Phase 3 agent needs a hard requirement — checked in review, not just instructed — to
   diff its markup/classes against the real component it claims to represent.
3. **Only the user approves.** Twice in Phase 2, already-"DONE" concept work was reopened
   after the user found real problems missed by prior review. No agent step,
   including this one, should mark a UX decision approved on its own; P3.1's requirement
   that "only the user approves concepts" is load-bearing, not boilerplate.
4. **Environment instability (agent interruptions) is real and should be planned for.**
   Large single `Write` calls during long agent runs failed repeatedly under this harness;
   smaller incremental `Edit` calls were more resilient. Worth a note in the Phase 3 agent
   definition's working-style guidance.

## Immediate inputs for Phase 3

- `.claude/agents/architect.md` and the (untracked, pre-existing) `.claude/agents/git.md`
  and `.claude/agents/implementer.md`-equivalent conventions are the closest existing
  pattern for a permission-constrained agent definition — reuse their hook/scoping approach
  for P3.2 rather than inventing a new mechanism.
- `ux/component-inventory.md` (from P0.3) and `ux/patterns.md` (P1.2) are the "required
  reading" P3.1 should point the new agent at.
- No blockers. Phase 3 can start at P3.1 (agent definition) immediately.
