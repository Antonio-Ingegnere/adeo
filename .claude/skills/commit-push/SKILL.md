---
name: commit-push
description: Safely commit and push the current intended change with Haiku. Use whenever the user says commit and push, commit & push, commit then push, or asks to save and publish the current Git change.
argument-hint: [optional commit intent]
model: haiku
effort: low
disable-model-invocation: false
---

If `.switchyard/current.json` exists, run `python3 .claude/scripts/delivery.py status`.
An active lifecycle must use `/accept` with human QA and exact staged-patch approval;
never bypass it with a direct commit. On inconsistent state, stop. Never stage `.switchyard/`
or append to the legacy metrics ledger. Push remains separate explicit authorization.

Perform a **safe narrow commit followed by an ordinary push**. Git bookkeeping only; never implement, repair, redesign, or re-review product code.

## Commit boundary

1. Inspect `git status --short`, current branch, and staged state.
4. Never use `git add .`, `git add -A`, `git commit -a`, wildcard staging, or directory-wide staging. Stage explicit paths only.
5. Leave pre-existing unrelated modified/untracked files untouched. Ambiguous path ownership means stop and report the candidate list rather than guessing.
6. Inspect only the staged diff needed to verify the boundary; do not conduct another product review.
7. Run `git diff --cached --check`. If it fails, stop instead of repairing product code.
8. Create one concise commit message grounded in the staged diff and commit it.

## Push

9. Determine the current branch and upstream. Never switch branches.
10. Never force-push, rewrite history, reset, rebase, or amend.
11. Push with ordinary `git push` when an upstream exists. If none exists, and `origin` exists, use `git push -u origin <current-branch>`.
12. Report commit SHA, pushed branch, committed paths, and any unrelated working-tree changes left untouched.
