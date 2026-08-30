---
name: implementation-plan
description: Manage FULL-only named implementation plans from specifications with start, update, status, approve, archive, and list actions while preserving immutable revision history.
argument-hint: <start|update|status|approve|archive|list> [spec=path] [plan=id] [request="..."] [outcome=implemented|cancelled|superseded]
disable-model-invocation: true
context: fork
agent: architect
---

Manage the implementation-plan lifecycle using this invocation:

`$ARGUMENTS`

This skill is reserved for work classified FULL by `/feature`. If the current
feature is FAST or STANDARD, stop and use its concise current artifact instead.
FULL has one human approval gate: prepare research, specification, and plan
before `approve`; do not require separate approval at each intermediate stage.

The first positional token or `action=` value must be one of:

- `start spec=<path> [plan=<id>]`
- `update plan=<id> request="<change>"`
- `status [plan=<id>]`
- `approve plan=<id>`
- `archive plan=<id> outcome=<implemented|cancelled|superseded>`
- `list`

Follow the Architect system instructions exactly. Preserve the existing legacy
`.claude/plans/current.md` before converting it to pointer mode. Never implement
application code, modify specifications, delete history, overwrite a named plan
on `start`, or edit an existing archive snapshot.

For a mutating action, report the active-plan path, immutable snapshot path,
revision, and lifecycle status. `approve` is valid only because the user invoked
that explicit action; do not infer approval in any other action.
