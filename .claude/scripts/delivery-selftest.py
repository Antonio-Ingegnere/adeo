"""End-to-end checks for the bounded human-in-the-loop delivery lifecycle."""
from __future__ import annotations
import hashlib
import json
import subprocess
import sys
import tempfile
from pathlib import Path

DELIVERY = Path(__file__).with_name("delivery.py").resolve()
CLAUDE = Path(__file__).resolve().parents[1]


def run(root: Path, *args: str, allowed: bool = True) -> subprocess.CompletedProcess[str]:
    result = subprocess.run([sys.executable, str(DELIVERY), "--project-root", str(root), *args], capture_output=True, text=True)
    if allowed and result.returncode != 0:
        raise AssertionError(f"should pass: {' '.join(args)}\n{result.stdout}\n{result.stderr}")
    if not allowed and result.returncode == 0:
        raise AssertionError(f"should fail: {' '.join(args)}")
    return result


def git(root: Path, *args: str) -> None:
    subprocess.run(["git", "-C", str(root), *args], check=True, capture_output=True)


def make_repo(parent: Path, name: str) -> Path:
    root = parent / name
    root.mkdir()
    (root / "src").mkdir()
    (root / "src/example.ts").write_text("export const value = 'baseline';\n")
    (root / "docs").mkdir()
    (root / "docs/example.md").write_text("baseline\n")
    (root / "scripts").mkdir()
    (root / "package.json").write_text('{"scripts":{"build":"node -e 0"}}\n')
    (root / ".gitignore").write_text(".claude/delivery/current.json\n")
    git(root, "init", "-q")
    git(root, "add", ".")
    git(root, "-c", "user.name=Workflow Test", "-c", "user.email=workflow@example.invalid", "commit", "-qm", "baseline")
    return root


def write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, indent=2) + "\n")


def model(*, risk: str = "low", unknowns: list[str] | None = None, decision_required: bool = False, feature_checks: list[str] | None = None) -> dict[str, object]:
    return {
        "target": "production",
        "intent": "Change shipped behavior.",
        "current_system": "A baseline production module exists.",
        "domain": "src/example.ts is the production surface.",
        "flow": ["task -> production module"],
        "invariants": ["module remains readable"],
        "implementation_location": ["src/example.ts"],
        "affected": ["production behavior"],
        "do_not_change": ["Git history"],
        "unknowns": unknowns or [],
        "risk": risk,
        "evidence": [],
        "feature_checks": feature_checks or [],
        "decision_required": decision_required,
    }


def report(verdict: str, *, defect_id: str | None = None, severity: str = "functional") -> dict[str, object]:
    defects: list[dict[str, object]] = []
    if verdict == "fail":
        d: dict[str, object] = {
            "severity": severity,
            "expected": "Candidate satisfies intended behavior.",
            "actual": "Candidate is incomplete.",
            "reproduction": ["Read src/example.ts"],
            "evidence": ["src/example.ts"],
            "suspected_area": "src/example.ts",
            "invariant_violated": "Delivered behavior must be complete.",
        }
        if defect_id:
            d["defect_id"] = defect_id
        defects.append(d)
    return {
        "verdict": verdict,
        "domain_correctness": {"assessment": "Production ownership is correct.", "evidence": ["src/example.ts"]},
        "implementation_correctness": {"assessment": "Candidate is readable.", "evidence": ["git diff --check"]},
        "adversarial_scenarios": [{"scenario": "Inspect changed behavior.", "result": "Inspected.", "evidence": "src/example.ts"}],
        "defects": defects,
        "observations": [],
        "residual_risks": [],
    }


def state(root: Path) -> dict[str, object]:
    return json.loads(run(root, "status", "--json").stdout)


def assert_integrity() -> None:
    # Product designer is intentionally outside v2 tuning; verify routing files only.
    active = [
        CLAUDE / "HELP.md", CLAUDE / "delivery/README.md", CLAUDE / "agents/implementer.md",
        CLAUDE / "agents/verifier.md", CLAUDE / "agents/verifier-lite.md", CLAUDE / "agents/verifier-targeted.md",
        CLAUDE / "agents/qa-repairer.md", CLAUDE / "agents/qa-repairer-sonnet.md",
        CLAUDE / "scripts/delivery.py", CLAUDE / "scripts/verifier-guard.py", CLAUDE / "scripts/implementer-guard.py",
        CLAUDE / "skills/deliver/SKILL.md", CLAUDE / "skills/start/SKILL.md", CLAUDE / "skills/qa-fix/SKILL.md",
    ]
    for path in active:
        if not path.is_file():
            raise AssertionError(
                f"required v2 runtime file is missing: {path}. "
                "The .claude directory is mixed/incomplete; reinstall the full replacement archive."
            )
        text = path.read_text()
        for forbidden in ("worker-claim --role architect", ".claude/agents/architect.md"):
            if forbidden in text:
                raise AssertionError(f"stale runtime token {forbidden!r} in {path}")
        if path.name != "delivery.py" and "READY_FOR_PRODUCT_REVIEW" in text:
            raise AssertionError(f"stale readiness name remains in {path}")
    # Model routing is explicit and bounded.
    if "model: haiku" not in (CLAUDE / "skills/deliver/SKILL.md").read_text():
        raise AssertionError("/deliver must be Haiku-routed")
    if "model: sonnet" not in (CLAUDE / "agents/implementer.md").read_text():
        raise AssertionError("implementer must remain Sonnet")
    if "model: sonnet" not in (CLAUDE / "agents/verifier.md").read_text():
        raise AssertionError("high-risk verifier must remain Sonnet")
    for name in ("verifier-lite.md", "verifier-targeted.md", "qa-repairer.md"):
        if "model: haiku" not in (CLAUDE / "agents" / name).read_text():
            raise AssertionError(f"{name} must use Haiku")
    reopened = (CLAUDE / "agents/qa-repairer-sonnet.md").read_text()
    if "model: sonnet" not in reopened or "effort: medium" not in reopened:
        raise AssertionError("reopened manual-QA repair must use Sonnet medium")
    guard = (CLAUDE / "scripts/implementer-guard.py").read_text()
    if "qa_repair_route" not in guard or "qa-repairer-sonnet" not in guard:
        raise AssertionError("implementer guard must enforce manual-QA repair model routing")


def main() -> None:
    assert_integrity()
    with tempfile.TemporaryDirectory(prefix="adeo-delivery-v2-") as d:
        parent = Path(d)
        root = make_repo(parent, "normal")
        model_file = parent / "model.json"
        fail_file = parent / "fail.json"
        pass_file = parent / "pass.json"
        # Explicit + auto-discovered feature check proves deterministic feature evidence.
        feature = root / "scripts/feature-selftest.mjs"
        feature.write_text("console.log('feature selftest pass')\n")
        write_json(model_file, model(feature_checks=["node scripts/feature-selftest.mjs"]))
        write_json(fail_file, report("fail"))
        write_json(pass_file, report("pass"))

        run(root, "start", "--task", "Implement production feature")
        run(root, "worker-claim", "--role", "product-designer", allowed=False)
        run(root, "worker-claim", "--role", "implementer")
        run(root, "model", "--file", str(model_file))
        (root / "src/example.ts").write_text("export const value = 'candidate';\n")
        run(root, "quality")
        full = state(root)
        if full["verification_route"] != "verifier-lite":
            raise AssertionError("low-risk full verification must route to Haiku verifier-lite")
        quality_full = json.loads(run(root, "status", "--json", "--full").stdout)["quality"]
        commands = [x["command"] for x in quality_full["checks"]]
        if "node scripts/feature-selftest.mjs" not in commands:
            raise AssertionError("feature-specific selftest must run in deterministic quality")

        claim = json.loads(run(root, "verifier-claim", "--json").stdout)
        if claim.get("mode") != "full" or claim.get("route") != "verifier-lite":
            raise AssertionError("low-risk full claim route is wrong")
        run(root, "verifier", "--verdict", "fail", "--report", str(fail_file))
        if state(root)["state"] != "REPAIRING":
            raise AssertionError("blocking full verification must repair")
        defect_id = state(root)["defects"]["open"][0]["id"]
        run(root, "worker-claim", "--role", "implementer")
        (root / "src/example.ts").write_text("export const value = 'repaired';\n")
        run(root, "quality")
        if state(root)["verification_route"] != "verifier-targeted":
            raise AssertionError("repair must route targeted verification to Haiku")
        targeted_pass = parent / "targeted-pass.json"
        write_json(targeted_pass, report("pass"))
        claim = json.loads(run(root, "verifier-claim", "--json").stdout)
        if claim.get("route") != "verifier-targeted":
            raise AssertionError("targeted claim route is wrong")
        run(root, "verifier", "--verdict", "pass", "--report", str(targeted_pass))
        if state(root)["state"] != "READY_FOR_MANUAL_QA":
            raise AssertionError("engineering verification must stop at manual QA")
        if "READY FOR MANUAL QA" not in run(root, "report").stdout:
            raise AssertionError("report must present manual-QA package")

        # Deterministic checkpoint does not need an LLM-authored JSON file.
        run(root, "checkpoint", "--reason", "usage limit")
        full_state = json.loads(run(root, "status", "--json", "--full").stdout)
        if full_state.get("handoff", {}).get("generated_by") != "delivery.py checkpoint":
            raise AssertionError("checkpoint must be machine-generated")

        # Human QA defects -> bounded repair -> targeted verifier -> manual QA again -> DONE.
        qa = parent / "qa.yaml"
        qa.write_text(
            """bugs:
  - id: 1
    status: Open
    description: >
      tasklist, priority, due date become visible
    steps:
      - Open the app
      - Navigate to board, open any board
      - Click view-picker
      - tasklist, priority, due date become visible for adding new task

  - id: 2
    status: Open
    description: >
      List of tasklist\\smart lists is visible partially, seems it's cut
    steps:
      - Open the app
      - Create a new board
      - On newly created board, click +Add column
      - It seems that the working area is very limited by the height, so the list to choose is visible partially.

  - id: 99
    status: Closed
    description: >
      Closed findings must not be imported
    steps:
      - Ignore this item
""",
            encoding="utf-8",
        )
        run(root, "qa-fix", "--file", str(qa))
        if state(root)["state"] != "REPAIRING":
            raise AssertionError("manual QA defects from YAML must enter repair")
        imported = [x for x in state(root)["defects"]["open"] if x["source"] == "manual-qa" and x["status"] == "open"]
        if {x.get("manual_bug_id") for x in imported} != {"1", "2"}:
            raise AssertionError("YAML qa-fix must import only Open bugs and preserve ids")
        run(root, "worker-claim", "--role", "implementer")
        (root / "src/example.ts").write_text("export const value = 'qa repaired';\n")
        run(root, "quality")
        manual_id = next(x["id"] for x in state(root)["defects"]["open"] if x["source"] == "manual-qa") if state(root)["defects"]["open"] else None
        # quality marks open defects candidate-repaired, so fetch from full state.
        full_state = json.loads(run(root, "status", "--json", "--full").stdout)
        manual_id = next(x["id"] for x in full_state["defects"] if x["source"] == "manual-qa")
        qa_pass = parent / "qa-pass.json"
        write_json(qa_pass, report("pass"))
        claim = json.loads(run(root, "verifier-claim", "--json").stdout)
        if claim.get("route") != "verifier-targeted":
            raise AssertionError("manual QA repair must never reopen full verification")
        run(root, "verifier", "--verdict", "pass", "--report", str(qa_pass))
        if state(root)["state"] != "READY_FOR_MANUAL_QA":
            raise AssertionError("manual QA repair returns to manual QA")
        run(root, "qa-accept", "--reason", "Manual smoke and visual QA passed")
        # DONE is terminal, status still readable.
        if state(root)["state"] != "DONE":
            raise AssertionError("explicit manual acceptance must mark DONE")

        # /qa-fix can bootstrap a narrow QA-only repair when runtime state is missing.
        bootstrap = make_repo(parent, "qa-bootstrap")
        bootstrap_qa = parent / "bootstrap-qa.yml"
        bootstrap_qa.write_text(
            """bugs:
  - id: 7
    status: Open
    description: >
      Overlay is clipped in the already implemented UI.
    steps:
      - Open the app
      - Open the affected overlay
""",
            encoding="utf-8",
        )
        run(bootstrap, "qa-fix", "--file", str(bootstrap_qa))
        boot_state = state(bootstrap)
        if boot_state["state"] != "REPAIRING" or boot_state["verification_mode"] != "targeted":
            raise AssertionError("qa-fix without active state must bootstrap directly into targeted REPAIRING")
        if not boot_state["change_model"].get("qa_bootstrap"):
            raise AssertionError("QA bootstrap must use the narrow synthetic repair Change Model")
        if boot_state["defects"]["open"][0].get("manual_bug_id") != "7":
            raise AssertionError("QA bootstrap must preserve manual bug ids")
        run(bootstrap, "worker-claim", "--role", "implementer")
        (bootstrap / "src/example.ts").write_text("export const value = 'qa bootstrap fixed';\n")
        run(bootstrap, "quality")
        boot_verified = state(bootstrap)
        if boot_verified["state"] != "VERIFYING" or boot_verified["verification_route"] != "verifier-targeted":
            raise AssertionError("QA bootstrap must never open a full verifier")

        # Stable manual bug ids drive model escalation: new -> Haiku, first reopen -> Sonnet medium,
        # second reopen -> human stop. This remains a narrow targeted-only QA lifecycle.
        reopen = make_repo(parent, "qa-reopen")
        reopen_qa = parent / "reopen-qa.yml"
        reopen_qa.write_text(
            """bugs:
  - id: 42
    status: Open
    description: >
      Overlay remains clipped after the previous QA repair.
    steps:
      - Open the app
      - Open the affected overlay
""",
            encoding="utf-8",
        )
        run(reopen, "qa-fix", "--file", str(reopen_qa))
        rs = state(reopen)
        if rs.get("qa_repair_route") != "qa-repairer":
            raise AssertionError("new manual-QA bug must route to Haiku qa-repairer")
        run(reopen, "worker-claim", "--role", "implementer")
        (reopen / "src/example.ts").write_text("export const value = 'first qa fix';\n")
        run(reopen, "quality")
        write_json(qa_pass, report("pass"))
        run(reopen, "verifier-claim", "--json")
        run(reopen, "verifier", "--verdict", "pass", "--report", str(qa_pass))
        if state(reopen)["state"] != "READY_FOR_MANUAL_QA":
            raise AssertionError("first QA repair must return to manual QA")

        run(reopen, "qa-fix", "--file", str(reopen_qa))
        rs = state(reopen)
        if rs.get("qa_repair_route") != "qa-repairer-sonnet":
            raise AssertionError("first reopen must route directly to Sonnet/medium repairer")
        reopened_defect = rs["defects"]["open"][0]
        if reopened_defect.get("manual_bug_id") != "42" or reopened_defect.get("reopen_count") != 1:
            raise AssertionError("first reopen must preserve bug id and record reopen_count=1")
        run(reopen, "worker-claim", "--role", "implementer")
        (reopen / "src/example.ts").write_text("export const value = 'sonnet reopen fix';\n")
        run(reopen, "quality")
        run(reopen, "verifier-claim", "--json")
        run(reopen, "verifier", "--verdict", "pass", "--report", str(qa_pass))
        if state(reopen)["state"] != "READY_FOR_MANUAL_QA":
            raise AssertionError("reopen repair must return to manual QA")
        run(reopen, "qa-fix", "--file", str(reopen_qa), allowed=False)
        if state(reopen)["state"] != "NEEDS_HUMAN_REVIEW":
            raise AssertionError("second reopen of the same bug must stop autonomous repair")

        # High risk always routes full review to Sonnet verifier.
        high = make_repo(parent, "high")
        high_model = parent / "high-model.json"
        write_json(high_model, model(risk="high"))
        run(high, "start", "--task", "High-risk contract change")
        run(high, "worker-claim", "--role", "implementer")
        run(high, "model", "--file", str(high_model))
        if state(high)["state"] != "BLOCKED_DECISION":
            raise AssertionError("high risk must block for human authorization")
        run(high, "authorize-high", "--reason", "Explicitly approved")
        run(high, "worker-claim", "--role", "implementer")
        (high / "src/example.ts").write_text("export const value = 'high';\n")
        run(high, "quality")
        if state(high)["verification_route"] != "verifier":
            raise AssertionError("high-risk full verification must route to Sonnet verifier")

        # Prototype-only candidate can never satisfy production delivery.
        wrong = make_repo(parent, "wrong")
        wrong_model = parent / "wrong-model.json"
        wm = model(); wm["target"] = "prototype"; wm["implementation_location"] = ["ui-ux/ux/concepts/x.stories.ts"]
        write_json(wrong_model, wm)
        run(wrong, "start", "--task", "Implement from prototype", "--reference", "/story/x")
        run(wrong, "worker-claim", "--role", "product-designer", allowed=False)
        run(wrong, "worker-claim", "--role", "implementer")
        run(wrong, "model", "--file", str(wrong_model), allowed=False)

        # Externally bounded verifier budget still hard-stops.
        bounded = make_repo(parent, "bounded")
        run(bounded, "start", "--task", "Budget stop")
        sp = bounded / ".claude/delivery/current.json"
        bs = json.loads(sp.read_text())
        baseline = bs["baseline"]
        fp = hashlib.sha256(json.dumps(baseline, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        bs.update({"state": "VERIFYING", "change_model": model(), "quality": {"passed": True, "fingerprint": fp}, "verification_mode": "targeted",
                   "budget": {"full_verifier_runs": 1, "targeted_verifier_runs": 1, "repair_cycles": 1, "human_extra_targeted": 0, "human_extra_repairs": 0,
                              "manual_qa_batches": 0, "max_full_verifier_runs": 1, "max_targeted_verifier_runs": 1, "max_repair_cycles": 2}})
        sp.write_text(json.dumps(bs, indent=2)+"\n")
        run(bounded, "verifier-claim", allowed=False)
        if state(bounded)["state"] != "NEEDS_HUMAN_REVIEW":
            raise AssertionError("budget exhaustion must hard-stop")

    print("Autonomous delivery lifecycle self-test passed")


if __name__ == "__main__":
    main()
