"""Validate and resolve the FAST, STANDARD, or FULL implementation context."""

from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path


def fail(message: str) -> "NoReturn":
    print(message, file=sys.stderr)
    raise SystemExit(2)


def field(text: str, name: str) -> str | None:
    match = re.search(rf"^{re.escape(name)}:\s*(.+?)\s*$", text, re.MULTILINE)
    return match.group(1).strip().strip("`") if match else None


def section(text: str, name: str) -> str:
    match = re.search(
        rf"^##\s*{re.escape(name)}\s*$\n(.*?)(?=^##\s|\Z)",
        text,
        re.MULTILINE | re.DOTALL,
    )
    return match.group(1).strip() if match else ""


def first_content(text: str) -> str:
    for line in text.splitlines():
        candidate = line.strip().strip("`")
        if candidate:
            return candidate
    return ""


def review_value(review: str, name: str) -> str:
    heading = re.search(
        rf"^{re.escape(name)}:[ \t]*(.*)$",
        review,
        re.MULTILINE,
    )
    if not heading:
        return ""
    inline = heading.group(1).strip().strip("`")
    if inline:
        return inline
    following = review[heading.end() :]
    body = re.split(r"^[A-Z][A-Z ]+:", following, maxsplit=1, flags=re.MULTILINE)[0]
    return first_content(body)


def resolve_full_plan(project_root: Path) -> Path:
    plans_root = (project_root / ".claude" / "plans").resolve()
    current = plans_root / "current.md"

    try:
        current_text = current.read_text(encoding="utf-8")
    except OSError:
        fail(
            "No implementation-plan pointer at .claude/plans/current.md. "
            "Run /implementation-plan start first."
        )

    active_pointer = field(current_text, "Active Plan")
    if active_pointer:
        lifecycle = field(current_text, "Lifecycle Status") or "missing"
        if lifecycle != "APPROVED":
            fail(
                "The selected plan is not implementation-authorized "
                f"(Lifecycle Status: {lifecycle}). Run the explicit "
                "/implementation-plan approve action after review."
            )

        snapshot_pointer = field(current_text, "Approved Snapshot")
        if not snapshot_pointer or snapshot_pointer == "None":
            fail("The selected plan has no immutable approved snapshot.")

        snapshot = (project_root / snapshot_pointer).resolve()
        archive_root = (plans_root / "archive").resolve()
        try:
            inside_archive = os.path.commonpath([snapshot, archive_root]) == str(archive_root)
        except ValueError:
            inside_archive = False
        if not inside_archive:
            fail("Approved Snapshot must resolve inside .claude/plans/archive/.")
        if not snapshot.is_file():
            fail(f"Approved Snapshot does not exist: {snapshot_pointer}")
        plan = snapshot
    else:
        # Backward compatibility: current.md was historically the full plan.
        plan = current

    plan_text = plan.read_text(encoding="utf-8")
    implementation_status = first_content(section(plan_text, "Implementation Status"))

    if implementation_status != "APPROVED":
        fail(
            "Implementation plan is not approved "
            f"(Implementation Status: {implementation_status or 'missing'})."
        )

    open_questions = section(plan_text, "Open Questions")
    first_question_line = first_content(open_questions)
    if first_question_line != "None.":
        fail("Implementation plan still has unresolved Open Questions.")

    return plan


def resolve(project_root: Path) -> Path:
    workflow = project_root / ".claude" / "workflow" / "current.md"
    if not workflow.is_file():
        return resolve_full_plan(project_root)

    text = workflow.read_text(encoding="utf-8")
    mode = (field(text, "Mode") or "").upper()
    status = (field(text, "Status") or "").upper()

    open_decisions = first_content(section(text, "Open Decisions"))
    if open_decisions != "None.":
        fail("The current feature still has unresolved Open Decisions.")

    review = section(text, "Readiness Review")
    blocking = review_value(review, "BLOCKING")
    readiness = review_value(review, "READY FOR IMPLEMENTATION")
    if blocking != "None.":
        fail("The current feature still has BLOCKING readiness findings.")
    if readiness != "YES":
        fail("The current feature is not marked READY FOR IMPLEMENTATION: YES.")

    if mode == "FULL":
        if status != "APPROVED":
            fail(
                "The FULL feature is still in planning. Run the explicit "
                "/implementation-plan approve action after its spec and plan "
                "are ready."
            )
        expected_active = field(text, "Full Plan")
        expected_snapshot = field(text, "Approved Snapshot")
        if not expected_active or expected_active == "None":
            fail("The FULL feature does not identify its active implementation plan.")
        if not expected_snapshot or expected_snapshot == "None":
            fail("The FULL feature does not identify its approved snapshot.")
        try:
            pointer_text = (
                project_root / ".claude" / "plans" / "current.md"
            ).read_text(encoding="utf-8")
        except OSError:
            fail(
                "The FULL feature has no selected plan. Run "
                "/implementation-plan start first."
            )
        if field(pointer_text, "Active Plan") != expected_active:
            fail("The FULL feature and selected active plan do not match.")
        if field(pointer_text, "Approved Snapshot") != expected_snapshot:
            fail("The FULL feature and selected approved snapshot do not match.")
        return resolve_full_plan(project_root)
    if mode not in {"FAST", "STANDARD"}:
        fail(f"Current feature has an invalid or missing Mode: {mode or 'missing'}.")

    required_status = "READY" if mode == "FAST" else "APPROVED"
    if status != required_status:
        if mode == "STANDARD" and status == "AWAITING_APPROVAL":
            fail(
                "The STANDARD mini spec awaits the one human approval gate. "
                "The user must run /feature approve before implementation."
            )
        fail(
            f"The {mode} feature is not implementation-authorized "
            f"(Status: {status or 'missing'}; required: {required_status})."
        )

    return workflow


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--print-path", action="store_true")
    args = parser.parse_args()

    project_root = Path(
        os.environ.get("CLAUDE_PROJECT_DIR", os.getcwd())
    ).resolve()
    plan = resolve(project_root)
    if args.print_path:
        print(plan.relative_to(project_root))


if __name__ == "__main__":
    main()
