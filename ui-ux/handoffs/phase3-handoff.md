# Phase 3 → Phase 4 handoff

**From:** Phase 3 — Add and evaluate the Product Design Agent (`ui-ux/UI_UX_AGENT_INTEGRATION_PLAN.md`)
**To:** Phase 4 — Automated visual, interaction, and accessibility QA
**Date:** 2026-08-26
**Status:** Phase 3 complete; both phase-exit criteria met. Ready for Phase 4 to begin.

## What Phase 3 was

Install a permission-constrained Product Design Agent and prove, with evidence rather than
a plausible-sounding transcript, that it can do real design-lab work (requirement review,
concept exploration, implementation audit) while being technically — not just by
instruction — unable to touch production code, tests, dependencies, or Git state, or to
approve its own output.

## Outcomes

| Task | Result |
|---|---|
| P3.1 | `.claude/agents/product-designer.md`: five modes (requirement review, explore, specify, implementation review, audit), required reading, per-mode output paths, explicit "only the user approves" boundary. |
| P3.2 | Two `PreToolUse` hooks: Write/Edit confined to `ui-ux/ux/` inside the repo (outside the repo — e.g. the session scratchpad — is allowed); Bash default-denies `git` except a read-only allowlist and blocks dependency installs, packaging, launching Electron/the API, and touching any `.db` file. 26 Bash + 7 write-path negative-test cases pass. |
| P3.3 | Tool list: Read/Grep/Glob/Write/Edit/Bash plus Chrome MCP tools for Storybook/viewport/console evidence — no deployment, install, database, or git-write tools. A live dry run through the real registered `product-designer` agent type opened a Storybook concept story, resized to 390px with zero overflow, read real production DOM, read a diff read-only, and was correctly blocked editing `src/`, running `git commit`, and running `npm run start`. |
| P3.4 | Three fixed scenarios run against the real agent and independently re-verified against actual repo state (not the agent's own report): requirement review, concept exploration, implementation audit. All three scored 14/14 against a 12/14 (≥80%) threshold, no hard-gate violation. See `ux/reviews/p3-4-agent-evaluation.md`. |
| P3.5 | No rubric item was weak enough to justify a revision, so the agent definition is frozen at v1.0 with no prompt change. User approved 2026-08-26. |

**Shipped:** `.claude/agents/product-designer.md` v1.0 — a working, technically-constrained
Product Design Agent, plus three real evaluation artifacts it produced
(`ux/briefs/reminder-snooze.md`, `ux/concepts/overdue-task-treatments.stories.ts`,
`ux/reviews/p3-4-scenario3-quick-add-audit.md`) and the rubric/results doc
(`ux/reviews/p3-4-agent-evaluation.md`).

## Files changed or added (not yet committed)

- `.claude/agents/product-designer.md` (new)
- `ui-ux/UI_UX_AGENT_INTEGRATION_PLAN.md` (Phase 3 progress tracking)
- `ui-ux/ux/briefs/reminder-snooze.md` (new — eval scenario 1 artifact)
- `ui-ux/ux/concepts/overdue-fixtures.ts`, `overdue-treatments.css`, `overdue-task-treatments.stories.ts` (new — eval scenario 2 artifacts)
- `ui-ux/ux/reviews/p3-4-agent-evaluation.md`, `p3-4-scenario3-quick-add-audit.md` (new — eval scenarios 2/3 artifacts and rubric/results)
- `ui-ux/handoffs/phase3-handoff.md` (this file)

Also present in the working tree but **not part of Phase 3** (pre-existing/unrelated, seen
via `git status` at session start): `.claude/agents/git.md` modified, `.claude/agents/planner.md`
deleted, `.claude/agents/architect.md` untracked, `.claude/plans/archive/` untracked. Flagging
per the git-agent convention of not folding unrelated work into a commit.

## Real findings surfaced during Phase 3 (not addressed here — Architect Agent's to schedule)

These came out of the P3.4 evaluation scenarios, independently re-verified, not asserted:

- **F-01 (High):** the shipped Quick Add priority menu (`index.html:259-274`,
  `src/renderer/composeOptions.ts:143-154`) is keyboard-inoperable — role-less `<div>` items,
  click-only handler, no keydown path anywhere in the module. The approved concept used real
  `<button aria-pressed>` elements. See `ux/reviews/p3-4-scenario3-quick-add-audit.md`.
- **F-02 (Medium):** both new compose menus declare `role="menu"` (`index.html:245,258`) with
  children that carry no `role="menuitem"`. Same review, filed alongside F-01.
- A third, smaller finding from the concept-exploration scenario: one overdue-indicator
  alternative overflows around a 315px column width, requiring a `.task-reminder` wrap change
  if that direction is ever pursued — informational only, no direction was chosen.

None of these are approved for implementation; they are candidate P4/architect-scoped work,
surfaced exactly the way Phase 3 was meant to prove the agent can do.

## Verification already done

- Both `PreToolUse` hooks tested directly against 33 crafted inputs (not just described) —
  see the negative-test runs referenced in `ux/reviews/p3-4-agent-evaluation.md` and this
  session's transcript.
- `npm run check:ux-boundary` passes with all new concept files present (44 production files
  scanned, no violation).
- Every claim in all three P3.4 scenario artifacts that could be spot-checked against real
  source was independently re-verified by the Architect (not the product-designer agent),
  matching the process lesson Phase 2 left for Phase 3.

## Key design decisions future phases should not re-litigate

- The write boundary is "inside the repo, only `ui-ux/ux/`; outside the repo, anything" — not
  a flat "only `ui-ux/ux/`" rule. The narrower version blocked legitimate scratch/probe files
  outside the repository and was corrected after the P3.3 dry run caught it live.
- The Bash hook strips heredoc bodies from scanning unless the heredoc is itself interpreted
  by a shell (`bash`/`sh`/`zsh`/`dash`) — otherwise inline script bodies (JS, Python) fed to
  `node`/`python3` etc. false-positive against the redirect/keyword rules on ordinary code like
  `right > window.innerWidth`.
- The agent's own guardrails forbid launching the real Electron app or FastAPI server, even
  for implementation review. It gets live evidence only from Storybook and static source
  reading; anything else must be marked `NOT TESTED`, never inferred as passing. This was the
  deliberate design of P3.4 scenario 3, and the agent held to it without being reminded mid-run.
- Evaluation scores in `ux/reviews/p3-4-agent-evaluation.md` are the Architect's recommendation;
  only the user's sign-off (recorded 2026-08-26) makes P3.4/P3.5 final, matching the "only the
  user approves" rule that governs UX decisions too.

## Process lessons for Phase 4

1. **Hooks should be dry-run through the real registered agent before being trusted, not just
   unit-tested against crafted inputs.** Both bugs in P3.2's hooks were invisible to the crafted
   negative-test suite and only surfaced when the actual agent hit them organically during a
   real task. Phase 4's CI job (P4.6) should include at least one run of real agent/test
   behavior, not only synthetic assertions.
2. **A permission classifier can block edits to security-hook code even from the authoring
   session, with no override path other than a human pasting the diff.** This happened twice on
   one small regex fix. Budget for it if Phase 4's CI/test-isolation work touches hook or
   permission configuration.
3. **The evaluation rubric's "false claims" criterion is best tested by scenario design, not by
   instruction alone.** Scenario 3 worked because the setup made live-app evidence structurally
   unavailable to the agent, forcing an honest `NOT TESTED` rather than relying on the agent to
   remember a rule. Apply the same principle to Phase 4's own accessibility/visual-QA scenarios.

## Immediate inputs for Phase 4

- `.claude/agents/product-designer.md` v1.0 is available now for real requirement reviews,
  concept exploration, and implementation audits going forward — it does not need to wait for
  Phase 4.
- F-01/F-02 (keyboard/ARIA on the Quick Add menus) are the most concrete, already-scoped
  candidate for Phase 4's accessibility work (P4.4) or an earlier fix, at the Architect's
  discretion.
- P4.1's Playwright Test setup should reuse `scripts/lib/isolated-electron.mjs` and the existing
  `ADEO_UI_TEST` isolation contract rather than inventing a new one — unchanged guidance from
  the project's own `CLAUDE.md`.
- No blockers. Phase 4 can start at P4.1 (Playwright Test setup) immediately.
