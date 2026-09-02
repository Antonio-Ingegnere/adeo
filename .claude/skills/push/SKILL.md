---
name: push
description: Push the current branch safely with Haiku. Use when the user asks to push, git push, or publish already committed changes.
argument-hint: [optional remote/branch intent]
model: haiku
effort: low
disable-model-invocation: false
---

Perform a **safe Git push only**. Do not modify source files and do not create a commit unless the user explicitly asked for commit and push; in that case use `/commit-push` behavior.

1. Read the current branch and configured upstream with narrow Git commands only.
2. Do not run repository reconnaissance or product verification.
3. Never use `--force`, `--force-with-lease`, history rewriting, reset, rebase, or amend.
4. If the current branch has an upstream, run ordinary `git push`.
5. If no upstream exists and the user explicitly asked to push the current branch, use `git push -u origin <current-branch>` only when `origin` exists. Otherwise stop and report the missing upstream/remote.
6. Do not switch branches.
7. Report the pushed branch and resulting commit SHA.
