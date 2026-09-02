#!/usr/bin/env python3
"""Protect delivery authority and durable decision artifacts from implementers."""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path


PROTECTED_FILES = {"docs/agent/delivery-metrics.jsonl"}

PROTECTED_PREFIXES = (
    ".claude/delivery/",
    ".claude/workflow/",
    ".claude/plans/",
    "spec/",
    "ui-ux/ux/",
)


QA_REPAIR_AGENTS = {"qa-repairer", "qa-repairer-sonnet"}


def require_qa_repair_agent(agent_type: str | None) -> None:
    root = Path(os.environ["CLAUDE_PROJECT_DIR"]).resolve()
    current = root / ".claude" / "delivery" / "current.json"
    if not current.is_file():
        return
    try:
        data = json.loads(current.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        fail("delivery state is unreadable")
    if not isinstance(data, dict):
        fail("delivery state has invalid shape")
    if str(data.get("state") or "") != "REPAIRING":
        return
    expected = data.get("qa_repair_route")
    if expected not in QA_REPAIR_AGENTS:
        return
    if agent_type != expected:
        fail(
            f"manual-QA repair route is `{expected}`, not `{agent_type or 'main-session'}`"
        )


def fail(message: str) -> None:
    print(f"Implementer boundary: {message}", file=sys.stderr)
    raise SystemExit(2)


def repository_relative(path: str) -> str | None:
    root = os.path.realpath(os.environ["CLAUDE_PROJECT_DIR"])
    resolved = os.path.realpath(path)
    try:
        if os.path.commonpath([resolved, root]) != root:
            return None
    except ValueError:
        return None
    return os.path.relpath(resolved, root).replace(os.sep, "/")


def delivery_context() -> tuple[str | None, str | None]:
    root = Path(os.environ["CLAUDE_PROJECT_DIR"]).resolve()
    current = root / ".claude" / "delivery" / "current.json"
    if not current.is_file():
        return None, None
    try:
        data = json.loads(current.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        fail("delivery state is unreadable")
    if not isinstance(data, dict):
        fail("delivery state has invalid shape")
    claim = data.get("worker_claim")
    role = claim.get("role") if isinstance(claim, dict) else None
    return str(data.get("state") or ""), str(role) if role else None


def protected(path: str) -> bool:
    relative = repository_relative(path)
    return relative is not None and (
        relative in PROTECTED_FILES
        or any(
            relative == prefix.rstrip("/") or relative.startswith(prefix)
            for prefix in PROTECTED_PREFIXES
        )
    )


def check_read() -> None:
    state_name, role = delivery_context()
    if state_name is None:
        return
    if role != "implementer":
        fail(
            "claim the implementer phase before reading repository context "
            f"(worker={role or 'none'})"
        )
    if state_name not in {"UNDERSTANDING", "IMPLEMENTING", "REPAIRING"}:
        fail(f"implementer reads are not allowed while delivery is {state_name}")


def check_file(data: dict[str, object]) -> None:
    tool_input = data.get("tool_input") or {}
    if not isinstance(tool_input, dict):
        fail("invalid tool input")
    requested = str(tool_input.get("file_path", ""))
    relative = repository_relative(requested)
    if relative is not None:
        state_name, role = delivery_context()
        if state_name is not None and (
            state_name not in {"IMPLEMENTING", "REPAIRING"} or role != "implementer"
        ):
            fail(
                "repository writes require IMPLEMENTING/REPAIRING and the single "
                f"implementer worker claim (state={state_name}, worker={role or 'none'})"
            )
    if protected(requested):
        fail("delivery state, durable decisions, specifications, and verifier evidence are read-only")


def check_bash(data: dict[str, object]) -> None:
    tool_input = data.get("tool_input") or {}
    if not isinstance(tool_input, dict):
        fail("invalid Bash input")
    command = " ".join(str(tool_input.get("command", "")).split())

    state_name, role = delivery_context()

    if re.search(r"delivery\.py\s+status\b.*(?:^|\s)--full(?:\s|$)", command):
        fail("full delivery status is runtime-debug only; use compact `delivery.py status --json`")

    safe_delivery_control = bool(
        re.search(r"delivery\.py\s+(?:status|worker-claim)\b", command)
    )
    model_control = bool(re.search(r"delivery\.py\s+model\b", command))
    if state_name is not None and not safe_delivery_control:
        if role != "implementer":
            fail(
                "this phase is not owned by the implementer "
                f"(worker={role or 'none'}); stop instead of doing parallel work"
            )
        if state_name == "UNDERSTANDING" and not model_control:
            # Read-only reconnaissance remains allowed below; mutation checks
            # will reject repository writes until the model is recorded.
            pass
        elif state_name not in {"UNDERSTANDING", "IMPLEMENTING", "REPAIRING"}:
            fail(f"implementer work is not allowed while delivery is {state_name}")

    # Candidate workers may inspect status and run focused checks, but only the
    # orchestrator/verifier may create authority-bearing receipts or approvals.
    if re.search(
        r"delivery\.py\s+(quality|verifier(?:-claim)?|authorize-high|handoff|checkpoint|qa-fix|qa-attempt|qa-escalate|qa-accept|report)\b",
        command,
    ):
        fail("candidate workers cannot record verification, authorization, handoff, or readiness")
    if re.search(r"\bnpm\s+run\s+quality:delivery\b", command):
        fail("candidate workers cannot run the authority-bearing delivery quality gate")
    if ".claude/delivery/current.json" in command:
        fail("direct delivery-state access through Bash is forbidden; use delivery.py status")

    mutator = re.search(
        r"\b(?:apply_patch|sed\s+-i|perl\s+-pi|rm|mv|cp|touch|mkdir|truncate)\b",
        command,
    )
    redirection = re.search(r"(?:>{1,2}|\btee\b)", command)
    if state_name not in {"IMPLEMENTING", "REPAIRING"} and (mutator or redirection):
        # Before the Change Model authorizes implementation, shell work is
        # reconnaissance only. Temporary model/report creation under /tmp is
        # allowed, but repository mutation is not.
        if not re.search(r"(?:/tmp/|/private/tmp/|/dev/)", command):
            fail(
                f"shell mutation is forbidden while delivery is {state_name or 'missing'}; "
                "record the Change Model first"
            )
    if mutator or redirection:
        for protected_file in PROTECTED_FILES:
            if protected_file in command:
                fail(f"shell mutation of protected path {protected_file} is forbidden")
        for prefix in PROTECTED_PREFIXES:
            if prefix.rstrip("/") in command:
                fail(f"shell mutation of protected path {prefix} is forbidden")


def main() -> None:
    data = json.load(sys.stdin)
    agent_type = str(data.get("agent_type")) if data.get("agent_type") else None
    require_qa_repair_agent(agent_type)
    tool = str(data.get("tool_name", ""))
    if tool in {"Read", "Grep", "Glob"}:
        check_read()
    elif tool in {"Write", "Edit"}:
        check_file(data)
    elif tool == "Bash":
        check_bash(data)


if __name__ == "__main__":
    main()
