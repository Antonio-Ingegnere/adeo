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
MODEL_CONTRACT_FIELDS = {
    "target", "intent", "current_system", "domain", "flow", "invariants",
    "implementation_location", "affected", "do_not_change", "unknowns",
    "risk", "evidence", "feature_checks", "decision_required",
}


def run(root: Path, *args: str, allowed: bool = True, input_text: str | None = None) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(
        [sys.executable, str(DELIVERY), "--project-root", str(root), *args],
        capture_output=True,
        text=True,
        input=input_text,
    )
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


def legacy_snapshot(root: Path) -> dict[str, str]:
    raw = subprocess.run(
        ["git", "-C", str(root), "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
        check=True,
        capture_output=True,
    ).stdout
    result: dict[str, str] = {}
    for item in raw.split(b"\0"):
        if not item:
            continue
        rel = item.decode()
        path = root / rel
        if path.is_file():
            result[rel] = hashlib.sha256(path.read_bytes()).hexdigest()
    return result


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
    # Product designer is intentionally outside v3 cleanup; verify routing files only.
    active = [
        CLAUDE / "HELP.md", CLAUDE / "delivery/README.md", CLAUDE / "agents/implementer.md",
        CLAUDE / "agents/verifier.md", CLAUDE / "agents/verifier-lite.md", CLAUDE / "agents/verifier-targeted.md",
        CLAUDE / "agents/qa-repairer.md", CLAUDE / "agents/qa-repairer-sonnet.md",
        CLAUDE / "scripts/delivery.py", CLAUDE / "scripts/verifier-guard.py", CLAUDE / "scripts/implementer-guard.py",
        CLAUDE / "skills/deliver/SKILL.md", CLAUDE / "skills/start/SKILL.md", CLAUDE / "skills/qa-fix/SKILL.md",
        CLAUDE / "skills/qa-escalate/SKILL.md", CLAUDE / "skills/metrics/SKILL.md",
        CLAUDE / "metrics/.gitignore",
    ]
    for path in active:
        if not path.is_file():
            raise AssertionError(
                f"required v3 runtime file is missing: {path}. "
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
    runtime = (CLAUDE / "scripts/delivery.py").read_text()
    for token in (
        "sparse_baseline", "candidate_changed_paths", "delivery-metrics.jsonl",
        "expensive_reasoning_passes", "haiku_qa_attempts", "qa_escalations_to_sonnet",
        "sonnet_qa_escalation_passes", "command_qa_escalate", "command_qa_attempt",
        "command_qa_history", "normalized_manual_bug_identity", "ensure_manual_bug_ids",
        "command_model_template", "read_json_stdin", "command_begin", "new_delivery_state",
        "command_metrics", "metric_dashboard_payload", "METRICS_DASHBOARD_RELATIVE",
    ):
        if token not in runtime:
            raise AssertionError(f"v3 runtime missing {token}")
    deliver_skill = (CLAUDE / "skills/deliver/SKILL.md").read_text()
    implementer = (CLAUDE / "agents/implementer.md").read_text()
    if 'begin --task' not in deliver_skill or '--target production --json' not in deliver_skill:
        raise AssertionError("/deliver must use the atomic begin protocol")
    for stale in ("delivery.py claim --agent", "worker-claim --agent"):
        if stale in deliver_skill:
            raise AssertionError(f"/deliver contains stale claim protocol: {stale}")
    if 'model --stdin' not in implementer or 'current.md' not in implementer:
        raise AssertionError("implementer must document the JSON stdin Change Model protocol")


def main() -> None:
    assert_integrity()
    with tempfile.TemporaryDirectory(prefix="adeo-delivery-v3-") as d:
        parent = Path(d)

        # v1 full-repository state compacts to HEAD + pre-existing dirty only.
        migrated = make_repo(parent, "legacy-migration")
        evidence = migrated / "ui-ux/ux/reviews/evidence"
        evidence.mkdir(parents=True)
        for idx in range(12):
            (evidence / f"shot-{idx}.png").write_bytes(bytes([idx]) * 32)
        git(migrated, "add", ".")
        git(migrated, "-c", "user.name=Workflow Test", "-c", "user.email=workflow@example.invalid", "commit", "-qm", "evidence")
        (migrated / "src/example.ts").write_text("export const value = 'pre-existing dirty';\n")
        legacy = legacy_snapshot(migrated)
        current_path = migrated / ".claude/delivery/current.json"
        current_path.parent.mkdir(parents=True, exist_ok=True)
        current_path.write_text(json.dumps({
            "version": 1,
            "id": "legacy",
            "state": "UNDERSTANDING",
            "task": "legacy",
            "delivery_target": "production",
            "reference_artifacts": [],
            "created_at": "2026-09-01T00:00:00+00:00",
            "updated_at": "2026-09-01T00:00:00+00:00",
            "baseline": legacy,
            "change_model": None,
            "authorization": None,
            "quality": None,
            "verifier": None,
            "verifier_claim": None,
            "worker_claim": None,
            "verification_mode": "full",
            "defects": [],
            "observations": [],
            "budget": {},
        }, indent=2) + "\n")
        old_size = current_path.stat().st_size
        run(migrated, "migrate-state")
        migrated_state = json.loads(current_path.read_text())
        if migrated_state["version"] != 2:
            raise AssertionError("legacy state must migrate to v2")
        if set(migrated_state["baseline"]["dirty"]) != {"src/example.ts"}:
            raise AssertionError("legacy migration must retain only pre-existing dirty product paths")
        if current_path.stat().st_size >= old_size:
            raise AssertionError("sparse baseline migration must shrink state")

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
        started_full = json.loads(run(root, "status", "--json", "--full").stdout)
        baseline = started_full["baseline"]
        if set(baseline) < {"head", "dirty"}:
            raise AssertionError("v3 baseline must be HEAD + sparse dirty map")
        if "src/example.ts" in baseline["dirty"]:
            raise AssertionError("clean tracked files must not be copied into sparse baseline")
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
        run(root, "qa-attempt")
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
        # DONE is terminal, status still readable and one append-only metric is recorded.
        if state(root)["state"] != "DONE":
            raise AssertionError("explicit manual acceptance must mark DONE")
        metrics_file = root / "docs/agent/delivery-metrics.jsonl"
        metric_lines = metrics_file.read_text(encoding="utf-8").splitlines()
        if len(metric_lines) != 1:
            raise AssertionError("qa-accept must append exactly one delivery metric record")
        metric = json.loads(metric_lines[0])
        if not metric.get("manual_acceptance") or metric.get("delivery_id") != state(root)["id"]:
            raise AssertionError("delivery metric must identify the accepted delivery")
        if "expensive_reasoning_passes" not in metric:
            raise AssertionError("delivery metric must expose expensive reasoning passes")
        if metric.get("haiku_qa_attempts") != 1:
            raise AssertionError("accepted metrics must count explicit Haiku QA attempts")
        if "qa_escalations_to_sonnet" not in metric or "sonnet_qa_escalation_passes" not in metric:
            raise AssertionError("accepted metrics must expose QA escalation counters")

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
        run(bootstrap, "qa-attempt")
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
        run(reopen, "qa-attempt")
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

        # Non-converging Haiku QA is bounded: two attempts, then human-only Sonnet escalation.
        escalate = make_repo(parent, "qa-escalate")
        escalate_qa = parent / "escalate-qa.yml"
        escalate_qa.write_text(
            """bugs:
  - id: 73
    status: Open
    description: >
      Smart-list board state remains wrong after a narrow repair attempt.
    steps:
      - Open the board
      - Activate the smart list
""",
            encoding="utf-8",
        )
        run(escalate, "qa-fix", "--file", str(escalate_qa))
        run(escalate, "qa-attempt")
        run(escalate, "qa-attempt")
        run(escalate, "qa-attempt", allowed=False)
        es = state(escalate)
        if es["state"] != "NEEDS_HUMAN_REVIEW" or es.get("qa_attempts_current_batch") != 2:
            raise AssertionError("third Haiku QA attempt must hard-stop after two recorded attempts")
        if es["metrics"].get("haiku_qa_attempts") != 2:
            raise AssertionError("Haiku QA attempts must be machine-counted even without a successful fix")
        run(escalate, "qa-escalate", "--reason", "Haiku failed to converge on the state transition")
        es = state(escalate)
        if es["state"] != "REPAIRING" or es.get("qa_repair_route") != "qa-repairer-sonnet":
            raise AssertionError("human qa-escalate must switch the narrow repair route to Sonnet")
        if es.get("worker_claim") is not None:
            raise AssertionError("qa-escalate must clear the stale Haiku worker lease")
        if es["metrics"].get("qa_escalations_to_sonnet") != 1:
            raise AssertionError("human Sonnet escalation must be counted exactly once")
        run(escalate, "qa-escalate", "--reason", "duplicate command should be idempotent")
        if state(escalate)["metrics"].get("qa_escalations_to_sonnet") != 1:
            raise AssertionError("repeated qa-escalate must not double-count the same escalation")
        run(escalate, "worker-claim", "--role", "implementer")
        (escalate / "src/example.ts").write_text("export const value = 'sonnet escalation fix';\n")
        run(escalate, "quality")
        if state(escalate)["metrics"].get("sonnet_qa_escalation_passes") != 1:
            raise AssertionError("Sonnet escalation repair pass must not be mislabeled as a reopen pass")
        if state(escalate)["metrics"].get("sonnet_reopen_passes") != 0:
            raise AssertionError("non-reopen Sonnet escalation must not increment sonnet_reopen_passes")

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
        fp = state(bounded)["current_fingerprint"]
        bs.update({"state": "VERIFYING", "change_model": model(), "quality": {"passed": True, "fingerprint": fp}, "verification_mode": "targeted",
                   "budget": {"full_verifier_runs": 1, "targeted_verifier_runs": 1, "repair_cycles": 1, "human_extra_targeted": 0, "human_extra_repairs": 0,
                              "manual_qa_batches": 0, "max_full_verifier_runs": 1, "max_targeted_verifier_runs": 1, "max_repair_cycles": 2}})
        sp.write_text(json.dumps(bs, indent=2)+"\n")
        run(bounded, "verifier-claim", allowed=False)
        if state(bounded)["state"] != "NEEDS_HUMAN_REVIEW":
            raise AssertionError("budget exhaustion must hard-stop")

    print("Autonomous delivery lifecycle self-test passed")


def quick_main() -> None:
    """Fast integrity/migration smoke used by the installer."""
    assert_integrity()
    with tempfile.TemporaryDirectory(prefix="adeo-delivery-v3-quick-") as d:
        parent = Path(d)
        root = make_repo(parent, "quick")
        evidence = root / "ui-ux/ux/reviews/evidence"
        evidence.mkdir(parents=True)
        for idx in range(8):
            (evidence / f"shot-{idx}.png").write_bytes(bytes([idx]) * 32)
        git(root, "add", ".")
        git(root, "-c", "user.name=Workflow Test", "-c", "user.email=workflow@example.invalid", "commit", "-qm", "evidence")
        (root / "src/example.ts").write_text("export const value = 'pre-existing dirty';\n")
        legacy = legacy_snapshot(root)
        current = root / ".claude/delivery/current.json"
        current.parent.mkdir(parents=True, exist_ok=True)
        current.write_text(json.dumps({
            "version": 1,
            "id": "quick-legacy",
            "state": "UNDERSTANDING",
            "task": "quick migration",
            "delivery_target": "production",
            "reference_artifacts": [],
            "created_at": "2026-09-01T00:00:00+00:00",
            "updated_at": "2026-09-01T00:00:00+00:00",
            "baseline": legacy,
            "change_model": None,
            "authorization": None,
            "quality": None,
            "verifier": None,
            "verifier_claim": None,
            "worker_claim": None,
            "verification_mode": "full",
            "defects": [],
            "observations": [],
            "budget": {},
        }, indent=2) + "\n")
        old_size = current.stat().st_size
        run(root, "migrate-state")
        migrated = json.loads(current.read_text())
        if migrated.get("version") != 2:
            raise AssertionError("quick migration did not produce v2 state")
        dirty = (migrated.get("baseline") or {}).get("dirty") or {}
        if set(dirty) != {"src/example.ts"}:
            raise AssertionError(f"quick migration kept unexpected baseline paths: {sorted(dirty)}")
        if current.stat().st_size >= old_size:
            raise AssertionError("quick migration did not compact current.json")

        # Protocol smoke: one begin call creates UNDERSTANDING plus the initial
        # worker claim, then the runtime accepts the Change Model on stdin.
        proto = make_repo(parent, "protocol")
        begun = json.loads(run(
            proto, "begin", "--task", "Remove redundant board controls",
            "--target", "production", "--json"
        ).stdout)
        if begun.get("state") != "UNDERSTANDING":
            raise AssertionError("begin did not create UNDERSTANDING state")
        if ((begun.get("worker_claim") or {}).get("role")) != "implementer":
            raise AssertionError("begin did not atomically claim the implementer")
        persisted = state(proto)
        if ((persisted.get("worker_claim") or {}).get("role")) != "implementer":
            raise AssertionError("begin worker claim was not persisted")
        template = json.loads(run(proto, "model-template").stdout)
        if set(MODEL_CONTRACT_FIELDS) - set(template):
            raise AssertionError("model-template is missing Change Model contract fields")
        run(proto, "model", "--stdin", input_text=json.dumps(model()))
        if state(proto)["state"] != "IMPLEMENTING":
            raise AssertionError("model --stdin did not transition UNDERSTANDING -> IMPLEMENTING")

        # Metrics smoke: aggregation is deterministic, works without active state,
        # excludes partial records from averages when complete records exist, and
        # generates a disposable HTML dashboard.
        metrics_repo = make_repo(parent, "metrics")
        ledger = metrics_repo / "docs/agent/delivery-metrics.jsonl"
        ledger.parent.mkdir(parents=True, exist_ok=True)
        records = [
            {
                "delivery_id": "m1", "task": "Simple accepted feature", "risk": "low",
                "outcome": "accepted", "manual_acceptance": True,
                "expensive_reasoning_passes": 1, "haiku_qa_attempts": 0,
                "qa_escalations_to_sonnet": 0, "qa_batches": 1, "reopens": 0,
                "metrics_partial": False,
            },
            {
                "delivery_id": "m2", "task": "Escalated feature", "risk": "medium",
                "outcome": "accepted", "manual_acceptance": True,
                "expensive_reasoning_passes": 3, "haiku_qa_attempts": 2,
                "qa_escalations_to_sonnet": 1, "qa_batches": 2, "reopens": 0,
                "metrics_partial": False,
            },
            {
                "delivery_id": "legacy", "task": "Partial legacy feature", "risk": "unknown",
                "outcome": "accepted", "manual_acceptance": True,
                "expensive_reasoning_passes": 99, "haiku_qa_attempts": 0,
                "qa_escalations_to_sonnet": 0, "qa_batches": 9, "reopens": 0,
                "metrics_partial": True,
            },
        ]
        ledger.write_text("\n".join(json.dumps(item) for item in records) + "\n")
        dashboard = json.loads(run(metrics_repo, "metrics", "--json").stdout)
        if dashboard.get("accepted_total") != 3 or dashboard.get("complete_total") != 2:
            raise AssertionError("metrics dashboard counts accepted/complete records incorrectly")
        if dashboard.get("avg_expensive_reasoning_passes") != 2.0:
            raise AssertionError("metrics averages must exclude partial records when complete records exist")
        if dashboard.get("qa_escalation_rate_pct") != 50.0:
            raise AssertionError("metrics QA escalation rate is incorrect")
        run(metrics_repo, "metrics", "--html")
        html_path = metrics_repo / ".claude/metrics/dashboard.html"
        if not html_path.is_file():
            raise AssertionError("metrics --html did not generate dashboard.html")
        html_text = html_path.read_text(encoding="utf-8")
        for token in ("Adeo delivery metrics", "Escalated feature", "Expensive reasoning passes / feature"):
            if token not in html_text:
                raise AssertionError(f"metrics HTML missing {token!r}")


        # Standalone QA smoke: explicit human batches are not globally capped.
        qa = make_repo(parent, "standalone-qa")
        qa_pass = parent / "qa-v36-pass.json"
        write_json(qa_pass, report("pass"))
        for batch in range(1, 5):
            qa_file = parent / f"qa-v36-{batch}.yml"
            qa_file.write_text(
                f"""bugs:
  - id: {batch}
    status: Open
    description: >
      Human QA issue batch {batch}.
    steps:
      - Reproduce batch {batch}
""",
                encoding="utf-8",
            )
            run(qa, "qa-fix", "--file", str(qa_file))
            if state(qa).get("qa_repair_route") != "qa-repairer":
                raise AssertionError("fresh standalone QA batch must route to Haiku")
            run(qa, "qa-attempt")
            run(qa, "worker-claim", "--role", "implementer")
            (qa / "src/example.ts").write_text(f"export const value = 'qa batch {batch}';\n")
            run(qa, "quality")
            run(qa, "verifier-claim", "--json")
            run(qa, "verifier", "--verdict", "pass", "--report", str(qa_pass))
            if state(qa)["state"] != "READY_FOR_MANUAL_QA":
                raise AssertionError(f"standalone QA batch {batch} did not return to manual QA")
        if state(qa)["budget"].get("manual_qa_batches") != 4:
            raise AssertionError("human QA batch count must remain a metric/counter beyond three")

        # Legacy/inline bugs without explicit ids receive deterministic identity and reopen cleanly.
        auto = make_repo(parent, "auto-id")
        auto_file = parent / "auto-id.json"
        write_json(auto_file, {"defects": [{
            "expected": "Popover is visible.",
            "actual": "Popover is clipped by its scroll container.",
            "reproduction": ["Open board", "Open move menu"],
            "category": "ui",
        }]})
        run(auto, "qa-fix", "--file", str(auto_file))
        auto_state = state(auto)
        generated_id = auto_state["defects"]["open"][0].get("manual_bug_id")
        if not str(generated_id).startswith("AUTO-"):
            raise AssertionError("manual QA defect without explicit id must receive deterministic AUTO identity")
        run(auto, "qa-attempt")
        run(auto, "worker-claim", "--role", "implementer")
        (auto / "src/example.ts").write_text("export const value = 'auto first fix';\n")
        run(auto, "quality")
        run(auto, "verifier-claim", "--json")
        run(auto, "verifier", "--verdict", "pass", "--report", str(qa_pass))
        run(auto, "qa-fix", "--file", str(auto_file))
        if state(auto).get("qa_repair_route") != "qa-repairer-sonnet":
            raise AssertionError("same id-less manual QA report must be recognized as a reopen")

        # Explicit human escalation may reactivate a prior QA defect directly from manual QA.
        direct = make_repo(parent, "direct-escalation")
        direct_file = parent / "direct.yml"
        direct_file.write_text(
            """bugs:
  - id: clip-menu
    status: Open
    description: >
      Move menu is clipped by the board column scroll container.
    steps:
      - Open a board
      - Open the move menu near the bottom
""", encoding="utf-8")
        run(direct, "qa-fix", "--file", str(direct_file))
        run(direct, "qa-attempt")
        run(direct, "worker-claim", "--role", "implementer")
        (direct / "src/example.ts").write_text("export const value = 'partial flip-up';\n")
        run(direct, "quality")
        run(direct, "verifier-claim", "--json")
        run(direct, "verifier", "--verdict", "pass", "--report", str(qa_pass))
        history = json.loads(run(direct, "qa-history", "--json").stdout)
        if not history.get("defects") or history["defects"][-1].get("defect_id") != "D-001":
            raise AssertionError("qa-history must expose compact stable internal defect ids")
        run(direct, "qa-escalate", "--defect-id", "D-001", "--reason", "Flip-up is a half-measure; portal repair required")
        ds = state(direct)
        if ds["state"] != "REPAIRING" or ds.get("qa_repair_route") != "qa-repairer-sonnet":
            raise AssertionError("direct manual-QA escalation must reactivate selected defect on Sonnet route")
        if ds["defects"]["open"][0].get("id") != "D-001":
            raise AssertionError("direct escalation must reactivate the selected legacy/internal defect")
        if ds["metrics"].get("qa_escalations_to_sonnet") != 1:
            raise AssertionError("direct manual-QA escalation must be counted")
    print("Delivery v3 quick self-test passed")


if __name__ == "__main__":
    if "--quick" in sys.argv[1:]:
        quick_main()
    else:
        main()
