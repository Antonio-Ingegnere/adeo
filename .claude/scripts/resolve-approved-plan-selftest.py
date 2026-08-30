"""Isolated checks for FAST, STANDARD, and FULL implementation gates."""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
from pathlib import Path


RESOLVER = Path(__file__).with_name("resolve-approved-plan.py").resolve()


def plan(status: str = "APPROVED", questions: str = "None.") -> str:
    return f"""# Implementation Plan

## Open Questions

{questions}

## Implementation Status

`{status}`
"""


def pointer(
    lifecycle: str = "APPROVED",
    snapshot: str = ".claude/plans/archive/example-r002-approved.md",
) -> str:
    return f"""# Current implementation plan

Plan ID: example
Active Plan: .claude/plans/active/example.md
Approved Snapshot: {snapshot}
Lifecycle Status: {lifecycle}
Revision: 2
Source Specification: spec/ui/example.md
"""


def feature(
    mode: str,
    status: str,
    decisions: str = "None.",
    blocking: str = "None.",
    ready: str = "YES",
    full_plan: str = "None",
    approved_snapshot: str = "None",
) -> str:
    return f"""# Feature: Example

Mode: {mode}
Status: {status}
Escalated From: None
Full Plan: {full_plan}
Approved Snapshot: {approved_snapshot}

## Goal

Exercise the workflow gate.

## Acceptance Criteria

- The gate returns the authorized artifact.

## Open Decisions

{decisions}

## Readiness Review

BLOCKING:
{blocking}

NON-BLOCKING:
None.

READY FOR IMPLEMENTATION: {ready}
"""


def run(root: Path) -> subprocess.CompletedProcess[str]:
    env = {**os.environ, "CLAUDE_PROJECT_DIR": str(root)}
    return subprocess.run(
        [sys.executable, str(RESOLVER), "--print-path"],
        check=False,
        capture_output=True,
        text=True,
        env=env,
    )


def write(root: Path, relative: str, text: str) -> None:
    target = root / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text, encoding="utf-8")


def expect(result: subprocess.CompletedProcess[str], allowed: bool, label: str) -> None:
    if allowed and result.returncode != 0:
        raise AssertionError(f"{label} should pass: {result.stderr}")
    if not allowed and result.returncode == 0:
        raise AssertionError(f"{label} should be blocked")


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="adeo-plan-gate-") as temp:
        root = Path(temp)

        write(root, ".claude/workflow/current.md", feature("FAST", "READY"))
        result = run(root)
        expect(result, True, "ready FAST feature")
        if result.stdout.strip() != ".claude/workflow/current.md":
            raise AssertionError("FAST should resolve to the concise feature brief")

        write(
            root,
            ".claude/workflow/current.md",
            feature("STANDARD", "AWAITING_APPROVAL"),
        )
        expect(run(root), False, "unapproved STANDARD feature")

        write(root, ".claude/workflow/current.md", feature("STANDARD", "APPROVED"))
        expect(run(root), True, "approved STANDARD feature")

        write(
            root,
            ".claude/workflow/current.md",
            feature("FAST", "READY", decisions="Which behavior should ship?"),
        )
        expect(run(root), False, "FAST feature with open decision")

        write(
            root,
            ".claude/workflow/current.md",
            feature("FAST", "READY", blocking="1. Acceptance is ambiguous."),
        )
        expect(run(root), False, "FAST feature with blocker")

        write(
            root,
            ".claude/workflow/current.md",
            feature("FAST", "READY", ready="NO"),
        )
        expect(run(root), False, "FAST feature not ready")

        (root / ".claude/workflow/current.md").unlink()
        write(root, ".claude/plans/current.md", plan())
        expect(run(root), True, "legacy approved plan")

        write(root, ".claude/plans/current.md", pointer())
        write(root, ".claude/plans/archive/example-r002-approved.md", plan())
        expect(run(root), True, "approved pointer")

        write(root, ".claude/plans/current.md", pointer(lifecycle="DRAFT"))
        expect(run(root), False, "draft pointer")

        write(root, ".claude/plans/current.md", pointer())
        write(
            root,
            ".claude/plans/archive/example-r002-approved.md",
            plan(status="DRAFT"),
        )
        expect(run(root), False, "draft snapshot")

        write(
            root,
            ".claude/plans/archive/example-r002-approved.md",
            plan(questions="Which behavior should ship?"),
        )
        expect(run(root), False, "unresolved questions")

        write(
            root,
            ".claude/plans/current.md",
            pointer(snapshot="outside-approved.md"),
        )
        write(root, "outside-approved.md", plan())
        expect(run(root), False, "snapshot outside archive")

        write(root, ".claude/workflow/current.md", feature("FULL", "PLANNING"))
        write(root, ".claude/plans/current.md", pointer())
        write(root, ".claude/plans/archive/example-r002-approved.md", plan())
        expect(run(root), False, "FULL feature still in planning")

        write(
            root,
            ".claude/workflow/current.md",
            feature(
                "FULL",
                "APPROVED",
                full_plan=".claude/plans/active/example.md",
                approved_snapshot=(
                    ".claude/plans/archive/example-r002-approved.md"
                ),
            ),
        )
        expect(run(root), True, "FULL feature with matching approved plan")

        write(
            root,
            ".claude/workflow/current.md",
            feature(
                "FULL",
                "APPROVED",
                full_plan=".claude/plans/active/different.md",
                approved_snapshot=(
                    ".claude/plans/archive/example-r002-approved.md"
                ),
            ),
        )
        expect(run(root), False, "FULL feature with mismatched plan")

    print("Feature workflow resolver self-test passed")


if __name__ == "__main__":
    main()
