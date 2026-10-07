# Adeo delivery workflow

Adeo is an Electron todo app with TypeScript main/renderer and local FastAPI + SQLite.

- `/deliver feature <request>` or `/deliver bugfix <report>` runs frozen Switchyard V2 once.
- READY_FOR_MANUAL_QA ends delivery without a commit. The human tests the application externally.
- `/accept` commits the reviewed candidate through deterministic V2 safety checks; no manual staging or push.
- `/reopen <feedback>` preserves changes and records human feedback without starting a model.
- `/repair` is retired; `/qa-fix` redirects to reopen, not an automatic repair.
- NEEDS_HUMAN, NEEDS_REDIAGNOSIS and COMMIT_BLOCKED stop automation.

[Setup, commands, history and recovery](docs/agent/switchyard-delivery.md).
Project-local `.switchyard/current.json` is navigation only; V2 WorkWorkspace owns durable truth.
QA records live persistently outside the target in Adeo application data. Never edit pointers to
bypass sequencing, resume interrupted runs, or invent history. Legacy records remain read-only.
Agents never choose transitions, capabilities or final acceptance; Switchyard owns them.

Inside a Switchyard invocation perform only the assigned stage. Never recursively invoke delivery,
accept or reopen, stage commits, or start legacy workers. Inspect current repository behavior.
Production work may use Storybook and ui-ux references; these are not a substitute for application code.

Use docs/agent/quick-start.md for bounded orientation and docs/agent/architecture/README.md for scoped context.
Preserve destructive-action, protected-path, real-data, secret, external-write, security and scope boundaries.
Electron tests must use isolated harnesses. Standalone /design remains separate and blocked during active delivery.
