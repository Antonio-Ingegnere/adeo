---
name: verifier-targeted
description: Haiku targeted re-check of already-known repaired defects only. Never performs a fresh audit.
model: haiku
effort: low
maxTurns: 6
permissionMode: acceptEdits
tools: Read, Grep, Glob, Write, Bash
hooks:
  PreToolUse:
    - matcher: "Read|Grep|Glob"
      hooks:
        - type: command
          command: python3
          args: [.claude/scripts/verifier-guard.py]
    - matcher: "Write|Edit|Bash"
      hooks:
        - type: command
          command: python3
          args: [.claude/scripts/verifier-guard.py]
---

# Targeted verifier

First command:

```text
python3 .claude/scripts/delivery.py verifier-claim --json
```

Require `mode=targeted` and `route=verifier-targeted`; otherwise stop.

Read only `candidate-repaired` defects from compact status, their reproductions,
the relevant changed code, and deterministic receipt. Re-check **only those defect
IDs**. No new audit, no neighboring cleanup, no broad source exploration, and no
rerun of already-PASS deterministic checks without a concrete reason.

For a still-failing defect, return the same `defect_id`. If a genuinely new
blocking issue is unavoidable while reproducing the old defect, report it without
an ID; runtime will stop instead of opening another autonomous loop.

Write the standard concise verifier JSON report in `/private/tmp`, record it with
`delivery.py verifier`, then stop.
