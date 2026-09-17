#!/usr/bin/env python3
"""Fast regression checks for standalone Product Designer routing/guard semantics."""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

CLAUDE = Path(__file__).resolve().parents[1]
GUARD = Path(__file__).with_name("delivery-owner-guard.py").resolve()
SKILL = CLAUDE / "skills" / "design" / "SKILL.md"
AGENT = CLAUDE / "agents" / "product-designer.md"


def write_state(root: Path, *, state: str, worker_claim=None, verifier_claim=None) -> Path:
    path = root / ".claude" / "delivery" / "current.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({
        "version": 2,
        "id": "designer-selftest",
        "task": "designer selftest",
        "delivery_target": "production",
        "state": state,
        "worker_claim": worker_claim,
        "verifier_claim": verifier_claim,
    }, indent=2) + "\n", encoding="utf-8")
    return path


def guard(root: Path, *, allowed: bool) -> None:
    env = os.environ.copy()
    env["CLAUDE_PROJECT_DIR"] = str(root)
    result = subprocess.run(
        [sys.executable, str(GUARD), "--role", "product-designer"],
        input=json.dumps({"tool_name": "Read", "tool_input": {"file_path": str(root / "src/example.ts")}}),
        capture_output=True,
        text=True,
        env=env,
    )
    if allowed and result.returncode != 0:
        raise AssertionError(f"guard should allow standalone designer: {result.stderr}")
    if not allowed and result.returncode == 0:
        raise AssertionError("guard should block product-designer for owned/inconsistent delivery state")


def main() -> None:
    if not SKILL.is_file():
        raise AssertionError("missing /design skill")
    skill = SKILL.read_text(encoding="utf-8")
    for token in ("name: design", "model: haiku", "product-designer", "DONE", "FAILED"):
        if token not in skill:
            raise AssertionError(f"/design skill missing {token!r}")
    if not AGENT.is_file():
        raise AssertionError("missing product-designer agent")
    agent = AGENT.read_text(encoding="utf-8")
    if "model: sonnet" not in agent or "effort: medium" not in agent:
        raise AssertionError("product-designer model routing changed unexpectedly")

    with tempfile.TemporaryDirectory(prefix="adeo-product-designer-") as tmp:
        root = Path(tmp)
        (root / "src").mkdir()
        (root / "src/example.ts").write_text("baseline\n", encoding="utf-8")

        # Missing state means standalone use.
        guard(root, allowed=True)

        current = write_state(root, state="DONE")
        guard(root, allowed=True)

        write_state(root, state="FAILED")
        guard(root, allowed=True)

        write_state(root, state="DONE", worker_claim={"role": "implementer", "id": "stale-worker"})
        guard(root, allowed=False)

        write_state(root, state="DONE", verifier_claim={"role": "verifier-lite", "id": "stale-verifier"})
        guard(root, allowed=False)

        write_state(root, state="IMPLEMENTING", worker_claim={"role": "implementer", "id": "W-impl"})
        guard(root, allowed=False)

        write_state(root, state="IMPLEMENTING", worker_claim={"role": "product-designer", "id": "W-design"})
        guard(root, allowed=True)

        current.unlink(missing_ok=True)

    print("Product Designer standalone guard/skill self-test passed")


if __name__ == "__main__":
    main()
