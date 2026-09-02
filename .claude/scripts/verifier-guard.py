#!/usr/bin/env python3
"""Fail closed on verifier mutation and enforce risk/mode model routing."""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path


VERIFIER_AGENTS = {"verifier", "verifier-lite", "verifier-targeted"}


def fail(message: str) -> None:
    print(f"Verifier boundary: {message}", file=sys.stderr)
    raise SystemExit(2)


def inside(path: str, root: str) -> bool:
    try:
        return os.path.commonpath([os.path.realpath(path), root]) == root
    except ValueError:
        return False


def state_data() -> dict[str, object]:
    root = Path(os.environ["CLAUDE_PROJECT_DIR"]).resolve()
    current = root / ".claude" / "delivery" / "current.json"
    if not current.is_file():
        fail("delivery state is missing")
    try:
        data = json.loads(current.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        fail("delivery state is unreadable")
    if not isinstance(data, dict):
        fail("delivery state has invalid shape")
    return data


def expected_route(data: dict[str, object]) -> str:
    mode = str(data.get("verification_mode") or "full")
    if mode == "targeted":
        return "verifier-targeted"
    model = data.get("change_model")
    risk = str(model.get("risk") if isinstance(model, dict) else "low")
    return "verifier" if risk == "high" else "verifier-lite"


def require_correct_agent(data: dict[str, object], agent_type: str | None) -> None:
    expected = expected_route(data)
    if agent_type not in VERIFIER_AGENTS:
        fail(f"verification must run in `{expected}`, not `{agent_type or 'main-session'}`")
    if agent_type != expected:
        fail(f"verification route is `{expected}`, not `{agent_type}`")


def require_claim(data: dict[str, object], agent_type: str | None) -> None:
    require_correct_agent(data, agent_type)
    claim = data.get("verifier_claim")
    claimed = isinstance(claim, dict)
    state = str(data.get("state") or "")
    if state != "VERIFYING" or not claimed:
        fail(
            "claim verifier budget before reading or testing "
            f"(state={state or 'missing'}, claimed={claimed})"
        )
    route = str(claim.get("route") or "") if isinstance(claim, dict) else ""
    expected = expected_route(data)
    if route and route != expected:
        fail(f"verifier claim route `{route}` does not match expected `{expected}`")


def check_file(data: dict[str, object], agent_type: str | None) -> None:
    state = state_data()
    require_claim(state, agent_type)
    root = os.path.realpath(os.environ["CLAUDE_PROJECT_DIR"])
    tool_input = data.get("tool_input") or {}
    if not isinstance(tool_input, dict):
        fail("invalid tool input")
    requested = str(tool_input.get("file_path", ""))
    if inside(requested, root):
        fail("production, tests, workflow, and Git-tracked repository files are read-only")


def check_bash(data: dict[str, object], agent_type: str | None) -> None:
    tool_input = data.get("tool_input") or {}
    if not isinstance(tool_input, dict):
        fail("invalid Bash input")
    command = str(tool_input.get("command", ""))
    normalized = " ".join(command.split())
    state = state_data()

    if re.search(r"delivery\.py\s+status\b.*(?:^|\s)--full(?:\s|$)", normalized):
        fail("full delivery status is runtime-debug only; use compact `delivery.py status --json`")

    if re.search(r"delivery\.py\s+verifier-claim\b", normalized):
        # Claim is the one verifier command permitted before claim existence, but
        # the correct agent route is still deterministic.
        require_correct_agent(state, agent_type)
        return

    require_claim(state, agent_type)

    if re.search(r"\bapply_patch\b|\bsed\s+-i\b|\bperl\s+-pi\b", normalized):
        fail("in-place repository editing is forbidden")
    if re.search(r"\b(rm|mv|cp|touch|mkdir|truncate)\b", normalized):
        fail("direct filesystem mutation is forbidden; temporary reports use the Write tool outside the repository")
    if re.search(r"\b(npm|pnpm|yarn)\b\s+(install|ci|add|remove|update|upgrade)\b", normalized):
        fail("dependency mutation is forbidden")
    if re.search(r"\bgit\b.*\b(add|commit|checkout|switch|reset|restore|clean|merge|rebase|cherry-pick|push|pull|tag)\b", normalized):
        fail("Git mutation is forbidden")

    redirect = re.search(r"(?:^|\s)(?:>{1,2}|\btee\b)\s*([^\s]+)", normalized)
    if redirect:
        target = redirect.group(1).strip("'\"")
        if not target.startswith(("/tmp/", "/private/tmp/", "/dev/")):
            fail("shell output may only be written to a temporary path")


def main() -> None:
    data = json.load(sys.stdin)
    tool = str(data.get("tool_name", ""))
    agent_type = str(data.get("agent_type")) if data.get("agent_type") else None
    if tool in {"Read", "Grep", "Glob"}:
        require_claim(state_data(), agent_type)
    elif tool in {"Write", "Edit"}:
        check_file(data, agent_type)
    elif tool == "Bash":
        check_bash(data, agent_type)


if __name__ == "__main__":
    main()
