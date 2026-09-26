# Adeo delivery workflow

Adeo is an Electron todo app with TypeScript main/renderer and local FastAPI + SQLite.

- `/deliver <task>` runs the Switchyard deliver preset once.
- READY_FOR_MANUAL_QA ends the run. The human tests the actual application externally.
- `/repair <bug report>` starts a new correlated run with FRESH_DIAGNOSIS.
- `/accept` requires human QA and exact staged-patch/HEAD approval, then commits without push.
- NEEDS_REDIAGNOSIS, NEEDS_HUMAN and COMMIT_BLOCKED stop automation.

[Setup, verification, migration and recovery](docs/agent/switchyard-delivery.md).
Canonical JSONL events are evidence; ignored `.switchyard/current.json` is only a pointer.
Do not edit it to bypass sequencing, resume interrupted runs, or invent missing history.
Only the project wrapper writes lifecycle pointers. Codex performs analysis, implementation
and one bounded repair; the deterministic command verifies. Agents never select transitions.

Inside a Switchyard agent invocation, perform only the assigned stage. Do not recursively
invoke /deliver, /repair or /accept, stage commits, or start legacy workers.
Analysis is advisory; inspect current repository behavior. Production work may use Storybook
and ui-ux artifacts as references; they are not a substitute for application implementation.

Use docs/agent/quick-start.md for bounded orientation and docs/agent/architecture/README.md
for scoped context. Preserve destructive-action, protected-path, real-data, secret,
external-write, security and scope boundaries. Electron tests must use isolated harnesses.
Standalone /design remains separate and is blocked during an active delivery lifecycle.
