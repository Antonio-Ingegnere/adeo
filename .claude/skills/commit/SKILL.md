---
name: commit
description: Commit the current intended change safely with Haiku. Use when the user asks to commit, create a git commit, or save the current change in Git.
argument-hint: [optional commit intent]
model: haiku
effort: low
disable-model-invocation: false
---

Perform a **safe narrow Git commit**. This skill owns Git bookkeeping only; it does not implement, repair, redesign, or re-review product code.

1. Inspect `git status --short`, current branch, and staged state. Never run broad repository reconnaissance.
2. If `.claude/delivery/current.json` exists, read only compact `python3 .claude/scripts/delivery.py status --json` and use its `changed_paths` as the primary candidate set. Do not read `status --full`.
3. `docs/agent/delivery-metrics.jsonl` may be included when it was appended by `/qa-accept` for the same accepted delivery. `.claude/delivery/current.json` is never committed.
4. Never use `git add .`, `git add -A`, `git commit -a`, wildcard staging, or directory-wide staging. Stage **explicit file paths only**.
5. Do not stage pre-existing unrelated modified/untracked files. If a path cannot be tied to the requested/delivery change, leave it alone.
6. Inspect only the staged diff needed to confirm the commit boundary. Do not perform another product review or verifier pass.
7. Create one concise commit message describing the accepted change. Do not invent issue IDs or claims not supported by the diff.
8. Run `git diff --cached --check` before committing. If it fails, stop; do not repair product code from this skill.
9. Commit. Do not push unless the user also asked to push; for "commit and push", use `/commit-push` behavior instead.
10. Report commit SHA and explicitly state which paths were committed and whether unrelated working-tree changes remain.

If there is no unambiguous intended change to commit, stop with the candidate path list instead of guessing.
