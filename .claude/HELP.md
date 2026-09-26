# Adeo workflow tooling

See [Switchyard delivery](../docs/agent/switchyard-delivery.md) for current commands,
setup, Git approval, verification and recovery. `/deliver`, `/repair`, `/accept`
are the delivery entrypoints. `/start` and `/handoff` inspect state only.

`/qa-fix` and `/qa-accept` are deprecated aliases. `/qa-escalate` stops with migration
instructions. Legacy provider routing, worker claims, LLM verifier receipts and
metrics dashboard generation have been removed. Historical logs remain untouched.

Standalone `/design` retains its UX-only scope. `/commit` cannot bypass active delivery
acceptance. `/push` requires separate explicit authorization; delivery never pushes.
