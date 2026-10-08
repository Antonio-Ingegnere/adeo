# Switchyard V2 delivery in Adeo

CONFIG-001 retains the proven V2 engine and replaces normal configuration with ONE
committed file: [`.switchyard/config.yaml`](../../.switchyard/config.yaml). It is the
complete default FEATURE/BUGFIX configuration, including the deterministic verifier
and lifecycle policy. Runtime workspaces are state, not configuration.

## Configure the project

Edit `agents.spec.provider`, `model`, `effort` to change all specification stages.
The default is Codex `gpt-6-astra`, high effort, read workspace plus shell. FEATURE
SPECIFY and BUGFIX TRIAGE/SPECIFY_FIX all reference `agent: spec`.
Change a state's `agent` to change only that state. Edit `flows.<name>.states` to
change transitions, artifacts or escalation. Edit `agents.tests.command` to change
verification. There are no consumer-side role, model, effort or capability overrides.
The config itself contains the full readable default; Switchyard's `docs/configuration.md`
documents the public keys and defaults. Verbose V2 bundles are advanced/legacy only.

```sh
python -m switchyard config validate .switchyard/config.yaml
python -m switchyard config show .switchyard/config.yaml
```

These commands run locally with no provider calls. From the Switchyard checkout use
an explicit project file path; from the project put Switchyard on PYTHONPATH.

## Launch setup

Adeo keeps its existing local-checkout/sys.path dependency mechanism. Set
`SWITCHYARD_ROOT` to the CONFIG-001 checkout referenced by `delivery.py` (or expose
that checkout via PYTHONPATH). Its `.venv/bin/python` is selected if present; otherwise
the calling interpreter is used. Install Switchyard's existing requirements there.
`SWITCHYARD_PYTHON` may select another interpreter. Provider CLIs and Git/Node/npm
are discovered on PATH; optional `SWITCHYARD_CLAUDE`, `SWITCHYARD_CODEX`,
`SWITCHYARD_GIT`, `SWITCHYARD_NODE`, `SWITCHYARD_NPM` select executable locations.
These are launch paths, never model/profile/capability overrides. Do not commit local
absolute paths. Secrets remain in provider authentication/environment.

Commit configuration edits before starting delivery that will proceed to QA. V2 intentionally
protects changed `.switchyard` paths: an uncommitted config change blocks candidate creation,
and a post-candidate config edit blocks accept with `unsupported_path`. Adeo does not auto-commit
configuration, ignore tracked changes or weaken that safety policy.

The old `.switchyard/config.json` and alias file are ignored for new work. Existing
files can be retained for historical use; their contents do not affect delivery.
Concrete YAML models pass directly to the adapters. No machine-local model alias is
needed. Configuration validation catches unsupported workspace/shell combinations
before invocation. Adeo invokes the command agent exactly as written, in the target
worktree; it no longer replaces verifier argv. `python3 scripts/verify-delivery.py`
remains the default. No model verification.

## Commands

The human explicitly chooses feature or bugfix—there is no automatic task classification:

```
python3 .claude/scripts/delivery.py deliver --kind feature --task "Human request"
python3 .claude/scripts/delivery.py deliver --kind bugfix --task "Human bug report"
python3 .claude/scripts/delivery.py status
```

FEATURE runs SPECIFY → IMPLEMENT → VERIFY; BUGFIX runs TRIAGE → REPRODUCE → DIAGNOSE →
SPECIFY_FIX → FIX → VERIFY. Configured escalation/repair stays inside V2. Delivery never commits.
At READY_FOR_MANUAL_QA the wrapper captures the exact worktree as a V2 QA candidate. Review all
candidate changes; isolate unrelated work before starting delivery. Pre-existing staging blocks capture.

The slash-command tooling binds the human's decision to the candidate displayed by status:

```
python3 .claude/scripts/delivery.py accept --candidate <reviewed-candidate-identity>
python3 .claude/scripts/delivery.py reopen --candidate <reviewed-candidate-identity> --feedback "Human feedback"
```

Lifecycle policy is captured with each work item. `manual_qa: false` skips candidate creation
and reports delivered work without claiming ACCEPTED. `accept.commit: false` disables accept;
`reopen: false` disables reopen. Neither changes V2 safety or permits an uncommitted ACCEPTED.

The ID is a stale-action guard, not a manually authored artifact. Humans choose accept/reopen;
Switchyard owns safe staging and the final commit. Do not run git add/commit as a competing acceptance.
COMMIT_BLOCKED includes the V2 reason; there is no cleanup, fallback or retry. REOPENED retains
HEAD/worktree and feedback. A later explicitly requested delivery may include the displayed durable
feedback in its new immutable human request. No transcript/session recovery or automatic follow-up.

`/repair` now explicitly refuses new calls and points to BUGFIX. `/qa-fix` redirects to `/reopen`;
`/qa-accept` aliases `/accept`; `/qa-escalate` stays retired. No second orchestration engine is active.

## Persistence and restart

Ordinary delivery state remains under ignored `.switchyard/work/<work-id>/`: request, artifacts,
handoffs, manifest and events.jsonl. `.switchyard/current.json` contains only engine, work_id,
repo_id, flow, phase, candidate_identity, config_sha256 and a cached terminal. It contains no artifact bodies,
fingerprints, provider configuration, environment or decision records. Events and V2 records are
read and verified when presenting status; cached terminal values do not authorize acceptance.
Each run stores `project-config.yaml` with a digest in the navigation pointer. This immutable
snapshot records the exact configuration used, not a second editable config. Restart/status and
pending lifecycle policy use that snapshot; new runs use only the current project config. Missing
or corrupted snapshots fail explicitly. Editing the tracked config after QA also triggers normal
V2 worktree-drift checks. Historical V2-009 runs lacking a snapshot use their original fixed graph
for read/projection compatibility; new work never loads that advanced bundle.
Status projects logical state and last invocation rung/provider/agent/model/effort from the public compiled
plan and recorded events, without resolving or invoking model adapters.

QA storage uses Adeo's **existing** `normalUserDataDir()` from `scripts/lib/isolated-electron.mjs`,
which mirrors its Electron user-data convention across macOS/Windows/Linux. The Python consumer
calls that Node helper; it does not duplicate platform path logic or add a dependency.

```
<Adeo persistent data>/switchyard/qa/<SHA-256 of canonical target path>/<work-id>/
```

This digest is a storage namespace, not a semantic Git identity. V2's candidate retains authoritative
target/Git/base identity. Different directories named `app` cannot collide. Paths resolve before
use; symlink redirection or inside-target QA locations fail. Each work ID is new and gets a fresh
QA workspace. Production never uses temporary storage. Tests explicitly inject external test roots.
Repository relocation/data-root relocation is not transparent: old state must be inspected, not
silently remapped. No lifecycle records are deleted after ACCEPTED or REOPENED; retention is a
future operational concern. External records need no repository ignore rules.

Restart uses the lightweight pointer plus the data root and verified WorkWorkspace/events.
Candidate digest, source workspace/request/run/flow and target must match. Missing external state
produces an explicit error; no blank replacement, provider rerun or old acceptance fallback occurs.
A final V2 decision overrides stale navigation status. Candidate finalization prevents repeat commits.
A write failure before pointer publication or unresolved intent/running delivery requires manual
inspection; do not replay or rewrite evidence. These are durable boundaries, not runtime crash-resume.

## History and compatibility

The old DELIVERY-002 consumer remains in `delivery_legacy.py` solely for compatibility tests and
legacy pointer reading. Production commands never dispatch its execute/accept methods. Existing
`.switchyard/runs/<correlation>.jsonl`, advisory analysis files, `.claude/delivery/` and historical
metrics remain unchanged. Active legacy work blocks a new delivery until explicitly archived after
review; it cannot resume or accept as V2. A closed legacy pointer can yield to new V2 work.
`/start` and `/handoff` inspect status; standalone design still refuses active/inconsistent work.

## Verification and inherited limitations

Run `npm run test:workflow` for V2 integration, legacy compatibility and standalone design tests.
`python3 scripts/verify-delivery.py` additionally builds, runs all existing JS selftests and builds
Storybook. Tests use fake provider processes and real disposable Git repositories; zero live calls.
Existing Electron harnesses isolate application data and databases.

Inherited V2 limitations remain: no automatic provider retry, no independent successful command-tool
telemetry, no push/PR automation, no provider-session authority, no automatic interrupted-run resume,
and manual recovery for documented partial writes/commit publication ambiguity. Worktree/workspace
access must be exclusive and cooperative during QA. The developer-command wrapper retains
its existing POSIX flock requirement; the reused application-data resolver is cross-platform. See the frozen checkout's
`docs/design/v2-readiness.md` and `docs/design/work-contract.md` for authoritative contracts.
