---
name: start
description: Resume an active delivery from compact machine state with Haiku orchestration.
argument-hint: '[task=<short-name>]'
model: haiku
effort: low
disable-model-invocation: true
---

Resume from machine state, not conversation history.

1. Run `python3 .claude/scripts/delivery.py status --json` plus `git status --short`,
   `git diff --stat`, and `git diff --name-only`.
2. Read only task, compact Change Model, open defects, and at most the checkpoint's
   `read_first` paths. Do not load old transcripts or broad docs.
3. Route by state using only the literal runtime commands below. Never invent
   `delivery.py claim`, never use `--agent`, and do not query `--help` to guess
   protocol:
   - `UNDERSTANDING` / `IMPLEMENTING`: if compact status has no `worker_claim`, run
     `python3 .claude/scripts/delivery.py worker-claim --role implementer --json`.
     If the implementer claim already exists, reuse it. Then invoke exactly one
     Sonnet `implementer`.
   - `BLOCKED_DECISION`: ask only the unresolved human decision.
   - `REPAIRING` with `qa_repair_route=qa-repairer`: before every fresh/resumed
     Haiku attempt run `python3 .claude/scripts/delivery.py qa-attempt`. If it
     blocks, stop at `NEEDS_HUMAN_REVIEW`; do not autonomously escalate. Otherwise
     invoke exactly one Haiku `qa-repairer`.
   - `REPAIRING` with `qa_repair_route=qa-repairer-sonnet`: obtain/reuse
     `worker-claim --role implementer --json`, then invoke exactly one Sonnet
     `qa-repairer-sonnet`.
   - Other `REPAIRING`: obtain/reuse `worker-claim --role implementer --json`,
     then invoke the Sonnet `implementer`.
   - `VERIFYING`: invoke exactly the compact status `verification_route`.
   - `READY_FOR_MANUAL_QA`: run `delivery.py report` and stop for human testing.
   - `NEEDS_HUMAN_REVIEW`: stop autonomous work. A Sonnet QA escalation requires
     explicit human `/qa-escalate`.
   - `DONE` / `FAILED`: do not resume.

A stale prototype-target model must be retargeted; reference artifacts never
become production implementation scope.
