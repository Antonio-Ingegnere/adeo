# Switchyard V2 delivery in Adeo

V2-009 consumes frozen Switchyard `51d69e9239758b614beea5328f88a8c2e7cce417` through the existing
local checkout/sys.path mechanism. No package installation or copied workflow engine is introduced.

## Local setup

Use that exact unmodified checkout with its requirements installed. Ignored `.switchyard/config.json`
contains absolute local paths for `switchyard_root`, `python_executable`, `claude_executable`,
`codex_executable`, `git_executable`, `node_executable`, and `npm_executable`. An optional
`model_aliases_file` points to local JSON in the existing V2 provider/selector mapping format.
Never commit these paths, aliases or credentials. Configuration rejects older/modified engine sources.
ProviderRuntimeConfig receives executable/cwd/alias configuration; capabilities and provider commands
remain Switchyard-owned. Adeo targets its actual root worktree, never a common parent directory.

Adeo loads `examples/delivery/workflows-v2.yaml` directly. It replaces only the public command-profile
argv with `<configured Python> <target>/scripts/verify-delivery.py`, preserving exit mapping, evidence
capture, graph, budgets, models, efforts and capability policy. The invocation timeout is 1800 seconds;
each individual project-verifier check retains its existing 180-second bound. No model verdict.

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

The ID is a stale-action guard, not a manually authored artifact. Humans choose accept/reopen;
Switchyard owns safe staging and the final commit. Do not run git add/commit as a competing acceptance.
COMMIT_BLOCKED includes the frozen reason; there is no cleanup, fallback or retry. REOPENED retains
HEAD/worktree and feedback. A later explicitly requested delivery may include the displayed durable
feedback in its new immutable human request. No transcript/session recovery or automatic follow-up.

`/repair` now explicitly refuses new calls and points to BUGFIX. `/qa-fix` redirects to `/reopen`;
`/qa-accept` aliases `/accept`; `/qa-escalate` stays retired. No second orchestration engine is active.

## Persistence and restart

Ordinary delivery state remains under ignored `.switchyard/work/<work-id>/`: request, artifacts,
handoffs, manifest and events.jsonl. `.switchyard/current.json` contains only engine, work_id,
repo_id, flow, phase, candidate_identity and a cached terminal. It contains no artifact bodies,
fingerprints, provider configuration, environment or decision records. Events and V2 records are
read and verified when presenting status; cached terminal values do not authorize acceptance.
Status projects logical state and last invocation rung/provider/profile from the public compiled
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
