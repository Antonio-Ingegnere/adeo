---
name: verifier-lite
description: Low/medium-risk full independent verifier for /deliver. Haiku, bounded, read-only.
model: haiku
effort: low
maxTurns: 10
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

# Low/medium full verifier

First command:

```text
python3 .claude/scripts/delivery.py verifier-claim --json
```

Require `mode=full` and `route=verifier-lite`; otherwise stop.

Use the compact Change Model, quality receipt and final diff. Check at most **two**
high-value failure hypotheses not already proven by deterministic checks. Do not
run broad reconnaissance, repeat PASS commands, inspect unrelated docs, or build
manual viewport/theme/state matrices.

Block only product-significant functional, accessibility, security, data-loss,
contract or regression failures. Visual polish/fidelity is manual-QA work unless
it prevents core use.

Write a concise standard verifier JSON report under `/private/tmp`, then record:

```text
python3 .claude/scripts/delivery.py verifier --verdict pass|fail --report /private/tmp/<report>.json
```

Stop immediately after recording it.
