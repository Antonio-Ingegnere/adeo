---
name: commit
description: Commit the current intended change safely with Haiku. Use when the user asks to commit, create a git commit, or save the current change in Git.
argument-hint: [optional commit intent]
model: haiku
effort: low
disable-model-invocation: false
---

If `.switchyard/current.json` exists, run `python3 .claude/scripts/delivery.py status`.
An active lifecycle must use `/accept` with human QA and exact staged-patch approval;
never bypass it with a direct commit. On inconsistent state, stop. Never stage `.switchyard/`
or append to the legacy metrics ledger. Push remains separate explicit authorization.

Perform a **safe narrow Git commit**. This skill owns Git bookkeeping only; it does not implement, repair, redesign, or re-review product code.

1. Inspect `git status --short`, current branch, and staged state. Never run broad repository reconnaissance.
4. Never use `git add .`, `git add -A`, `git commit -a`, wildcard staging, or directory-wide staging. Stage **explicit file paths only**.
5. Do not stage pre-existing unrelated modified/untracked files. If a path cannot be tied to the requested/delivery change, leave it alone.
6. Inspect only the staged diff needed to confirm the commit boundary. Do not perform another product review or verifier pass.
7. Create one concise commit message describing the accepted change. Do not invent issue IDs or claims not supported by the diff.
8. Run `git diff --cached --check` before committing. If it fails, stop; do not repair product code from this skill.
9. Commit. Do not push unless the user also asked to push; for "commit and push", use `/commit-push` behavior instead.
10. Report commit SHA and explicitly state which paths were committed and whether unrelated working-tree changes remain.

If there is no unambiguous intended change to commit, stop with the candidate path list instead of guessing.
