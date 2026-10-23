---
name: answer
description: Answer a pending human-input wait; records the answer and continues the same work.
disable-model-invocation: true
---

Read `python3 .claude/scripts/delivery.py status`. Require `human_input_pending: true`; otherwise stop and report the status.
Take `human_input_request_id` and `resume_targets` from status; show `question` to the human if they have not answered it.

Choose the target:
- one declared target: use it (no flag needed);
- several: use one only if the human's instruction clearly selects it; otherwise ask which declared target to use.

Run exactly once:
```
python3 .claude/scripts/delivery.py answer --request-id <human_input_request_id> --feedback "<literal human answer>" [--resume-to <target>]
```
The answer is recorded and the same work continues immediately from the selected target; Switchyard validates the route and budgets.
Do not call `/deliver resume` afterwards; it is only for interrupted work. Report the target it continued at and the resulting status/terminal.
If it fails, report the error; do not retry or edit pointers.
