---
name: deliver
description: Ship a production Adeo change with Haiku orchestration, Sonnet implementation, deterministic gates, risk-routed verification, then mandatory manual QA.
argument-hint: <task-or-reference>
model: haiku
effort: low
disable-model-invocation: true
---

`/deliver` means **shipping product implementation**. Storybook, `/story/...`,
`ui-ux/ux/`, screenshots and mockups are read-only references unless the user
explicitly asks for design work.

Optimize accepted change per token. The controller does not perform repository
reconnaissance itself.

1. Start/resume machine state with `delivery.py start/status`. New work defaults
   to `--target production`; record explicit prototypes with `--reference`.
2. Claim one `implementer`, then invoke exactly one Sonnet `implementer` agent.
   It owns bounded reconnaissance, Change Model and candidate implementation.
3. Change Model stays under 8 KB. It may include up to five safe
   `feature_checks` (`node scripts/*-selftest.mjs`, `python3 scripts/*-selftest.py`,
   or `npm run test:<name>`). For UI work, prefer a narrow isolated real-Electron
   smoke journey for critical behavior; do not build visual Cartesian matrices.
4. Controller runs `python3 .claude/scripts/delivery.py quality`. Never ask an
   LLM to rerun deterministic PASS checks.
5. Inspect compact `status --json` and invoke exactly `verification_route`:
   - `verifier-lite` = Haiku full review for low/medium risk;
   - `verifier` = Sonnet full review for high risk;
   - `verifier-targeted` = Haiku re-check of known repaired defects only.
6. Blocking verifier defects: same Sonnet implementer repairs, then quality,
   then **targeted Haiku only**. Never launch a second full verifier.
7. Verifier PASS transitions to `READY_FOR_MANUAL_QA`, not DONE. Stop and give
   the user the manual-QA package from `delivery.py report`.
8. Human defects return through `/qa-fix`; explicit acceptance through
   `/qa-accept` transitions to DONE.

High risk/unknown decisions stop at `BLOCKED_DECISION` until explicit human
`authorize-high`. Budget exhaustion stops at `NEEDS_HUMAN_REVIEW`.

Do not invoke `/handoff` automatically. Machine state is resumable with `/start`.
If a checkpoint is wanted, `delivery.py checkpoint --reason ...` is deterministic.
