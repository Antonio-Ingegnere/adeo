---
name: accept
description: Commit only the exact reviewed change after explicit successful human manual QA.
disable-model-invocation: true
---

Use only after the human explicitly confirms that the latest QA-ready result works.
Inspect `git status --short`, `git diff`, and `git diff --cached` to identify the intended scope.
Stage only explicitly reviewed paths or hunks. Never use broad staging. A path may contain mixed
work; file membership alone is not proof of scope. If changes cannot be safely separated, stop.
Do not stash, discard, or commit unrelated work to make checks pass.
Run `python3 .claude/scripts/delivery.py inspect`. Present the staged patch, commit message,
`head` and `patch_sha256` for human approval. If that exact patch/HEAD was already explicitly
approved in this conversation, reuse the approval; otherwise obtain it now. Never recalculate an
approval silently after files or HEAD change. `/accept` establishes manual QA, not blanket approval
for unrelated staged work.
Then run once:
```
python3 .claude/scripts/delivery.py accept --approved-head <reviewed-head> --approved-patch-sha256 <reviewed-digest> --message "<approved-message>" --manual-qa-passed
```
Report ACCEPTED or COMMIT_BLOCKED. Do not push. Do not bypass the preset with git commit.
If scope inspection blocks, report COMMIT_BLOCKED and the reason; no acceptance run or commit
has occurred yet. If the preset blocks, its terminal is recorded and the lifecycle stays open.
