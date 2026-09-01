---
name: start
description: Resume an active delivery from compact machine state with Haiku orchestration.
argument-hint: '[task=<short-name>]'
model: haiku
effort: low
disable-model-invocation: true
---

Resume from machine state, not conversation history.

1. Run `delivery.py status --json` plus `git status --short`, `git diff --stat`,
   and `git diff --name-only`.
2. Read only task, compact Change Model, open defects, and at most the checkpoint's
   `read_first` paths. Do not load old transcripts or broad docs.
3. Route by state:
   - `UNDERSTANDING` / `IMPLEMENTING`: invoke Sonnet `implementer`.
   - `BLOCKED_DECISION`: ask only the unresolved human decision.
   - `REPAIRING`: if open defects are `manual-qa`, try Haiku `qa-repairer`; if it
     says `ESCALATE_TO_SONNET`, invoke Sonnet `implementer`. Other repairs use
     Sonnet `implementer`.
   - `VERIFYING`: invoke exactly the compact status `verification_route`.
   - `READY_FOR_MANUAL_QA`: run `delivery.py report` and stop for human testing.
   - `NEEDS_HUMAN_REVIEW`: stop autonomous work.
   - `DONE` / `FAILED`: do not resume.

A stale prototype-target model must be retargeted; reference artifacts never
become production implementation scope.
