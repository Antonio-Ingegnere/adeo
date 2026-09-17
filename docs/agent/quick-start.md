# Adeo agent quick start

Use this only to orient a fresh session. Current repository state, the active
Change Model and executable evidence are more authoritative.

## Deliver a task

```text
/deliver <task>
```

The default workflow performs bounded reconnaissance, models the system change,
implements a candidate, runs deterministic checks, invokes a fresh adversarial
verifier, repairs defects and presents the product. Do not create routine
FAST/STANDARD specs or request readiness approval.

## Resume after clearing context

```text
/start
```

`/start` reads `.claude/delivery/current.json` through `delivery.py`, Git
summaries, open defects and at most five handoff paths. It does not load the
previous transcript or broad documentation trees.

## Essential commands

```text
python3 .claude/scripts/delivery.py status --json
npm run quality:delivery
python3 .claude/scripts/delivery.py report
npm run test:workflow
```

The quality system selects applicable project checks from the Change Model and
changed paths. There is no general `npm test` or lint script.

## Repository shape

- `src/main.ts` — Electron lifecycle, IPC, settings, backend process.
- `src/preload.ts` — isolated renderer bridge.
- `src/renderer/` — DOM-based TypeScript UI.
- `server/app.py` — FastAPI, SQLite, persistence, recurring tasks.
- `ui-ux/ux/` — Product Designer-owned Storybook exploration.
- `spec/` — explicit durable Storybook-derived specifications.
- `.claude/delivery/current.json` — ignored machine delivery state.

Use `docs/agent/architecture/README.md` to locate a relevant stable invariant.
Read the current source and tests before relying on documentation.

## Context checkpoint

At a clean boundary, repeated no-progress correction, model switch, pause, or
around 70–75% context usage:

```text
/handoff reason=context
/clear <task-name>
/start
```

The handoff replaces its predecessor inside machine state. `/compact` is only a
fallback when no safe fresh-session boundary exists.

## Exceptional high risk

Only genuine security, migration, destructive, persistence, architecture,
compatibility or public-contract decisions use `/feature mode=full` and the
immutable `/implementation-plan` approval path. `/deliver` identifies that need
internally and asks the user only for the actual decision.
