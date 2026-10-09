# Adeo workflow tooling

- `/deliver feature <request>` starts a feature; `/deliver bugfix <report>` starts a defect fix.
- `/deliver resume` explicitly resumes an interrupted stage with remaining budget.
- `/deliver rollback [reason]` restores pre-delivery work, preserves history and retires the attempt.
- READY_FOR_MANUAL_QA means stop and test the result yourself. Delivery has not committed.
- `/accept` accepts the reviewed candidate; unsafe or changed work reports COMMIT_BLOCKED.
- `/reopen <feedback>` preserves work and records feedback; it starts no provider.
- `/repair` is retired. `/qa-fix <feedback>` records REOPENED while preserving implementation; `/qa-accept` redirects to `/accept`.
- `/qa-escalate` remains removed. `/start` and `/handoff` inspect only; use explicit resume for a recoverable interruption.

See [setup and recovery](../docs/agent/switchyard-delivery.md). Historical work stays readable,
never reinterpreted as V2. Standalone `/design` retains UX-only scope. `/commit` cannot bypass
active delivery acceptance. Push requires separate authorization and is not part of V2.
