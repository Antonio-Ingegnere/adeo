# Delivery, QA and recovery

The project's one editable execution configuration is
[`.switchyard/config.yaml`](../../.switchyard/config.yaml). Agents own provider,
model, effort, workspace/shell permissions and invocation `timeout` in seconds.
Flows own states, artifacts, transitions and bounded escalation. Adeo owns the human
commands; Switchyard owns execution, recovery and the final acceptance commit.

## Install once

Use Adeo's normal project Python environment:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-delivery.txt
```

The existing `server/requirements.txt` also includes that pinned dependency.
`switchyard-runtime` 2.1.0 is installed by ordinary pip from the revision in the
requirements file. Delivery imports that installed package and verifies its package
version and installation origin. No external Git checkout, PYTHONPATH injection or
SWITCHYARD_ROOT is required. The local wrapper selects `.venv` automatically.
Provider CLI authentication stays outside YAML; no secrets are copied into state.

Optional launch-path variables are SWITCHYARD_PYTHON, SWITCHYARD_CLAUDE,
SWITCHYARD_CODEX, SWITCHYARD_GIT, SWITCHYARD_NODE and SWITCHYARD_NPM. They do not select
models, capabilities or workflows. Contributors may explicitly set SWITCHYARD_ROOT
to a compatible checkout; that opt-in is validated separately and is not normal
product bootstrap. Do not change Claude Code permissions to accommodate a checkout.

```sh
.venv/bin/python -m switchyard config validate .switchyard/config.yaml
.venv/bin/python -m switchyard config show .switchyard/config.yaml
```

Both are deterministic. Edit `agents.spec.provider/model/effort` to change all
specification stages, a state's `agent` to change only that state, and
`agents.tests.command` to change verification. There are no Adeo provider/role/model
override tables. Old config.json/alias files do not affect new work.

Current deadlines: spec, investigate, diagnose-deep and independent use 600 seconds;
code and tests use 1800. Only `timeout` is a public key. It must be a finite positive
number, not a boolean/string. The selected agent's deadline reaches the actual
provider process. Invalid values fail at `agents.<name>.timeout`.

## Human commands

```text
/deliver feature "<request>"
/deliver bugfix "<request>"
/deliver resume
/deliver rollback ["reason"]
/accept
/qa-fix "<feedback>"
```

The local command equivalents are:

```sh
python3 .claude/scripts/delivery.py deliver feature "Human request"
python3 .claude/scripts/delivery.py deliver bugfix "Human bug report"
python3 .claude/scripts/delivery.py deliver resume
python3 .claude/scripts/delivery.py deliver rollback "Wrong direction"
python3 .claude/scripts/delivery.py status
```

The human chooses feature/bugfix. FEATURE runs SPECIFY → IMPLEMENT → VERIFY; BUGFIX
runs TRIAGE → REPRODUCE → DIAGNOSE → SPECIFY_FIX → FIX → VERIFY. Switchyard owns any
configured escalation/repair. READY_FOR_MANUAL_QA ends delivery without committing.
Review all candidate paths; pre-existing unrelated changes are also part of the QA
snapshot, and pre-existing staging blocks capture. Rollback remains available if
candidate capture cannot complete.

The slash tooling reads the displayed candidate identity and binds the human QA
choice to it; humans do not manufacture a MicroSpec or list Git commands:

```sh
python3 .claude/scripts/delivery.py accept --candidate <reviewed-identity>
python3 .claude/scripts/delivery.py reopen --candidate <reviewed-identity> --feedback "Human feedback"
```

ACCEPTED means the deterministic exact-scope V2 commit succeeded. COMMIT_BLOCKED
shows the bounded reason and never falls back to another commit engine. `/qa-fix`
preserves useful implementation and records durable human feedback as REOPENED.
It does not automatically start another model; a human may start new BUGFIX work
with that feedback. `/reopen` remains an equivalent compatibility action, `/repair`
is retired, `/qa-accept` aliases accept, and `/qa-escalate` stays retired.

Lifecycle flags live in the same project config and are captured with each work.
`manual_qa: false` disables candidate creation; `accept.commit: false` disables
acceptance; `reopen: false` disables reopen. None bypasses V2 safety.

## Interrupted delivery and explicit resume

A known timeout kills the provider process group and waits for the direct process.
Partial source edits remain. No successful StageResult or implementation artifact is
invented. Switchyard checkpoints the worktree and records INTERRUPTED, interrupted
logical state, work ID, flow, reason and resume/rollback eligibility. The lightweight
current pointer no longer claims the dead process is running. Reasons distinguish
provider_timeout, provider_failure and execution_interrupted.

Increase only the selected agent's `timeout` in config.yaml, then explicitly run
`/deliver resume`. It uses the same work ID, workspace, request, artifacts, handoffs,
events and cumulative budgets. A timed-out IMPLEMENT resumes IMPLEMENT; SPECIFY and
its MicroSpec are not rerun. Partial implementation is available through normal
repository access; no provider session ID is used. Semantic changes to models,
permissions, graph, contracts, effort, lifecycle or budgets require a new delivery.

Every failed invocation still consumes its ordinary budget. Write stages reserve two
invocations per visit in the default config, allowing one human-requested resume.
No automatic retry occurs. An already exhausted run returns RESUME_BLOCKED. Human
edits after the checkpoint also block resume rather than being merged. The timeout
edit is the only permitted config change; if accepted later, its exact reviewed bytes
are included in the QA candidate. Config changes after QA still block acceptance.

## Explicit rollback

`/deliver rollback` means discard the attempt, unlike `/qa-fix` which keeps it.
It restores delivery-owned paths to their exact pre-delivery Git-visible state:
modified/deleted tracked files, newly created files, original dirty or untracked
bytes, binary content, supported symlinks and permissions. Clean bytes come from base
HEAD; dirty bytes and original index state are preserved before any provider runs.
It does not reset-hard, clean the repository or remove unrelated user changes.

Rollback checks base HEAD, index and each owned path against the last checkpoint.
Later human edits to those paths give ROLLBACK_BLOCKED with bounded path diagnostics.
Unrelated later work is preserved. Active providers refuse. INTERRUPTED,
READY_FOR_MANUAL_QA, REOPENED and COMMIT_BLOCKED are eligible; ACCEPTED refuses and
requires ordinary Git revert or new corrective work. Pending QA is permanently
withdrawn before restoration, so old candidate IDs cannot later commit restored work.

ROLLED_BACK remains visible in history/status, but the current work is retired and a
new delivery may start immediately. No removal of current.json is needed. Baselines,
checkpoints, artifacts, events, handoffs and external QA history remain intact.

## Storage and reconstruction

Ignored `.switchyard/work/<work-id>/` owns delivery artifacts/events and nested
`recovery/` WorkWorkspace records plus binary baseline objects. Current.json contains
only engine, work_id, repo_id, flow, phase, candidate identity, config digest and cached
terminal. It is navigation, never artifact/fingerprint or commit authority. Status
reconstructs from durable records, including final QA decisions.

Each work captures an immutable project-config snapshot as evidence; only the project
config is editable. Recovery's original semantic snapshot prevents mid-run graph
changes. A new work ID always receives fresh storage.

QA remains outside the target, using Adeo's existing `normalUserDataDir()` helper:

```text
<Adeo persistent data>/switchyard/qa/<SHA-256 of canonical target path>/<work-id>/
```

Candidate source/work/target identities are verified. Missing external state fails
explicitly; no blank replacement, hidden provider rerun or old accept fallback.
Repositories with identical leaf names do not collide. Relocation is not automatic.
History is retained after every final decision; no retention/cleanup job is added.

## Compatibility and operational limits

Historical DELIVERY-002 and older V2 records remain readable. They cannot be resumed
as a different engine. Older work without a pre-delivery recovery baseline cannot
safely be rolled back by guessing dirty bytes; inspect it explicitly. A closed legacy
pointer may yield to new V2 work. Existing run logs/metrics are not rewritten.

Known provider failures are recoverable when termination, checkpoint and output
publication are unambiguous. An abrupt controller crash is detected from its released
lock and recorded process, then shown as INTERRUPTED; uncertain checkpoint/output
state refuses destructive recovery. Torn logs, incomplete manifests, unresolved QA
intent and interrupted partial file restoration can require manual inspection. This
is not arbitrary crash-resume. Worktree access must be cooperative/exclusive during
provider execution; concurrent human writes cannot be attributed reliably. Ignored
untracked files are outside Git-visible recovery. POSIX flock is required, as before.

There is no automatic provider retry/resume, successful command-tool telemetry,
provider-session authority, push/PR automation, cancellation or project scheduling.
Recovery does not weaken acceptance safety. The V2 transport terminates ordinary
process-group children, not deliberately detached processes.

## Offline verification

`python3 scripts/verify-delivery.py` includes installed-package delivery/recovery,
legacy compatibility, UI tests and builds. Focused commands:

```sh
.venv/bin/python .claude/scripts/delivery-selftest.py
.venv/bin/python .claude/scripts/recovery-selftest.py
.venv/bin/python .claude/scripts/delivery-legacy-selftest.py
```

Tests use fake provider executables, isolated persistent test data and real disposable
Git repositories. No live provider calls are needed. Runtime state is not configuration.
