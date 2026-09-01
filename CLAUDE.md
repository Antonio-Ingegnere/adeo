# Adeo autonomous delivery entry point

Adeo is an Electron todo app with a TypeScript main/renderer and local FastAPI +
SQLite backend. Keep this always-loaded file small; repository understanding
must come from bounded reconnaissance of current code and tests.

## Default workflow

- Ordinary development starts with `/deliver <task>`.
- The system performs reconnaissance, records a concise repository-derived
  Change Model, classifies risk internally, implements, runs a deterministic
  quality gate, invokes a fresh adversarial verifier, repairs defects, and then
  presents the product for user validation.
- No routine FAST/STANDARD selection, mini-spec approval, readiness review or
  implementer-authored completion declaration is allowed.
- Humans approve genuine decisions. Machines prove behavior.

Machine lifecycle lives in ignored `.claude/delivery/current.json`. Only
`.claude/scripts/delivery.py` changes it. The implementer may produce a
candidate in `IMPLEMENTING` or `REPAIRING`; only matching quality and verifier
receipts can produce `READY_FOR_PRODUCT_REVIEW`.

## High-risk decisions

`/feature mode=full` and `/implementation-plan` remain only for durable product,
architecture, migration, persistence, security, compatibility or public
contract decisions discovered by `/deliver`. Low/medium work proceeds without
human approval unless repository evidence exposes a real ambiguity.

## Fresh sessions

- At clean stage boundaries, repeated no-progress corrections, model switches,
  or around 70–75% context usage, invoke `/handoff`.
- The user then runs `/clear <task-name>` and `/start`; never clear on the
  user's behalf.
- `/start` loads machine state, Git summaries, open defects and at most five
  handoff paths—not prior transcripts or broad documentation trees.
- Use `/compact` only when no safe handoff boundary exists.

## Context and safety

Use [`docs/agent/quick-start.md`](docs/agent/quick-start.md) for fresh repository
orientation and [`docs/agent/architecture/README.md`](docs/agent/architecture/README.md)
as a scoped router. Repository code and executable evidence are authoritative.

Preserve destructive-action, protected-path, real-data, secret, external-write,
security and scope-expansion boundaries. Electron behavior must use isolated
test harnesses. The complete operating guide is [`.claude/HELP.md`](.claude/HELP.md).
