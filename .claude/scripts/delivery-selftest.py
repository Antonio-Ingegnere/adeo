"""End-to-end checks for the machine-owned autonomous delivery lifecycle."""

from __future__ import annotations

import json
import hashlib
import subprocess
import sys
import tempfile
from pathlib import Path


DELIVERY = Path(__file__).with_name("delivery.py").resolve()


def run(root: Path, *arguments: str, allowed: bool = True) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(
        [sys.executable, str(DELIVERY), "--project-root", str(root), *arguments],
        check=False,
        capture_output=True,
        text=True,
    )
    if allowed and result.returncode != 0:
        raise AssertionError(
            f"delivery command should pass: {' '.join(arguments)}\n{result.stdout}\n{result.stderr}"
        )
    if not allowed and result.returncode == 0:
        raise AssertionError(f"delivery command should fail: {' '.join(arguments)}")
    return result


def git(root: Path, *arguments: str) -> None:
    subprocess.run(["git", "-C", str(root), *arguments], check=True, capture_output=True)


def make_repo(parent: Path, name: str) -> Path:
    root = parent / name
    root.mkdir()
    (root / "docs").mkdir()
    (root / "docs/example.md").write_text("baseline docs\n", encoding="utf-8")
    (root / "src").mkdir()
    (root / "src/example.ts").write_text("export const value = 'baseline';\n", encoding="utf-8")
    (root / "package.json").write_text('{"scripts":{"build":"node -e 0"}}\n', encoding="utf-8")
    (root / ".gitignore").write_text(".claude/delivery/current.json\n", encoding="utf-8")
    git(root, "init", "-q")
    git(root, "add", ".")
    git(
        root,
        "-c",
        "user.name=Workflow Test",
        "-c",
        "user.email=workflow@example.invalid",
        "commit",
        "-qm",
        "baseline",
    )
    return root


def write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")


def model(
    *,
    risk: str = "low",
    unknowns: list[str] | None = None,
    decision_required: bool = False,
) -> dict[str, object]:
    return {
        "target": "production",
        "intent": "Change the shipped product behavior.",
        "current_system": "The repository contains a baseline production module.",
        "domain": "src/example.ts represents the test product surface.",
        "flow": ["task -> production module"],
        "invariants": ["The production module remains readable."],
        "implementation_location": ["src/example.ts"],
        "affected": ["production behavior"],
        "do_not_change": ["Git history"],
        "unknowns": unknowns or [],
        "risk": risk,
        "evidence": [],
        "decision_required": decision_required,
    }


def report(
    verdict: str,
    *,
    defect_id: str | None = None,
    severity: str = "functional",
) -> dict[str, object]:
    defects: list[dict[str, object]] = []
    if verdict == "fail":
        defect: dict[str, object] = {
            "severity": severity,
            "expected": "Production module contains the intended result.",
            "actual": "The first candidate is incomplete.",
            "reproduction": ["Read src/example.ts"],
            "evidence": ["src/example.ts"],
            "suspected_area": "production module",
            "invariant_violated": "The delivered behavior must be complete.",
        }
        if defect_id:
            defect["defect_id"] = defect_id
        defects.append(defect)
    return {
        "verdict": verdict,
        "domain_correctness": {
            "assessment": "The change belongs to the production surface.",
            "evidence": ["src/example.ts"],
        },
        "implementation_correctness": {
            "assessment": "The production candidate is syntactically readable.",
            "evidence": ["git diff --check"],
        },
        "adversarial_scenarios": [
            {
                "scenario": "Read the complete file after the change.",
                "result": "Readable candidate inspected.",
                "evidence": "src/example.ts",
            }
        ],
        "defects": defects,
        "observations": [],
        "residual_risks": [],
    }


def state(root: Path) -> dict[str, object]:
    result = run(root, "status", "--json")
    return json.loads(result.stdout)


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="adeo-delivery-") as directory:
        parent = Path(directory)
        root = make_repo(parent, "normal")
        model_file = parent / "model.json"
        fail_report = parent / "verifier-fail.json"
        pass_report = parent / "verifier-pass.json"
        write_json(model_file, model())
        write_json(fail_report, report("fail"))
        write_json(pass_report, report("pass"))

        run(root, "start", "--task", "Update documented behavior")
        compact = state(root)
        if compact["state"] != "UNDERSTANDING":
            raise AssertionError("new delivery must begin in UNDERSTANDING")
        if "baseline" in compact or isinstance(compact.get("defects"), list):
            raise AssertionError("default JSON status must omit baseline/full defect history")
        full_status = json.loads(run(root, "status", "--json", "--full").stdout)
        if "baseline" not in full_status or not isinstance(full_status.get("defects"), list):
            raise AssertionError("--full JSON status must retain runtime-debug state")

        run(root, "worker-claim", "--role", "product-designer", allowed=False)
        run(root, "worker-claim", "--role", "implementer")
        (root / "src/example.ts").write_text("export const value = 'candidate';\n", encoding="utf-8")
        run(root, "model", "--file", str(model_file))
        if state(root)["state"] != "IMPLEMENTING":
            raise AssertionError("low-risk complete Change Model must authorize implementation")

        run(root, "quality")
        if state(root)["state"] != "VERIFYING":
            raise AssertionError("passing quality gate must transition to VERIFYING")

        claim = json.loads(run(root, "verifier-claim", "--json").stdout)
        if claim["mode"] != "full":
            raise AssertionError("first verifier claim must be full")
        run(root, "verifier", "--verdict", "fail", "--report", str(fail_report))
        if state(root)["state"] != "REPAIRING":
            raise AssertionError("verifier defects must transition to REPAIRING")

        run(root, "worker-claim", "--role", "implementer")
        (root / "src/example.ts").write_text("export const value = 'candidate repaired';\n", encoding="utf-8")
        run(root, "quality")
        claim = json.loads(run(root, "verifier-claim", "--json").stdout)
        if claim["mode"] != "targeted":
            raise AssertionError("repair verification must be targeted")
        run(root, "verifier", "--verdict", "pass", "--report", str(pass_report))
        if state(root)["state"] != "READY_FOR_PRODUCT_REVIEW":
            raise AssertionError("only matching quality and verifier receipts may transition READY")
        if "READY FOR PRODUCT REVIEW" not in run(root, "report").stdout:
            raise AssertionError("ready delivery must emit a product review package")

        (root / "src/example.ts").write_text("export const value = 'changed after verification';\n", encoding="utf-8")
        if state(root)["state"] != "REPAIRING":
            raise AssertionError("post-verification repository changes must invalidate READY")

        # `/deliver` is a shipping-product workflow. Storybook/design artifacts are
        # references and cannot become the candidate by accident.
        wrong_target = make_repo(parent, "wrong-target")
        run(
            wrong_target,
            "start",
            "--task",
            "/story/example prototype; implement this feature",
            "--reference",
            "/story/example",
        )
        run(wrong_target, "worker-claim", "--role", "product-designer", allowed=False)
        wrong_model = model()
        wrong_model["target"] = "prototype"
        wrong_model["implementation_location"] = ["ui-ux/ux/concepts/example.stories.ts"]
        wrong_model_file = parent / "wrong-target-model.json"
        write_json(wrong_model_file, wrong_model)
        run(wrong_target, "model", "--file", str(wrong_model_file), allowed=False)

        prototype_only = make_repo(parent, "prototype-only-candidate")
        proto_model_file = parent / "proto-reference-model.json"
        write_json(proto_model_file, model())
        run(
            prototype_only,
            "start",
            "--task",
            "Implement feature from Storybook prototype",
            "--reference",
            "/story/example",
        )
        run(prototype_only, "worker-claim", "--role", "implementer")
        run(prototype_only, "model", "--file", str(proto_model_file))
        concept = prototype_only / "ui-ux/ux/concepts/example.stories.ts"
        concept.parent.mkdir(parents=True)
        concept.write_text("export const Example = {};\n", encoding="utf-8")
        run(prototype_only, "quality", allowed=False)
        if state(prototype_only)["state"] != "REPAIRING":
            raise AssertionError("prototype-only candidate must never become a production delivery")

        # Retarget resets stale/wrong machine truth instead of continuing it.
        retargeted = make_repo(parent, "retarget")
        run(retargeted, "start", "--task", "Refine prototype", "--target", "prototype")
        run(
            retargeted,
            "retarget",
            "--target",
            "production",
            "--task",
            "Implement board feature in the shipping app",
            "--reference",
            "/story/board",
            "--reason",
            "prototype was reference, not delivery target",
        )
        retarget_state = state(retargeted)
        if retarget_state["state"] != "UNDERSTANDING" or retarget_state["delivery_target"] != "production":
            raise AssertionError("retarget must reset the delivery as a production implementation")
        if retarget_state["reference_artifacts"] != ["/story/board"]:
            raise AssertionError("retarget must preserve the prototype as a reference artifact")

        # Documentation/cosmetic findings do not create autonomous repair loops.
        nonblocking = make_repo(parent, "nonblocking")
        nonblocking_model = parent / "nonblocking-model.json"
        nonblocking_report = parent / "nonblocking-report.json"
        write_json(nonblocking_model, model())
        write_json(nonblocking_report, report("fail", severity="documentation"))
        run(nonblocking, "start", "--task", "Change documented behavior")
        run(nonblocking, "worker-claim", "--role", "implementer")
        (nonblocking / "src/example.ts").write_text("export const value = 'candidate';\n", encoding="utf-8")
        run(nonblocking, "model", "--file", str(nonblocking_model))
        run(nonblocking, "quality")
        run(nonblocking, "verifier-claim")
        run(
            nonblocking,
            "verifier",
            "--verdict",
            "fail",
            "--report",
            str(nonblocking_report),
        )
        if state(nonblocking)["state"] != "READY_FOR_PRODUCT_REVIEW":
            raise AssertionError("non-blocking verifier findings must not create a repair loop")
        if state(nonblocking).get("verifier", {}).get("verdict") != "pass":
            raise AssertionError("non-blocking-only verifier fail must normalize to effective pass")

        # A verifier cannot spend past its externally recorded budget. Build a
        # matching VERIFYING receipt directly so this test stays fast and focuses
        # on the hard-stop itself rather than replaying the whole lifecycle.
        budgeted = make_repo(parent, "bounded-low-risk")
        run(budgeted, "start", "--task", "Exercise bounded verifier budget")
        state_path = budgeted / ".claude/delivery/current.json"
        bounded_state = json.loads(state_path.read_text(encoding="utf-8"))
        baseline = bounded_state["baseline"]
        current_fp = hashlib.sha256(
            json.dumps(baseline, sort_keys=True, separators=(",", ":")).encode("utf-8")
        ).hexdigest()
        bounded_state.update(
            {
                "state": "VERIFYING",
                "change_model": model(),
                "quality": {"passed": True, "fingerprint": current_fp},
                "verification_mode": "targeted",
                "budget": {
                    "full_verifier_runs": 1,
                    "targeted_verifier_runs": 1,
                    "repair_cycles": 1,
                    "human_extra_targeted": 0,
                    "human_extra_repairs": 0,
                    "max_full_verifier_runs": 1,
                    "max_targeted_verifier_runs": 1,
                    "max_repair_cycles": 2,
                },
            }
        )
        state_path.write_text(json.dumps(bounded_state, indent=2) + "\n", encoding="utf-8")
        run(budgeted, "verifier-claim", allowed=False)
        if state(budgeted)["state"] != "NEEDS_HUMAN_REVIEW":
            raise AssertionError("exhausted low-risk verifier budget must hard-stop for human review")


        high = make_repo(parent, "high-risk")
        high_model = parent / "high-model.json"
        write_json(high_model, model(risk="high"))
        run(high, "start", "--task", "Change a public contract")
        (high / "src/example.ts").write_text("export const value = 'candidate';\n", encoding="utf-8")
        run(high, "model", "--file", str(high_model))
        if state(high)["state"] != "BLOCKED_DECISION":
            raise AssertionError("high-risk delivery must require durable authorization")
        run(high, "quality", allowed=False)

        archive = high / ".claude/plans/archive"
        archive.mkdir(parents=True)
        approved = archive / "contract-r001-approved.md"
        approved.write_text(
            "# Approved contract\n\n## Implementation Status\n\n`APPROVED`\n",
            encoding="utf-8",
        )
        run(
            high,
            "authorize-high",
            "--reference",
            ".claude/plans/archive/contract-r001-approved.md",
        )
        if state(high)["state"] != "IMPLEMENTING":
            raise AssertionError("approved high-risk snapshot must authorize implementation")

        blocked = make_repo(parent, "unresolved-high-risk")
        blocked_model = parent / "blocked-high-model.json"
        write_json(
            blocked_model,
            model(
                risk="high",
                unknowns=["Which compatibility contract should be preserved?"],
                decision_required=True,
            ),
        )
        run(blocked, "start", "--task", "Change an unresolved public contract")
        run(blocked, "model", "--file", str(blocked_model))
        blocked_archive = blocked / ".claude/plans/archive"
        blocked_archive.mkdir(parents=True)
        blocked_approved = blocked_archive / "contract-r001-approved.md"
        blocked_approved.write_text(
            "# Approved contract\n\n## Implementation Status\n\n`APPROVED`\n",
            encoding="utf-8",
        )
        run(
            blocked,
            "authorize-high",
            "--reference",
            ".claude/plans/archive/contract-r001-approved.md",
            allowed=False,
        )

        failed = make_repo(parent, "failed")
        run(failed, "start", "--task", "Exercise terminal failure")
        run(failed, "fail", "--reason", "No safe implementation remains")
        if state(failed)["state"] != "FAILED":
            raise AssertionError("explicit terminal failure must transition to FAILED")

    print("Autonomous delivery lifecycle self-test passed")


if __name__ == "__main__":
    main()
