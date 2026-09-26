# Switchyard delivery in Adeo

DELIVERY-002 uses the accepted DELIVERY-001 presets and OBS-006 consumer unchanged.

## Setup

Use the Switchyard checkout containing OBS-006 (tested at 409b0dc) with its requirements.txt
installed for the configured Python. Create ignored `.switchyard/config.json` with absolute paths:

```json
{
  "switchyard_root": "/absolute/path/to/switchyard",
  "python_executable": "/absolute/path/to/switchyard/.venv/bin/python",
  "codex_executable": "/absolute/path/to/codex",
  "git_executable": "/usr/bin/git",
  "node_executable": "/absolute/path/to/node",
  "npm_executable": "/absolute/path/to/npm"
}
```

This is project-side instantiation, not YAML environment interpolation. Codex handles
ANALYZE/FRESH_DIAGNOSIS, IMPLEMENT/FIX and REPAIR_ONCE. Normal commands use Python 3.10+
and PyYAML; the configured interpreter runs the deterministic verifier. npm build scripts
also require their normal Node/toolchain PATH. No provider calls occur in offline tests.

## Commands and evidence

- `/deliver <task>` generates a correlation ID, records a new deliver run and stops at
  READY_FOR_MANUAL_QA or NEEDS_REDIAGNOSIS. Only one automatic corrective attempt exists.
- `/repair <bug report>` requires the latest run to be QA-ready, uses it as parent, and
  starts the repair preset with fresh diagnosis. It stops at READY_FOR_MANUAL_QA or NEEDS_HUMAN.
- `/accept` means the human tested the latest QA-ready result. Review and explicitly stage
  only the intended patch, run `python3 .claude/scripts/delivery.py inspect`, and approve
  the reported HEAD, patch_sha256 and message. Supply those exact values with `accept
  --approved-head ... --approved-patch-sha256 ... --message ... --manual-qa-passed`.
  The preset performs CHECK_WORKTREE, CHECK_SCOPE, COMMIT and ends ACCEPTED or COMMIT_BLOCKED.
  No automatic staging, scope approval, stashing, unrelated commits or push occurs.

A file can contain unrelated hunks: deterministic Git inspection cannot decide semantic
ownership. The human approves the exact reviewed patch. An unstaged/untracked remainder
blocks the conservative preset; do not hide it or broaden the commit to get through.
Stale HEAD or staged patch is rejected. Commit uses the accepted preset's commit-tree and
compare-and-swap update-ref, not commit hooks; run the deterministic verifier before QA.

`.switchyard/current.json` holds correlation_id, latest_run_id, latest_terminal, status and
relative events_file. Logs append via JsonlRecorder to `.switchyard/runs/<correlation>.jsonl`.
A file lock excludes concurrent commands. The pointer is not execution evidence.
Each preset instantiation creates its own `.switchyard/delivery/<session>/analysis.md`,
shared between its stages and advisory to implementation. This existing unique run area
avoids overwriting old diagnosis. All `.switchyard/` data is ignored and never accepted.

## Deterministic verification

Exact entrypoint: `<configured Python> scripts/verify-delivery.py` (`npm run quality:delivery`).
It builds/typechecks once, tests workflow integration, runs every existing `scripts/*-selftest.mjs`
in deterministic filename order, then builds Storybook. Checks include query, shortcuts,
i18n and isolated real-Electron task, board, sidebar, window, markdown and focus behavior.
The task-row focus suite checks real ArrowDown/Tab DOM focus movement and rendered outlines.
No LLM verdict is evidence. An individual check is bounded to 180 seconds, full verifier to
1200 seconds; failures/timeouts are normal verifier outcomes and do not start another run.

## Migration and recovery

Old `/deliver` performed Change Model/worker claims, Sonnet implementation and risk-routed
Haiku/Sonnet LLM verification with repeated repairs. `/qa-fix` could bootstrap without state,
reuse diagnosis and select providers from reopen counts. `/qa-escalate` changed provider routing.
`/qa-accept` marked DONE and wrote manual metrics, without the new Git acceptance preset.

Now `/qa-fix` aliases `/repair`; `/qa-accept` aliases `/accept` including exact approval.
`/qa-escalate` only explains removal and stops. Old orchestration and its provider workers
are removed. `/start` and `/handoff` inspect only, never replay/resume a run.
`docs/agent/delivery-metrics.jsonl` and existing `.claude/delivery/current.json` remain historical;
new commands never append manual metrics or convert legacy prose to canonical events.

An existing active legacy state blocks new deliver. Review it, explicitly decide to abandon
or archive that old workflow, then move the pointer to a retained archive yourself. No automatic
migration, deletion or implied closure occurs. An accepted Switchyard pointer can be replaced
by the next explicit deliver; its per-lifecycle log remains.

No active lifecycle, missing/corrupt logs, closed follow-ups, or a second active deliver fail
clearly. A `running` marker after interruption/recorder failure also blocks: inspect JSONL and
Git before manual recovery. Do not replay acceptance (a commit may already exist), rewrite
history, invent completion, or relabel a failed run. Keep the inconsistent pointer/log as evidence;
explicit abandonment/archive after review is the recovery boundary for this slice.
COMMIT_BLOCKED, NEEDS_HUMAN and NEEDS_REDIAGNOSIS do not automatically restart.

## Analytics after acceptance

In Python with the configured Switchyard checkout on sys.path:

```python
from switchyard.observability import read_events
from examples.delivery.analytics import (
    summarize_delivery_lifecycles, summarize_delivery_analytics,
)
events = tuple(read_events(".switchyard/runs/<correlation>.jsonl"))
lifecycles = summarize_delivery_lifecycles(events)
analytics = summarize_delivery_analytics(events)
```

Integration tests prove deliver → repair → accept yields one QA reopen and accepted lifecycle;
automatic REPAIR_ONCE yields one automatic repair and zero manual reopens. Analytics never
controls transitions. No dashboard or analytics CLI is added.
