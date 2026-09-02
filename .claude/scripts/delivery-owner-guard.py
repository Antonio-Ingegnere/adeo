#!/usr/bin/env python3
"""Stop delivery subagents before they consume context for an unowned phase."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path


READ_STATES = {
    "product-designer": {"UNDERSTANDING", "IMPLEMENTING", "REPAIRING"},
}
WRITE_STATES = {
    "product-designer": {"IMPLEMENTING", "REPAIRING"},
}


def fail(role: str, message: str) -> None:
    print(f"{role} delivery boundary: {message}", file=sys.stderr)
    raise SystemExit(2)


def runtime(role: str) -> tuple[str, str | None] | None:
    root = Path(os.environ["CLAUDE_PROJECT_DIR"]).resolve()
    current = root / ".claude" / "delivery" / "current.json"
    if not current.is_file():
        return None
    try:
        data = json.loads(current.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        fail(role, "delivery state is unreadable")
    if not isinstance(data, dict):
        fail(role, "delivery state has invalid shape")
    claim = data.get("worker_claim")
    owner = claim.get("role") if isinstance(claim, dict) else None
    return str(data.get("state") or ""), str(owner) if owner else None


def safe_control(command: str, role: str) -> str | None:
    normalized = " ".join(command.split())
    if re.fullmatch(
        rf"python3?\s+\.claude/scripts/delivery\.py\s+worker-claim\s+--role\s+{re.escape(role)}(?:\s+--json)?",
        normalized,
    ):
        return "claim"
    if re.fullmatch(
        r"python3?\s+\.claude/scripts/delivery\.py\s+status(?:\s+--json)?",
        normalized,
    ):
        return "status"
    if role == "product-designer" and re.fullmatch(
        r"python3?\s+\.claude/scripts/delivery\.py\s+model\s+--file\s+\S+",
        normalized,
    ):
        return "model"
    return None


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--role", choices=sorted(READ_STATES), required=True)
    args = parser.parse_args()
    role = args.role

    data = json.load(sys.stdin)
    tool = str(data.get("tool_name", ""))
    tool_input = data.get("tool_input") or {}
    if not isinstance(tool_input, dict):
        fail(role, "invalid tool input")

    context = runtime(role)
    if context is None:
        return  # standalone agent use outside /deliver remains supported
    state, owner = context

    if tool == "Bash":
        command = str(tool_input.get("command", ""))
        normalized = " ".join(command.split())
        if re.search(r"delivery\.py\s+status\b.*(?:^|\s)--full(?:\s|$)", normalized):
            fail(role, "full delivery status is runtime-debug only; use compact `delivery.py status --json`")
        if role == "product-designer" and (
            re.search(
                r"delivery\.py\s+(quality|verifier(?:-claim)?|authorize-high|handoff|checkpoint|qa-fix|qa-accept|report)\b",
                normalized,
            )
            or re.search(r"\bnpm\s+run\s+quality:delivery\b", normalized)
        ):
            fail(role, "execution owners cannot record quality/verification/readiness receipts")
        control = safe_control(command, role)
        if control in {"claim", "status"}:
            return
        if owner != role:
            fail(role, f"phase is owned by {owner or 'nobody'}; claim it before doing work")
        if control == "model":
            if state != "UNDERSTANDING":
                fail(role, f"Change Model may not be recorded while state is {state}")
            return
        if state not in READ_STATES[role]:
            fail(role, f"work is not allowed while delivery is {state}")
        if state == "UNDERSTANDING":
            mutates = bool(
                re.search(
                    r"\b(?:apply_patch|sed\s+-i|perl\s+-pi|rm|mv|cp|touch|mkdir|truncate)\b|(?:>{1,2}|\btee\b)",
                    normalized,
                )
            )
            if mutates and not re.search(r"(?:/tmp/|/private/tmp/|/dev/)", normalized):
                fail(role, "repository mutation is forbidden before the Change Model is recorded")
        return

    if owner != role:
        fail(role, f"phase is owned by {owner or 'nobody'}; claim it before reading context")

    if tool in {"Read", "Grep", "Glob"}:
        if state not in READ_STATES[role]:
            fail(role, f"reads are not allowed while delivery is {state}")
        return

    if tool in {"Write", "Edit"}:
        if state not in WRITE_STATES[role]:
            fail(role, f"repository writes are not allowed while delivery is {state}")
        return


if __name__ == "__main__":
    main()
