#!/usr/bin/env python3
"""Machine-owned lifecycle and deterministic quality gate for /deliver."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shlex
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


VERSION = 1
DELIVERY_TARGETS = {"production", "prototype"}
REFERENCE_PREFIXES = ("ui-ux/ux/", ".storybook/")
PRODUCTION_PREFIXES = ("src/", "server/", "migrations/", "public/")
PRODUCTION_FILES = {"index.html", "styles.css", "package.json", "tsconfig.json", "tsconfig.renderer.json"}
STATE_RELATIVE = Path(".claude/delivery/current.json")
ACTIVE_STATES = {
    "UNDERSTANDING",
    "BLOCKED_DECISION",
    "IMPLEMENTING",
    "VERIFYING",
    "REPAIRING",
    "NEEDS_HUMAN_REVIEW",
    "READY_FOR_MANUAL_QA",
}
IMPLEMENTATION_STATES = {"IMPLEMENTING", "REPAIRING"}
BLOCKING_VERIFIER_SEVERITIES = {
    "functional",
    "accessibility",
    "security",
    "data-loss",
    "contract",
    "regression",
}
NON_BLOCKING_VERIFIER_SEVERITIES = {
    "documentation",
    "cosmetic",
    "fidelity",
    "maintainability",
}
VERIFIER_BUDGETS = {
    "low": {"full": 1, "targeted": 1, "repair_cycles": 2},
    "medium": {"full": 1, "targeted": 2, "repair_cycles": 3},
    "high": {"full": 1, "targeted": 2, "repair_cycles": 3},
}
MAX_VERIFIER_DEFECTS = 3
MAX_ADVERSARIAL_SCENARIOS = 3
MAX_MANUAL_QA_DEFECTS = 3
MAX_MANUAL_QA_BATCHES = 3
MAX_MANUAL_QA_REOPENS = 1
QA_REPAIR_ROUTES = {"qa-repairer", "qa-repairer-sonnet"}
FEATURE_CHECK_PATTERNS = (
    re.compile(r"^node scripts/[A-Za-z0-9_./-]+-selftest\.mjs$"),
    re.compile(r"^python3 scripts/[A-Za-z0-9_./-]+-selftest\.py$"),
    re.compile(r"^npm run test:[A-Za-z0-9:_-]+$"),
)
KNOWN_EVIDENCE = {
    "build",
    "workflow",
    "query",
    "shortcuts",
    "isolation",
    "quick-add",
    "storybook",
    "ux-boundary",
}
CHECKS: dict[str, list[str]] = {
    "workflow": ["npm", "run", "test:workflow"],
    "build": ["npm", "run", "build"],
    "query": ["node", "scripts/query-selftest.mjs"],
    "shortcuts": ["node", "scripts/shortcuts-selftest.mjs"],
    "isolation": ["npm", "run", "test:isolation"],
    "quick-add": ["npm", "run", "test:quick-add"],
    "storybook": ["npm", "run", "storybook:build"],
    "ux-boundary": ["npm", "run", "check:ux-boundary"],
}
CHECK_ORDER = [
    "workflow",
    "build",
    "query",
    "shortcuts",
    "isolation",
    "quick-add",
    "ux-boundary",
    "storybook",
]
MODEL_FIELDS = {
    "target",
    "intent",
    "current_system",
    "domain",
    "flow",
    "invariants",
    "implementation_location",
    "affected",
    "do_not_change",
    "unknowns",
    "risk",
    "evidence",
    "decision_required",
}


class DeliveryError(RuntimeError):
    pass


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def project_root(explicit: str | None = None) -> Path:
    if explicit:
        root = Path(explicit)
    elif os.environ.get("CLAUDE_PROJECT_DIR"):
        root = Path(os.environ["CLAUDE_PROJECT_DIR"])
    else:
        root = Path(__file__).resolve().parents[2]
    return root.resolve()


def state_path(root: Path) -> Path:
    return root / STATE_RELATIVE


def run_git(root: Path, *args: str) -> bytes:
    result = subprocess.run(
        ["git", "-C", str(root), *args],
        check=False,
        capture_output=True,
    )
    if result.returncode != 0:
        message = result.stderr.decode("utf-8", errors="replace").strip()
        raise DeliveryError(f"git {' '.join(args)} failed: {message}")
    return result.stdout


def repository_paths(root: Path) -> list[str]:
    raw = run_git(root, "ls-files", "--cached", "--others", "--exclude-standard", "-z")
    paths = [item.decode("utf-8") for item in raw.split(b"\0") if item]
    return sorted(set(paths))


def hash_path(path: Path) -> str:
    digest = hashlib.sha256()
    if path.is_symlink():
        digest.update(b"symlink\0")
        digest.update(os.readlink(path).encode("utf-8"))
        return digest.hexdigest()
    digest.update(path.read_bytes())
    return digest.hexdigest()


def snapshot(root: Path) -> dict[str, str]:
    result: dict[str, str] = {}
    for relative in repository_paths(root):
        path = root / relative
        if path.is_file() or path.is_symlink():
            result[relative] = hash_path(path)
    return result


def fingerprint(files: dict[str, str]) -> str:
    encoded = json.dumps(files, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def changed_paths(before: dict[str, str], after: dict[str, str]) -> list[str]:
    return sorted(
        path
        for path in set(before) | set(after)
        if before.get(path) != after.get(path)
    )


def slugify(task: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", task.lower()).strip("-")[:48]
    return slug or "delivery"


def read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise DeliveryError(f"Cannot read JSON from {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise DeliveryError(f"Expected a JSON object in {path}")
    return value


def _yaml_scalar(value: str) -> Any:
    value = value.strip()
    if not value:
        return ""
    if value in {"null", "Null", "NULL", "~"}:
        return None
    if value.lower() in {"true", "false"}:
        return value.lower() == "true"
    if (value.startswith('"') and value.endswith('"')) or (value.startswith("'") and value.endswith("'")):
        try:
            import ast
            return ast.literal_eval(value)
        except (SyntaxError, ValueError):
            return value[1:-1]
    if re.fullmatch(r"-?\d+", value):
        try:
            return int(value)
        except ValueError:
            pass
    return value


def _read_simple_bugs_yaml(path: Path) -> dict[str, Any]:
    """Dependency-free fallback for the intentionally tiny manual-QA YAML schema."""
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError as exc:
        raise DeliveryError(f"Cannot read YAML from {path}: {exc}") from exc

    bugs: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None
    i = 0
    saw_bugs = False
    while i < len(lines):
        raw = lines[i]
        stripped = raw.strip()
        if not stripped or stripped.startswith("#"):
            i += 1
            continue
        indent = len(raw) - len(raw.lstrip(" "))
        if indent == 0 and stripped == "bugs:":
            saw_bugs = True
            i += 1
            continue
        if not saw_bugs:
            raise DeliveryError("Manual-QA YAML fallback expects a top-level `bugs:` list")
        if indent == 2 and stripped.startswith("- "):
            current = {}
            bugs.append(current)
            first = stripped[2:].strip()
            if first:
                if ":" not in first:
                    raise DeliveryError(f"Invalid YAML bug entry near line {i + 1}")
                key, value = first.split(":", 1)
                current[key.strip()] = _yaml_scalar(value)
            i += 1
            continue
        if current is None or indent != 4 or ":" not in stripped:
            raise DeliveryError(f"Unsupported manual-QA YAML shape near line {i + 1}")
        key, value = stripped.split(":", 1)
        key, value = key.strip(), value.strip()
        if value in {">", "|"}:
            block: list[str] = []
            i += 1
            while i < len(lines):
                block_raw = lines[i]
                block_indent = len(block_raw) - len(block_raw.lstrip(" "))
                if block_raw.strip() and block_indent <= 4:
                    break
                if block_indent >= 6:
                    block.append(block_raw[6:])
                elif not block_raw.strip():
                    block.append("")
                i += 1
            current[key] = (" ".join(part.strip() for part in block if part.strip()) if value == ">" else "\n".join(block).strip())
            continue
        if not value:
            items: list[str] = []
            i += 1
            while i < len(lines):
                item_raw = lines[i]
                item_indent = len(item_raw) - len(item_raw.lstrip(" "))
                item_stripped = item_raw.strip()
                if not item_stripped:
                    i += 1
                    continue
                if item_indent <= 4:
                    break
                if item_indent == 6 and item_stripped.startswith("- "):
                    items.append(str(_yaml_scalar(item_stripped[2:])))
                    i += 1
                    continue
                raise DeliveryError(f"Unsupported YAML list item near line {i + 1}")
            current[key] = items
            continue
        current[key] = _yaml_scalar(value)
        i += 1

    if not saw_bugs:
        raise DeliveryError("Manual-QA YAML requires a top-level `bugs:` list")
    return {"bugs": bugs}


def read_manual_qa_file(path: Path) -> dict[str, Any]:
    suffix = path.suffix.lower()
    if suffix == ".json":
        return read_json(path)
    if suffix not in {".yaml", ".yml"}:
        raise DeliveryError("Manual-QA file must use .json, .yaml, or .yml")
    try:
        import yaml  # type: ignore
    except ImportError:
        return _read_simple_bugs_yaml(path)
    try:
        value = yaml.safe_load(path.read_text(encoding="utf-8"))
    except (OSError, yaml.YAMLError) as exc:
        raise DeliveryError(f"Cannot read YAML from {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise DeliveryError(f"Expected a YAML object in {path}")
    return value


def normalize_manual_qa_payload(payload: dict[str, Any]) -> list[dict[str, Any]]:
    if "defects" in payload:
        defects = payload.get("defects")
        if not isinstance(defects, list):
            raise DeliveryError("Manual QA `defects` must be a list")
        return defects

    bugs = payload.get("bugs")
    if not isinstance(bugs, list):
        raise DeliveryError("Manual QA requires a top-level `bugs` or `defects` list")
    normalized: list[dict[str, Any]] = []
    for bug in bugs:
        if not isinstance(bug, dict):
            raise DeliveryError("Every manual-QA bug must be an object")
        status = str(bug.get("status") or "Open").strip()
        if status.lower() != "open":
            continue
        description = bug.get("description")
        validate_string(description, "manual_qa.description")
        steps = bug.get("steps", [])
        validate_string_list(steps, "manual_qa.steps", allow_empty=True)
        normalized.append({
            "manual_bug_id": bug.get("id"),
            "manual_status": status,
            "category": bug.get("category") or "ui",
            "expected": bug.get("expected") or "The reported manual-QA issue no longer occurs while intended product behavior is preserved.",
            "actual": str(description).strip(),
            "reproduction": steps,
            "suspected_area": bug.get("suspected_area") or "manual QA surface",
            "evidence": bug.get("evidence", []),
            "invariant_violated": bug.get("invariant_violated") or "The user-reported manual-QA defect must be resolved.",
        })
    if not normalized:
        raise DeliveryError("Manual-QA YAML contains no Open bugs")
    return normalized


def write_state(root: Path, state: dict[str, Any]) -> None:
    target = state_path(root)
    target.parent.mkdir(parents=True, exist_ok=True)
    state["updated_at"] = utc_now()
    with tempfile.NamedTemporaryFile(
        mode="w",
        encoding="utf-8",
        dir=target.parent,
        prefix=".current-",
        suffix=".json",
        delete=False,
    ) as handle:
        json.dump(state, handle, indent=2, sort_keys=True)
        handle.write("\n")
        temporary = Path(handle.name)
    os.replace(temporary, target)


def add_defect(
    state: dict[str, Any],
    *,
    source: str,
    severity: str,
    expected: str,
    actual: str,
    reproduction: list[str] | None = None,
    evidence: list[str] | None = None,
    invariant: str | None = None,
    suspected_area: str | None = None,
) -> dict[str, Any]:
    defects = state.setdefault("defects", [])
    defect = {
        "id": f"D-{len(defects) + 1:03d}",
        "source": source,
        "severity": severity,
        "expected": expected,
        "actual": actual,
        "reproduction": reproduction or [],
        "evidence": evidence or [],
        "invariant_violated": invariant,
        "suspected_area": suspected_area,
        "status": "open",
        "created_at": utc_now(),
    }
    defects.append(defect)
    return defect


def verification_policy(state: dict[str, Any]) -> dict[str, int]:
    risk = str((state.get("change_model") or {}).get("risk") or "low")
    return dict(VERIFIER_BUDGETS.get(risk, VERIFIER_BUDGETS["low"]))


def ensure_budget(state: dict[str, Any]) -> dict[str, Any]:
    """Add bounded-loop runtime fields without invalidating v1 state files."""
    policy = verification_policy(state)
    budget = state.get("budget")
    if not isinstance(budget, dict):
        has_prior_verifier_defects = any(
            item.get("source") == "verifier" for item in state.get("defects", [])
        )
        budget = {
            "full_verifier_runs": 1 if has_prior_verifier_defects else 0,
            "targeted_verifier_runs": 0,
            "repair_cycles": 0,
        }
        state["budget"] = budget
    budget.setdefault("human_extra_targeted", 0)
    budget.setdefault("human_extra_repairs", 0)
    budget.setdefault("manual_qa_batches", 0)
    budget["max_full_verifier_runs"] = policy["full"]
    budget["max_targeted_verifier_runs"] = (
        policy["targeted"] + int(budget.get("human_extra_targeted", 0))
    )
    budget["max_repair_cycles"] = (
        policy["repair_cycles"] + int(budget.get("human_extra_repairs", 0))
    )
    state.setdefault("observations", [])
    # Legacy runtimes treated documentation/cosmetic findings as blockers.
    # Demote them on load so an old delivery does not keep generating repair
    # loops solely for prose/fidelity cleanup.
    for item in state.get("defects", []):
        if (
            item.get("source") == "verifier"
            and item.get("severity") in NON_BLOCKING_VERIFIER_SEVERITIES
            and item.get("status") in {"open", "candidate-repaired"}
        ):
            item["status"] = "non-blocking"
    if "verification_mode" not in state:
        state["verification_mode"] = (
            "targeted"
            if any(item.get("source") == "verifier" for item in state.get("defects", []))
            else "full"
        )
    state.setdefault("verifier_claim", None)
    state.setdefault("worker_claim", None)
    return budget


def add_observation(state: dict[str, Any], text: str, *, severity: str = "note") -> None:
    observations = state.setdefault("observations", [])
    observations.append(
        {
            "severity": severity,
            "text": text.strip(),
            "created_at": utc_now(),
        }
    )
    # Runtime memory is not a report archive. Keep only the most recent observations.
    if len(observations) > 20:
        del observations[:-20]


def current_snapshot(root: Path) -> tuple[dict[str, str], str]:
    files = snapshot(root)
    return files, fingerprint(files)


def load_state(root: Path, *, refresh_ready: bool = True) -> dict[str, Any]:
    target = state_path(root)
    if not target.is_file():
        raise DeliveryError("No active delivery. Start one with /deliver <task>.")
    state = read_json(target)
    if state.get("version") != VERSION:
        raise DeliveryError("Unsupported delivery state version")
    ensure_budget(state)
    # v1 compatibility: old runtimes called this product review even though UI
    # still required human acceptance. Treat it as manual-QA readiness.
    if state.get("state") == "READY_FOR_PRODUCT_REVIEW":
        state["state"] = "READY_FOR_MANUAL_QA"
        write_state(root, state)
    if refresh_ready and state.get("state") == "READY_FOR_MANUAL_QA":
        _, current = current_snapshot(root)
        verified = (state.get("verifier") or {}).get("fingerprint")
        if current != verified:
            add_defect(
                state,
                source="quality-system",
                severity="process",
                expected="Repository remains identical to the independently verified candidate.",
                actual="Repository changed after the verifier receipt was issued.",
                evidence=[f"verified={verified}", f"current={current}"],
            )
            state["state"] = "REPAIRING"
            state["quality"] = None
            state["verifier"] = None
            write_state(root, state)
    return state


def require_state(state: dict[str, Any], allowed: set[str], action: str) -> None:
    current = str(state.get("state", "missing"))
    if current not in allowed:
        raise DeliveryError(
            f"Cannot {action} while delivery is {current}; expected one of "
            + ", ".join(sorted(allowed))
        )


def validate_string(value: Any, field: str) -> None:
    if not isinstance(value, str) or not value.strip():
        raise DeliveryError(f"Change Model field `{field}` must be a non-empty string")


def validate_string_list(value: Any, field: str, *, allow_empty: bool = False) -> None:
    if not isinstance(value, list) or (not value and not allow_empty):
        qualifier = "a list" if allow_empty else "a non-empty list"
        raise DeliveryError(f"Change Model field `{field}` must be {qualifier}")
    if any(not isinstance(item, str) or not item.strip() for item in value):
        raise DeliveryError(f"Change Model field `{field}` contains an invalid item")


def validate_feature_check(command: str) -> str:
    validate_string(command, "feature_checks")
    normalized = " ".join(command.split())
    if len(normalized) > 180 or ".." in normalized:
        raise DeliveryError("Feature check is unsafe or too long")
    if not any(pattern.fullmatch(normalized) for pattern in FEATURE_CHECK_PATTERNS):
        raise DeliveryError(
            "Unsupported feature check. Use `node scripts/*-selftest.mjs`, "
            "`python3 scripts/*-selftest.py`, or `npm run test:<name>`."
        )
    return normalized


def feature_checks(model: dict[str, Any], paths: list[str]) -> list[str]:
    commands: list[str] = []
    for raw in model.get("feature_checks", []):
        command = validate_feature_check(str(raw))
        if command not in commands:
            commands.append(command)
    for path in paths:
        if path.startswith("scripts/") and path.endswith("-selftest.mjs"):
            command = validate_feature_check(f"node {path}")
            if command not in commands:
                commands.append(command)
        elif path.startswith("scripts/") and path.endswith("-selftest.py"):
            command = validate_feature_check(f"python3 {path}")
            if command not in commands:
                commands.append(command)
    if len(commands) > 5:
        raise DeliveryError("At most five feature-specific deterministic checks are allowed")
    return commands


def verification_route(state: dict[str, Any]) -> str:
    mode = str(state.get("verification_mode") or "full")
    if mode == "targeted":
        return "verifier-targeted"
    risk = str((state.get("change_model") or {}).get("risk") or "low")
    return "verifier" if risk == "high" else "verifier-lite"



def delivery_target(state: dict[str, Any]) -> str:
    target = str(state.get("delivery_target") or "production")
    if target not in DELIVERY_TARGETS:
        raise DeliveryError(f"Unsupported delivery target `{target}`")
    return target


def is_reference_path(path: str) -> bool:
    return any(path == prefix.rstrip("/") or path.startswith(prefix) for prefix in REFERENCE_PREFIXES)


def is_production_path(path: str) -> bool:
    return path in PRODUCTION_FILES or any(path.startswith(prefix) for prefix in PRODUCTION_PREFIXES)


def model_mentions_production_location(item: str) -> bool:
    normalized = item.strip().lower().replace("\\", "/")
    if normalized in {name.lower() for name in PRODUCTION_FILES}:
        return True
    return any(prefix in normalized for prefix in PRODUCTION_PREFIXES)


def validate_model_target(model: dict[str, Any], target: str) -> None:
    if model.get("target") != target:
        raise DeliveryError(
            f"Change Model target `{model.get('target')}` does not match delivery target `{target}`"
        )
    locations = [str(item) for item in model.get("implementation_location", [])]
    do_not_change = " ".join(str(item).lower() for item in model.get("do_not_change", []))
    if target == "production":
        if not any(model_mentions_production_location(item) for item in locations):
            raise DeliveryError(
                "Production /deliver requires at least one production implementation location "
                "(for example src/, server/, styles.css or index.html). Storybook/design artifacts "
                "are references, not the delivery target."
            )
        if "all production" in do_not_change or "production sources" in do_not_change:
            raise DeliveryError(
                "Production /deliver cannot declare production sources as out of scope. "
                "If a Storybook story is the prototype, keep the story read-only and implement the feature in production."
            )
    elif target == "prototype":
        if any(model_mentions_production_location(item) for item in locations):
            raise DeliveryError("Prototype delivery may not target production implementation paths")


def validate_candidate_target(state: dict[str, Any], paths: list[str]) -> str | None:
    target = delivery_target(state)
    production = [path for path in paths if is_production_path(path)]
    references = [path for path in paths if is_reference_path(path)]
    if target == "production":
        if references:
            return (
                "Production delivery modified read-only prototype/design reference artifacts: "
                + ", ".join(references[:8])
            )
        if not production:
            return (
                "Production delivery changed no production paths. A Storybook concept, UX brief, "
                "or decision document is evidence/reference only; implement the shipping feature in production code."
            )
    elif production:
        return "Prototype delivery modified production paths: " + ", ".join(production[:8])
    return None

def validate_change_model(model: dict[str, Any], expected_target: str | None = None) -> None:
    if len(json.dumps(model, ensure_ascii=False)) > 8000:
        raise DeliveryError("Change Model is too large; keep it under 8 KB and record only execution-critical context")
    missing = sorted(MODEL_FIELDS - set(model))
    if missing:
        raise DeliveryError("Change Model is missing: " + ", ".join(missing))
    if model.get("target") not in DELIVERY_TARGETS:
        raise DeliveryError("Change Model `target` must be production or prototype")
    if expected_target is not None:
        validate_model_target(model, expected_target)
    for field in ("intent", "current_system", "domain"):
        validate_string(model[field], field)
    for field in (
        "flow",
        "invariants",
        "implementation_location",
        "affected",
        "do_not_change",
    ):
        validate_string_list(model[field], field)
    validate_string_list(model["unknowns"], "unknowns", allow_empty=True)
    validate_string_list(model["evidence"], "evidence", allow_empty=True)
    raw_feature_checks = model.get("feature_checks", [])
    validate_string_list(raw_feature_checks, "feature_checks", allow_empty=True)
    if len(raw_feature_checks) > 5:
        raise DeliveryError("Change Model `feature_checks` may contain at most 5 items")
    for command in raw_feature_checks:
        validate_feature_check(command)
    unknown_evidence = sorted(set(model["evidence"]) - KNOWN_EVIDENCE)
    if unknown_evidence:
        raise DeliveryError("Unknown evidence checks: " + ", ".join(unknown_evidence))
    if model["risk"] not in {"low", "medium", "high"}:
        raise DeliveryError("Change Model `risk` must be low, medium, or high")
    if not isinstance(model["decision_required"], bool):
        raise DeliveryError("Change Model `decision_required` must be boolean")
    for field in ("flow", "invariants", "implementation_location", "affected", "do_not_change"):
        if len(model[field]) > 8:
            raise DeliveryError(f"Change Model `{field}` may contain at most 8 items")


def inferred_evidence(paths: list[str]) -> set[str]:
    result: set[str] = set()
    lowered = [path.lower() for path in paths]

    if any(path.startswith(".claude/") or path.startswith("docs/agent/") for path in paths):
        result.add("workflow")
    if any(
        path.startswith(("src/", "server/", "scripts/"))
        or path in {"index.html", "styles.css", "package.json", "tsconfig.json", "tsconfig.renderer.json"}
        for path in paths
    ):
        result.add("build")
    if any(
        path.startswith("server/") or path in {"src/main.ts", "src/preload.ts", "src/types.ts"}
        for path in paths
    ):
        result.add("isolation")
    if any(
        path.startswith("src/renderer/") or path in {"index.html", "styles.css"}
        for path in paths
    ):
        # UI delivery must at least launch through the isolated real Electron
        # harness. Feature-specific journeys belong in Change Model feature_checks.
        result.add("isolation")
        result.add("storybook")
    if any("quick-add" in path or "composeoptions" in path for path in lowered):
        result.add("quick-add")
    if any("query" in path or "smartlist" in path for path in lowered):
        result.add("query")
    if any("shortcut" in path for path in lowered):
        result.add("shortcuts")
    if any(path.startswith("ui-ux/") or path.startswith(".storybook/") for path in paths):
        result.add("storybook")
        result.add("ux-boundary")

    if "isolation" in result or "quick-add" in result:
        result.discard("build")
    return result


def check_diff(root: Path, paths: list[str]) -> tuple[int, float]:
    started = time.monotonic()
    result = subprocess.run(["git", "-C", str(root), "diff", "--check"], check=False)
    if result.returncode != 0:
        return result.returncode, time.monotonic() - started

    # `git diff --check` ignores untracked files. Inspect changed untracked text
    # candidates directly so a new concept/test file is not invisible to the gate.
    tracked_raw = run_git(root, "ls-files", "-z")
    tracked = {item.decode("utf-8") for item in tracked_raw.split(b"\0") if item}
    for relative in paths:
        if relative in tracked:
            continue
        path = root / relative
        if not path.is_file() or path.stat().st_size > 2_000_000:
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        for line_number, line in enumerate(text.splitlines(), start=1):
            if line.rstrip(" \t") != line:
                print(f"{relative}:{line_number}: trailing whitespace", file=sys.stderr)
                return 1, time.monotonic() - started
            if line.startswith(("<<<<<<< ", "=======", ">>>>>>> ")):
                print(f"{relative}:{line_number}: conflict marker", file=sys.stderr)
                return 1, time.monotonic() - started
    return 0, time.monotonic() - started


def run_check(root: Path, check: str, paths: list[str]) -> tuple[int, float]:
    if check == "diff-check":
        return check_diff(root, paths)
    started = time.monotonic()
    result = subprocess.run(CHECKS[check], cwd=root, check=False)
    return result.returncode, time.monotonic() - started


def run_feature_check(root: Path, command: str) -> tuple[int, float]:
    normalized = validate_feature_check(command)
    started = time.monotonic()
    result = subprocess.run(shlex.split(normalized), cwd=root, check=False)
    return result.returncode, time.monotonic() - started


def validate_verifier_report(
    report: dict[str, Any], verdict: str, mode: str, state: dict[str, Any]
) -> None:
    if report.get("verdict") != verdict:
        raise DeliveryError("Verifier report verdict does not match the command")
    for field in ("domain_correctness", "implementation_correctness"):
        value = report.get(field)
        if not isinstance(value, dict):
            raise DeliveryError(f"Verifier report `{field}` must be an object")
        validate_string(value.get("assessment"), f"{field}.assessment")
        validate_string_list(value.get("evidence"), f"{field}.evidence")
    scenarios = report.get("adversarial_scenarios")
    if not isinstance(scenarios, list) or not scenarios:
        raise DeliveryError("Verifier report requires at least one adversarial scenario")
    if len(scenarios) > MAX_ADVERSARIAL_SCENARIOS:
        raise DeliveryError(
            f"Verifier report may contain at most {MAX_ADVERSARIAL_SCENARIOS} adversarial scenarios"
        )
    for scenario in scenarios:
        if not isinstance(scenario, dict):
            raise DeliveryError("Every adversarial scenario must be an object")
        for field in ("scenario", "result", "evidence"):
            validate_string(scenario.get(field), f"adversarial_scenarios.{field}")
    validate_string_list(
        report.get("residual_risks"), "residual_risks", allow_empty=True
    )
    observations = report.get("observations", [])
    validate_string_list(observations, "observations", allow_empty=True)
    if len(observations) > 5:
        raise DeliveryError("Verifier report may contain at most 5 non-blocking observations")
    defects = report.get("defects")
    if not isinstance(defects, list):
        raise DeliveryError("Verifier report `defects` must be a list")
    if verdict == "pass" and defects:
        raise DeliveryError("A passing verifier report cannot contain defects")
    if verdict == "fail" and not defects:
        raise DeliveryError("A failing verifier report must contain defects")
    if len(defects) > MAX_VERIFIER_DEFECTS:
        raise DeliveryError(
            f"Verifier report may contain at most {MAX_VERIFIER_DEFECTS} blocking defects; group by root cause"
        )
    existing = {item.get("id"): item for item in state.get("defects", [])}
    for defect in defects:
        if not isinstance(defect, dict):
            raise DeliveryError("Every verifier defect must be an object")
        for field in (
            "severity",
            "expected",
            "actual",
            "suspected_area",
            "invariant_violated",
        ):
            validate_string(defect.get(field), f"defects.{field}")
        validate_string_list(defect.get("reproduction"), "defects.reproduction")
        validate_string_list(defect.get("evidence"), "defects.evidence")
        severity = str(defect.get("severity"))
        if severity not in BLOCKING_VERIFIER_SEVERITIES | NON_BLOCKING_VERIFIER_SEVERITIES:
            raise DeliveryError(f"Unsupported verifier defect severity `{severity}`")
        if mode == "targeted":
            defect_id = defect.get("defect_id")
            if defect_id is not None:
                validate_string(defect_id, "defects.defect_id")
                prior = existing.get(defect_id)
                if not prior or prior.get("source") not in {"verifier", "manual-qa"}:
                    raise DeliveryError(
                        f"Targeted verifier defect `{defect_id}` does not reference a prior verifier/manual-QA defect"
                    )


def command_start(root: Path, task: str, target_kind: str, references: list[str] | None = None) -> None:
    validate_string(task, "task")
    if target_kind not in DELIVERY_TARGETS:
        raise DeliveryError(f"Unsupported delivery target `{target_kind}`")
    references = [item.strip() for item in (references or []) if item.strip()]
    target = state_path(root)
    if target.is_file():
        existing = load_state(root)
        if existing.get("state") in ACTIVE_STATES:
            raise DeliveryError(
                f"Delivery `{existing.get('id')}` is still {existing.get('state')}; resume it instead"
            )
    baseline = snapshot(root)
    state = {
        "version": VERSION,
        "id": f"{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}-{slugify(task)}",
        "state": "UNDERSTANDING",
        "task": task.strip(),
        "delivery_target": target_kind,
        "reference_artifacts": references,
        "created_at": utc_now(),
        "updated_at": utc_now(),
        "baseline": baseline,
        "change_model": None,
        "authorization": None,
        "quality": None,
        "verifier": None,
        "verifier_claim": None,
        "worker_claim": None,
        "verification_mode": "full",
        "defects": [],
        "observations": [],
        "budget": {
            "full_verifier_runs": 0,
            "targeted_verifier_runs": 0,
            "repair_cycles": 0,
            "human_extra_targeted": 0,
            "human_extra_repairs": 0,
            "manual_qa_batches": 0,
            "max_full_verifier_runs": VERIFIER_BUDGETS["low"]["full"],
            "max_targeted_verifier_runs": VERIFIER_BUDGETS["low"]["targeted"],
            "max_repair_cycles": VERIFIER_BUDGETS["low"]["repair_cycles"],
        },
        "handoff": None,
    }
    write_state(root, state)
    print(f"{state['id']}: UNDERSTANDING")


def command_model(root: Path, model_file: str) -> None:
    state = load_state(root)
    require_state(state, {"UNDERSTANDING", "BLOCKED_DECISION"}, "record a Change Model")
    model = read_json(Path(model_file).resolve())
    validate_change_model(model, delivery_target(state))
    state["change_model"] = model
    ensure_budget(state)
    state["quality"] = None
    state["verifier"] = None
    state["verifier_claim"] = None
    state["verification_mode"] = "full"
    if model["risk"] == "high" or model["decision_required"] or model["unknowns"]:
        state["state"] = "BLOCKED_DECISION"
    else:
        state["state"] = "IMPLEMENTING"
    write_state(root, state)
    print(f"{state['id']}: {state['state']} ({model['risk']} risk)")


def command_authorize(root: Path, reason: str) -> None:
    state = load_state(root)
    require_state(state, {"BLOCKED_DECISION"}, "authorize high-risk implementation")
    model = state.get("change_model") or {}
    if model.get("risk") != "high":
        raise DeliveryError("Only a high-risk delivery uses explicit human authorization")
    if model.get("unknowns") or model.get("decision_required"):
        raise DeliveryError(
            "Resolve the open decision and record a revised Change Model before authorization"
        )
    validate_string(reason, "reason")
    state["authorization"] = {
        "kind": "explicit-human",
        "reason": reason.strip(),
        "authorized_at": utc_now(),
    }
    state["state"] = "IMPLEMENTING"
    state["worker_claim"] = None
    write_state(root, state)
    print(f"{state['id']}: IMPLEMENTING (explicit human authorization)")


def command_worker_claim(root: Path, role: str, as_json: bool) -> None:
    state = load_state(root)
    require_state(
        state,
        {"UNDERSTANDING", "BLOCKED_DECISION", "IMPLEMENTING", "REPAIRING"},
        "claim an execution worker",
    )
    if role not in {"implementer", "product-designer"}:
        raise DeliveryError(f"Unsupported delivery worker role `{role}`")

    target = delivery_target(state)
    existing_model = state.get("change_model")
    if isinstance(existing_model, dict) and state.get("state") in {"IMPLEMENTING", "REPAIRING"}:
        if existing_model.get("target") != target:
            raise DeliveryError(
                "Stored Change Model targets a different artifact class than this delivery. "
                "Do not continue the handoff; retarget/reset the delivery first."
            )
    if target == "production" and role == "product-designer":
        raise DeliveryError(
            "`/deliver` targets the shipping product. Storybook/UX concepts are read-only references; "
            "claim implementer, not product-designer."
        )
    if target == "prototype" and role == "implementer":
        raise DeliveryError("Prototype work is owned by product-designer, not implementer")

    existing = state.get("worker_claim")
    if isinstance(existing, dict):
        if existing.get("role") != role:
            raise DeliveryError(
                "Another execution worker already owns this phase: "
                f"{existing.get('role')}. Do not spawn a second agent."
            )
        payload = existing
    else:
        payload = {
            "id": f"W-{role}-{int(time.time())}",
            "role": role,
            "phase": state["state"],
            "claimed_at": utc_now(),
        }
        state["worker_claim"] = payload
        write_state(root, state)

    if as_json:
        print(json.dumps(payload, indent=2, sort_keys=True))
    else:
        print(f"{payload['id']}: worker claim role={payload['role']}")


def command_quality(root: Path) -> None:
    state = load_state(root)
    require_state(state, IMPLEMENTATION_STATES, "run the deterministic quality gate")
    previous_state = state["state"]
    budget = ensure_budget(state)
    worker_claim = state.get("worker_claim")
    if not isinstance(worker_claim, dict):
        raise DeliveryError(
            "Quality gate refused: no execution worker claim. Claim exactly one owner "
            "with `delivery.py worker-claim --role ...` before candidate work."
        )
    # Candidate construction is over; any later repair gets a new single-owner
    # claim. This prevents one phase from fanning out into multiple workers.
    state["worker_claim"] = None
    if previous_state == "REPAIRING":
        if budget["repair_cycles"] >= budget["max_repair_cycles"]:
            state["state"] = "NEEDS_HUMAN_REVIEW"
            write_state(root, state)
            raise DeliveryError(
                "Autonomous repair budget exhausted; delivery moved to NEEDS_HUMAN_REVIEW"
            )
        budget["repair_cycles"] += 1
    model = state.get("change_model")
    if not isinstance(model, dict):
        raise DeliveryError("Delivery has no Change Model")
    validate_change_model(model, delivery_target(state))
    before_checks = snapshot(root)
    paths = changed_paths(state.get("baseline", {}), before_checks)
    target_error = validate_candidate_target(state, paths) if paths else None
    if target_error is not None:
        defect = add_defect(
            state,
            source="quality-gate",
            severity="process",
            expected=f"Candidate matches delivery target `{delivery_target(state)}`.",
            actual=target_error,
        )
        state["state"] = "REPAIRING"
        state["quality"] = {"passed": False, "defect": defect["id"], "checks": []}
        write_state(root, state)
        raise DeliveryError("Quality gate failed: delivery target mismatch")
    if not paths:
        defect = add_defect(
            state,
            source="quality-gate",
            severity="process",
            expected="A delivery candidate changes repository state relative to its baseline.",
            actual="No candidate changes were detected.",
        )
        state["state"] = "REPAIRING"
        state["quality"] = {"passed": False, "defect": defect["id"], "checks": []}
        write_state(root, state)
        raise DeliveryError("Quality gate failed: no candidate changes")

    selected = inferred_evidence(paths) | set(model.get("evidence", []))
    checks = ["diff-check"] + [name for name in CHECK_ORDER if name in selected]
    deterministic_feature_checks = feature_checks(model, paths)
    results: list[dict[str, Any]] = []
    failure: str | None = None
    for check in checks:
        print(f"==> delivery quality: {check}", flush=True)
        returncode, duration = run_check(root, check, paths)
        results.append(
            {
                "check": check,
                "command": "git diff --check" if check == "diff-check" else " ".join(CHECKS[check]),
                "returncode": returncode,
                "seconds": round(duration, 3),
            }
        )
        if returncode != 0:
            failure = check
            break
    if failure is None:
        for command in deterministic_feature_checks:
            check = f"feature:{command}"
            print(f"==> delivery quality: {check}", flush=True)
            returncode, duration = run_feature_check(root, command)
            results.append(
                {
                    "check": check,
                    "command": command,
                    "returncode": returncode,
                    "seconds": round(duration, 3),
                }
            )
            if returncode != 0:
                failure = check
                break

    after_checks, candidate = current_snapshot(root)
    if failure is None and fingerprint(before_checks) != candidate:
        failure = "repository-stability"
        results.append(
            {
                "check": failure,
                "command": "compare repository fingerprint before/after quality commands",
                "returncode": 1,
                "seconds": 0,
            }
        )

    receipt = {
        "passed": failure is None,
        "fingerprint": candidate,
        "changed_paths": changed_paths(state.get("baseline", {}), after_checks),
        "checks": results,
        "completed_at": utc_now(),
    }
    state["quality"] = receipt
    state["verifier"] = None
    state["verifier_claim"] = None
    if failure is not None:
        defect = add_defect(
            state,
            source="quality-gate",
            severity="functional" if failure != "repository-stability" else "process",
            expected="Every selected deterministic check passes on an unchanged candidate.",
            actual=f"Quality check `{failure}` failed.",
            reproduction=[next((item["command"] for item in results if item["check"] == failure), failure)],
            evidence=[f"fingerprint={candidate}"],
        )
        receipt["defect"] = defect["id"]
        state["state"] = (
            "NEEDS_HUMAN_REVIEW"
            if previous_state == "REPAIRING"
            and budget["repair_cycles"] >= budget["max_repair_cycles"]
            else "REPAIRING"
        )
        write_state(root, state)
        raise DeliveryError(
            f"Quality gate failed at {failure}; delivery moved to {state['state']}"
        )

    for defect in state.get("defects", []):
        if defect.get("status") == "open":
            defect["status"] = "candidate-repaired"
    state["state"] = "VERIFYING"
    state["verification_mode"] = "full" if previous_state == "IMPLEMENTING" else "targeted"
    write_state(root, state)
    print(
        f"{state['id']}: VERIFYING ({len(results)} checks passed; "
        f"mode={state['verification_mode']})"
    )


def command_verifier_claim(root: Path, as_json: bool) -> None:
    state = load_state(root)
    require_state(state, {"VERIFYING"}, "claim verifier budget")
    quality = state.get("quality") or {}
    if not quality.get("passed"):
        raise DeliveryError("Verifier budget requires a passing quality receipt")
    _, current = current_snapshot(root)
    if current != quality.get("fingerprint"):
        state["state"] = "REPAIRING"
        state["quality"] = None
        state["verifier_claim"] = None
        write_state(root, state)
        raise DeliveryError("Candidate changed after quality; verifier budget was not consumed")

    mode = str(state.get("verification_mode") or "full")
    if mode not in {"full", "targeted"}:
        raise DeliveryError(f"Unsupported verification mode `{mode}`")
    budget = ensure_budget(state)
    existing = state.get("verifier_claim")
    if (
        isinstance(existing, dict)
        and existing.get("fingerprint") == current
        and existing.get("mode") == mode
    ):
        payload = existing
    else:
        used_key = "full_verifier_runs" if mode == "full" else "targeted_verifier_runs"
        max_key = "max_full_verifier_runs" if mode == "full" else "max_targeted_verifier_runs"
        if budget[used_key] >= budget[max_key]:
            state["state"] = "NEEDS_HUMAN_REVIEW"
            state["verifier_claim"] = None
            write_state(root, state)
            raise DeliveryError(
                f"{mode} verifier budget exhausted; delivery moved to NEEDS_HUMAN_REVIEW"
            )
        budget[used_key] += 1
        payload = {
            "id": f"V-{budget['full_verifier_runs']}-{budget['targeted_verifier_runs']}-{int(time.time())}",
            "mode": mode,
            "route": verification_route(state),
            "fingerprint": current,
            "claimed_at": utc_now(),
        }
        state["verifier_claim"] = payload
        write_state(root, state)

    if as_json:
        print(json.dumps(payload, indent=2, sort_keys=True))
    else:
        print(
            f"{payload['id']}: verifier claim mode={payload['mode']} "
            f"route={payload.get('route', verification_route(state))}"
        )


def command_verifier(root: Path, report_file: str, verdict: str) -> None:
    state = load_state(root)
    require_state(state, {"VERIFYING"}, "record independent verification")
    quality = state.get("quality") or {}
    if not quality.get("passed"):
        raise DeliveryError("Independent verification requires a passing quality receipt")
    _, current = current_snapshot(root)
    if current != quality.get("fingerprint"):
        add_defect(
            state,
            source="quality-system",
            severity="process",
            expected="Verifier inspects the exact candidate that passed the quality gate.",
            actual="Repository changed after the quality receipt.",
            evidence=[f"quality={quality.get('fingerprint')}", f"current={current}"],
        )
        state["state"] = "REPAIRING"
        state["quality"] = None
        state["verifier_claim"] = None
        write_state(root, state)
        raise DeliveryError("Verifier receipt rejected: candidate changed after quality")

    claim = state.get("verifier_claim")
    if not isinstance(claim, dict) or claim.get("fingerprint") != current:
        raise DeliveryError(
            "Verifier receipt rejected: claim budget first with `delivery.py verifier-claim`"
        )
    mode = str(claim.get("mode"))
    if mode != str(state.get("verification_mode")):
        raise DeliveryError("Verifier receipt rejected: claim mode no longer matches delivery state")

    report = read_json(Path(report_file).resolve())
    validate_verifier_report(report, verdict, mode, state)
    receipt = {
        **report,
        "fingerprint": current,
        "mode": mode,
        "claim_id": claim.get("id"),
        "completed_at": utc_now(),
    }
    receipt["effective_verdict"] = verdict
    state["verifier"] = receipt
    state["verifier_claim"] = None

    for observation in report.get("observations", []):
        add_observation(state, str(observation), severity="verifier")

    if verdict == "fail":
        blocking_items: list[dict[str, Any]] = []
        late_blockers: list[dict[str, Any]] = []
        for item in report["defects"]:
            severity = str(item.get("severity", "functional"))
            if severity in NON_BLOCKING_VERIFIER_SEVERITIES:
                add_observation(
                    state,
                    f"{severity}: {item.get('actual', '')}",
                    severity=severity,
                )
                continue
            if mode == "targeted" and not item.get("defect_id"):
                late_blockers.append(item)
                continue
            blocking_items.append(item)

        if mode == "targeted":
            existing = {item.get("id"): item for item in state.get("defects", [])}
            for item in blocking_items:
                defect_id = str(item.get("defect_id"))
                prior = existing[defect_id]
                prior["status"] = "open"
                prior["last_actual"] = str(item.get("actual", ""))
                prior["last_evidence"] = [str(value) for value in item.get("evidence", [])]
                prior["last_checked_at"] = utc_now()

            if late_blockers:
                for item in late_blockers:
                    add_observation(
                        state,
                        "New blocking issue noticed during targeted repair verification: "
                        + str(item.get("actual", "")),
                        severity=str(item.get("severity", "functional")),
                    )
                state["state"] = "NEEDS_HUMAN_REVIEW"
                write_state(root, state)
                print(
                    f"{state['id']}: NEEDS_HUMAN_REVIEW "
                    f"({len(late_blockers)} new blocker(s) outside targeted verification scope)"
                )
                return

            if blocking_items:
                budget = ensure_budget(state)
                state["state"] = (
                    "NEEDS_HUMAN_REVIEW"
                    if budget["repair_cycles"] >= budget["max_repair_cycles"]
                    else "REPAIRING"
                )
                write_state(root, state)
                print(
                    f"{state['id']}: {state['state']} "
                    f"({len(blocking_items)} targeted defect(s) still failing)"
                )
                return

            # A fail containing only non-blocking observations cannot create a loop.
            verdict = "pass"
        else:
            for item in blocking_items:
                add_defect(
                    state,
                    source="verifier",
                    severity=str(item.get("severity", "functional")),
                    expected=str(item.get("expected", "Expected behavior was not provided")),
                    actual=str(item.get("actual", "Actual behavior was not provided")),
                    reproduction=[str(value) for value in item.get("reproduction", [])],
                    evidence=[str(value) for value in item.get("evidence", [])],
                    invariant=item.get("invariant_violated"),
                    suspected_area=item.get("suspected_area"),
                )
            if blocking_items:
                state["state"] = "REPAIRING"
                write_state(root, state)
                print(f"{state['id']}: REPAIRING ({len(blocking_items)} blocking verifier defects)")
                return
            verdict = "pass"

    if verdict == "pass":
        receipt["effective_verdict"] = "pass"
        for defect in state.get("defects", []):
            if defect.get("status") == "candidate-repaired":
                if defect.get("severity") in BLOCKING_VERIFIER_SEVERITIES or defect.get("source") != "verifier":
                    defect["status"] = "verified-repaired"
        state["state"] = "READY_FOR_MANUAL_QA"
        state["qa_repair_route"] = None
        state["handoff"] = None
        write_state(root, state)
        print(f"{state['id']}: READY_FOR_MANUAL_QA")


def command_handoff(root: Path, handoff_file: str) -> None:
    state = load_state(root)
    require_state(state, ACTIVE_STATES, "record a handoff")
    handoff = read_json(Path(handoff_file).resolve())
    required = {"checkpoint", "completed", "next_action", "read_first", "verification", "blockers"}
    missing = sorted(required - set(handoff))
    if missing:
        raise DeliveryError("Handoff is missing: " + ", ".join(missing))
    validate_string(handoff["checkpoint"], "handoff.checkpoint")
    validate_string_list(handoff["completed"], "handoff.completed", allow_empty=True)
    if len(handoff["completed"]) > 6:
        raise DeliveryError("Handoff `completed` may contain at most six concise items")
    validate_string(handoff["next_action"], "handoff.next_action")
    validate_string_list(handoff["read_first"], "handoff.read_first")
    if len(handoff["read_first"]) > 5:
        raise DeliveryError("Handoff `read_first` may contain at most five paths")
    validate_string_list(handoff["verification"], "handoff.verification", allow_empty=True)
    validate_string_list(handoff["blockers"], "handoff.blockers", allow_empty=True)
    if len(handoff["verification"]) > 5 or len(handoff["blockers"]) > 3:
        raise DeliveryError("Handoff verification/blocker lists are too long")
    text_items = [
        handoff["checkpoint"],
        handoff["next_action"],
        *handoff["completed"],
        *handoff["read_first"],
        *handoff["verification"],
        *handoff["blockers"],
    ]
    if any(len(item) > 700 for item in text_items) or sum(map(len, text_items)) > 5000:
        raise DeliveryError("Handoff is too verbose; keep it execution-focused and under 5 KB")
    state["handoff"] = {**handoff, "updated_at": utc_now()}
    write_state(root, state)
    print(f"{state['id']}: handoff recorded at {handoff['checkpoint']}")


def command_checkpoint(root: Path, reason: str) -> None:
    """Serialize a continuation checkpoint without an LLM-authored summary."""
    state = load_state(root)
    require_state(state, ACTIVE_STATES, "record a deterministic checkpoint")
    validate_string(reason, "reason")
    compact = status_payload(root, full=False)
    state_name = str(state.get("state"))
    checkpoint = {
        "UNDERSTANDING": "understanding",
        "BLOCKED_DECISION": "understanding",
        "IMPLEMENTING": "implementation",
        "VERIFYING": "verification",
        "REPAIRING": "repair",
        "NEEDS_HUMAN_REVIEW": "repair",
        "READY_FOR_MANUAL_QA": "manual-qa",
    }.get(state_name, "implementation")
    next_action = {
        "UNDERSTANDING": "Resume bounded reconnaissance and record the Change Model.",
        "BLOCKED_DECISION": "Resolve the explicit human decision; do not widen reconnaissance.",
        "IMPLEMENTING": "Resume the single production implementation owner.",
        "VERIFYING": f"Run only {verification_route(state)} for the authorized verification mode.",
        "REPAIRING": "Repair only the open structured defects, then rerun deterministic quality.",
        "NEEDS_HUMAN_REVIEW": "Wait for explicit human direction; do not continue autonomously.",
        "READY_FOR_MANUAL_QA": "Human manually tests the real application; use /qa-fix or /qa-accept.",
    }.get(state_name, "Inspect compact delivery state.")
    completed: list[str] = []
    if state.get("change_model"):
        completed.append("Change Model recorded")
    if (state.get("quality") or {}).get("passed"):
        completed.append("deterministic quality passed")
    if (state.get("verifier") or {}).get("effective_verdict") == "pass":
        completed.append("independent verification passed")
    read_first = [
        path for path in compact.get("changed_paths", []) if is_production_path(path)
    ][:5]
    verification = [
        f"{item.get('command')} — PASS"
        for item in (state.get("quality") or {}).get("checks", [])
        if item.get("returncode") == 0
    ][-5:]
    blockers = [
        str(item.get("actual"))
        for item in compact.get("defects", {}).get("open", [])
    ][:3]
    state["handoff"] = {
        "checkpoint": checkpoint,
        "reason": reason.strip(),
        "completed": completed[:6],
        "next_action": next_action,
        "read_first": read_first,
        "verification": verification,
        "blockers": blockers,
        "updated_at": utc_now(),
        "generated_by": "delivery.py checkpoint",
    }
    write_state(root, state)
    print(f"{state['id']}: deterministic checkpoint recorded ({checkpoint})")


def qa_bootstrap_state(root: Path, defects_file: str) -> dict[str, Any]:
    """Start a narrow manual-QA repair lifecycle from the current working tree.

    This is intentionally not a normal /deliver start: the current repository is
    treated as the already-implemented candidate that a human has tested. Only
    the imported defects may be repaired, followed by deterministic quality and
    targeted verification.
    """
    baseline = snapshot(root)
    source = Path(defects_file).name
    state = {
        "version": VERSION,
        "id": f"{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}-qa-repair-{slugify(source)}",
        "state": "READY_FOR_MANUAL_QA",
        "task": f"Repair explicit manual-QA defects from {source}",
        "delivery_target": "production",
        "reference_artifacts": [],
        "created_at": utc_now(),
        "updated_at": utc_now(),
        "baseline": baseline,
        "change_model": {
            "target": "production",
            "intent": "Repair only the explicit human-observed QA defects imported for this batch.",
            "current_system": "The current working tree is the QA-tested implementation baseline; broad feature reconnaissance is intentionally skipped.",
            "domain": "Narrow production manual-QA repair against an already implemented feature.",
            "flow": [
                "human QA defect -> narrow reproduction -> smallest repair",
                "deterministic quality -> targeted verifier -> manual QA",
            ],
            "invariants": [
                "Do not broaden scope beyond the imported manual-QA defects.",
                "Preserve unrelated shipping behavior and read-only design references.",
            ],
            "implementation_location": ["src/renderer/ or styles.css production UI surface as required by the imported defects"],
            "affected": ["Only production paths required to repair the imported manual-QA defects."],
            "do_not_change": ["ui-ux/ux/ design and Storybook reference artifacts", "Unrelated product behavior"],
            "unknowns": [],
            "risk": "low",
            "evidence": [],
            "feature_checks": [],
            "decision_required": False,
            "qa_bootstrap": True,
        },
        "authorization": None,
        "quality": None,
        "verifier": None,
        "verifier_claim": None,
        "worker_claim": None,
        "verification_mode": "targeted",
        "qa_repair_route": None,
        "defects": [],
        "observations": [],
        "budget": {
            "full_verifier_runs": 0,
            "targeted_verifier_runs": 0,
            "repair_cycles": 0,
            "human_extra_targeted": 0,
            "human_extra_repairs": 0,
            "manual_qa_batches": 0,
            "max_full_verifier_runs": 0,
            "max_targeted_verifier_runs": VERIFIER_BUDGETS["low"]["targeted"],
            "max_repair_cycles": VERIFIER_BUDGETS["low"]["repair_cycles"],
        },
        "handoff": None,
        "qa_bootstrap": {"source": str(Path(defects_file).resolve()), "created_at": utc_now()},
    }
    validate_change_model(state["change_model"], "production")
    write_state(root, state)
    return state


def manual_bug_history(state: dict[str, Any], manual_bug_id: str) -> list[dict[str, Any]]:
    return [
        item
        for item in state.get("defects", [])
        if item.get("source") == "manual-qa"
        and str(item.get("manual_bug_id") or "") == manual_bug_id
    ]


def command_qa_fix(root: Path, defects_file: str) -> None:
    payload = read_manual_qa_file(Path(defects_file).resolve())
    defects = normalize_manual_qa_payload(payload)
    target = state_path(root)
    if not target.is_file():
        state = qa_bootstrap_state(root, defects_file)
    else:
        state = load_state(root)
        if state.get("state") in {"DONE", "FAILED"}:
            state = qa_bootstrap_state(root, defects_file)
        else:
            require_state(state, {"READY_FOR_MANUAL_QA"}, "record manual-QA defects")
    if not defects:
        raise DeliveryError("Manual QA requires at least one Open defect")
    if len(defects) > MAX_MANUAL_QA_DEFECTS:
        raise DeliveryError(
            f"Manual-QA repair batches are capped at {MAX_MANUAL_QA_DEFECTS} defects; split the batch"
        )

    # Determine whether this batch contains human-confirmed reopens before mutating
    # defect history. Same manual bug id is the stable identity across QA passes.
    classifications: list[tuple[dict[str, Any], int]] = []
    contains_new = False
    max_reopen = 0
    for item in defects:
        if not isinstance(item, dict):
            raise DeliveryError("Every manual-QA defect must be an object")
        manual_bug_id = item.get("manual_bug_id")
        reopen_count = 0
        if manual_bug_id is not None:
            history = manual_bug_history(state, str(manual_bug_id))
            if history:
                reopen_count = max(int(x.get("reopen_count", 0)) for x in history) + 1
        if reopen_count == 0:
            contains_new = True
        if reopen_count > MAX_MANUAL_QA_REOPENS:
            state["state"] = "NEEDS_HUMAN_REVIEW"
            state["qa_repair_route"] = None
            add_observation(
                state,
                f"Manual QA bug {manual_bug_id} reopened more than once; autonomous repair stopped.",
                severity="blocking",
            )
            write_state(root, state)
            raise DeliveryError(
                f"Manual QA bug {manual_bug_id} reopened for the second time. "
                "Stop automation and make an explicit human decision."
            )
        max_reopen = max(max_reopen, reopen_count)
        classifications.append((item, reopen_count))

    budget = ensure_budget(state)
    # The ordinary new-defect discovery budget remains capped. A first reopen is
    # allowed even after that cap because it is evidence that a prior repair was
    # not actually accepted by the human tester, not a fresh exploratory batch.
    if contains_new and budget.get("manual_qa_batches", 0) >= MAX_MANUAL_QA_BATCHES:
        state["state"] = "NEEDS_HUMAN_REVIEW"
        write_state(root, state)
        raise DeliveryError(
            "Manual-QA new-defect batch budget exhausted. Reopen an existing bug separately "
            "or make an explicit human decision."
        )

    repair_route = "qa-repairer-sonnet" if max_reopen >= 1 else "qa-repairer"
    for item, reopen_count in classifications:
        for field in ("expected", "actual"):
            validate_string(item.get(field), f"manual_qa.{field}")
        reproduction = item.get("reproduction", [])
        evidence = item.get("evidence", [])
        validate_string_list(reproduction, "manual_qa.reproduction", allow_empty=True)
        validate_string_list(evidence, "manual_qa.evidence", allow_empty=True)
        category = str(item.get("category") or "ui")
        severity = "accessibility" if category == "accessibility" else "functional"
        defect = add_defect(
            state,
            source="manual-qa",
            severity=severity,
            expected=str(item["expected"]),
            actual=str(item["actual"]),
            reproduction=[str(value) for value in reproduction],
            evidence=[str(value) for value in evidence],
            suspected_area=str(item.get("suspected_area") or "manual QA surface"),
            invariant=str(item.get("invariant_violated") or "User-reported behavior must be repaired."),
        )
        defect["manual_category"] = category
        defect["reopen_count"] = reopen_count
        defect["repair_route"] = repair_route
        if item.get("manual_bug_id") is not None:
            defect["manual_bug_id"] = str(item.get("manual_bug_id"))
        if item.get("manual_status"):
            defect["manual_status"] = str(item.get("manual_status"))

    if contains_new:
        budget["manual_qa_batches"] = int(budget.get("manual_qa_batches", 0)) + 1
    budget["human_extra_repairs"] = int(budget.get("human_extra_repairs", 0)) + 1
    budget["human_extra_targeted"] = int(budget.get("human_extra_targeted", 0)) + 1
    ensure_budget(state)
    state["state"] = "REPAIRING"
    state["quality"] = None
    state["verifier"] = None
    state["verifier_claim"] = None
    state["worker_claim"] = None
    state["verification_mode"] = "targeted"
    state["qa_repair_route"] = repair_route
    write_state(root, state)
    kind = "reopen" if max_reopen >= 1 else "new"
    print(
        f"{state['id']}: REPAIRING ({len(defects)} manual-QA defects, {kind}, route={repair_route})"
    )


def command_qa_accept(root: Path, reason: str) -> None:
    state = load_state(root)
    require_state(state, {"READY_FOR_MANUAL_QA"}, "accept manual QA")
    validate_string(reason, "reason")
    _, current = current_snapshot(root)
    verified = (state.get("verifier") or {}).get("fingerprint")
    if not verified or current != verified:
        raise DeliveryError("Manual QA cannot accept a candidate that differs from its verifier receipt")
    state["state"] = "DONE"
    state["manual_qa_acceptance"] = {"reason": reason.strip(), "accepted_at": utc_now()}
    state["handoff"] = None
    write_state(root, state)
    print(f"{state['id']}: DONE (manual QA accepted)")


def command_resume_human(
    root: Path,
    reason: str,
    extra_repairs: int,
    extra_targeted: int,
) -> None:
    state = load_state(root)
    require_state(state, {"NEEDS_HUMAN_REVIEW"}, "resume after explicit human review")
    validate_string(reason, "reason")
    if not (0 <= extra_repairs <= 2 and 0 <= extra_targeted <= 2):
        raise DeliveryError("Human budget extension is capped at 2 repairs and 2 targeted verifiers per resume")
    if extra_repairs == 0 and extra_targeted == 0:
        raise DeliveryError("Human resume must explicitly extend at least one bounded resource")
    budget = ensure_budget(state)
    budget["human_extra_repairs"] += extra_repairs
    budget["human_extra_targeted"] += extra_targeted
    ensure_budget(state)
    state["state"] = "REPAIRING"
    state["worker_claim"] = None
    state["verifier_claim"] = None
    state["human_resume"] = {
        "reason": reason.strip(),
        "extra_repairs": extra_repairs,
        "extra_targeted": extra_targeted,
        "recorded_at": utc_now(),
    }
    write_state(root, state)
    print(
        f"{state['id']}: REPAIRING (human extension: +{extra_repairs} repair, "
        f"+{extra_targeted} targeted verifier)"
    )



def command_retarget(
    root: Path,
    target_kind: str,
    task: str | None,
    references: list[str] | None,
    reason: str,
) -> None:
    state = load_state(root, refresh_ready=False)
    if target_kind not in DELIVERY_TARGETS:
        raise DeliveryError(f"Unsupported delivery target `{target_kind}`")
    validate_string(reason, "reason")
    if task is not None:
        validate_string(task, "task")
    old_id = state.get("id")
    new_task = task.strip() if task else str(state.get("task") or "").strip()
    validate_string(new_task, "task")
    state.update(
        {
            "id": f"{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}-{slugify(new_task)}",
            "state": "UNDERSTANDING",
            "task": new_task,
            "delivery_target": target_kind,
            "reference_artifacts": [item.strip() for item in (references or []) if item.strip()],
            "baseline": snapshot(root),
            "change_model": None,
            "authorization": None,
            "quality": None,
            "verifier": None,
            "verifier_claim": None,
            "worker_claim": None,
            "verification_mode": "full",
            "defects": [],
            "observations": [],
            "budget": {
                "full_verifier_runs": 0,
                "targeted_verifier_runs": 0,
                "repair_cycles": 0,
                "human_extra_targeted": 0,
                "human_extra_repairs": 0,
                "manual_qa_batches": 0,
                "max_full_verifier_runs": VERIFIER_BUDGETS["low"]["full"],
                "max_targeted_verifier_runs": VERIFIER_BUDGETS["low"]["targeted"],
                "max_repair_cycles": VERIFIER_BUDGETS["low"]["repair_cycles"],
            },
            "handoff": None,
            "failure": None,
            "human_resume": None,
            "retargeted_from": {
                "id": old_id,
                "reason": reason.strip(),
                "at": utc_now(),
            },
        }
    )
    write_state(root, state)
    print(f"{state['id']}: UNDERSTANDING (retargeted to {target_kind})")

def command_fail(root: Path, reason: str) -> None:
    state = load_state(root)
    require_state(state, ACTIVE_STATES, "mark delivery failed")
    validate_string(reason, "reason")
    state["state"] = "FAILED"
    state["failure"] = {"reason": reason.strip(), "recorded_at": utc_now()}
    write_state(root, state)
    print(f"{state['id']}: FAILED ({reason.strip()})")


def status_payload(root: Path, *, full: bool = False) -> dict[str, Any]:
    """Return delivery status without feeding machine-owned history back into the LLM.

    Compact status is the default because baseline hashes, closed defect history and full
    verifier receipts can be very large and are not needed to resume ordinary work. Use
    ``status --full --json`` only for debugging the delivery runtime itself.
    """
    state = load_state(root)
    current = snapshot(root)
    changed = changed_paths(state.get("baseline", {}), current)
    current_fp = fingerprint(current)
    if full:
        return {
            **state,
            "current_fingerprint": current_fp,
            "changed_paths": changed,
        }

    defects = state.get("defects", [])
    open_defects = [item for item in defects if item.get("status") == "open"]
    non_blocking = [item for item in defects if item.get("status") == "non-blocking"]
    verified = [item for item in defects if item.get("status") == "verified-repaired"]
    quality = state.get("quality") or {}
    verifier = state.get("verifier") or {}
    model = state.get("change_model") or None
    budget = ensure_budget(state)
    return {
        "version": state.get("version"),
        "id": state.get("id"),
        "state": state.get("state"),
        "task": state.get("task"),
        "delivery_target": delivery_target(state),
        "reference_artifacts": state.get("reference_artifacts", []),
        "change_model": model,
        "target_consistent": (
            model is None or model.get("target") == delivery_target(state)
        ),
        "risk": (model or {}).get("risk"),
        "worker_claim": state.get("worker_claim"),
        "verification_mode": state.get("verification_mode"),
        "qa_repair_route": state.get("qa_repair_route"),
        "verification_route": verification_route(state) if state.get("state") == "VERIFYING" else None,
        "budget": {
            "full": [budget["full_verifier_runs"], budget["max_full_verifier_runs"]],
            "targeted": [budget["targeted_verifier_runs"], budget["max_targeted_verifier_runs"]],
            "repairs": [budget["repair_cycles"], budget["max_repair_cycles"]],
            "manual_qa_batches": [budget.get("manual_qa_batches", 0), MAX_MANUAL_QA_BATCHES],
        },
        "quality": {
            "passed": quality.get("passed"),
            "fingerprint": quality.get("fingerprint"),
        } if quality else None,
        "verifier": {
            "verdict": verifier.get("effective_verdict", verifier.get("verdict")),
            "mode": verifier.get("mode"),
            "fingerprint": verifier.get("fingerprint"),
        } if verifier else None,
        "current_fingerprint": current_fp,
        "changed_paths": changed,
        "defects": {
            "open": open_defects,
            "open_count": len(open_defects),
            "verified_repaired_count": len(verified),
            "non_blocking_count": len(non_blocking),
        },
        "handoff": state.get("handoff"),
        "failure": state.get("failure"),
        "human_resume": state.get("human_resume"),
    }


def command_status(root: Path, as_json: bool, full: bool = False) -> None:
    if as_json:
        state = status_payload(root, full=full)
        print(json.dumps(state, indent=2, sort_keys=True))
        return
    # Human-readable status is already compact, so keep the full in-memory shape
    # to avoid duplicating state-shape logic below.
    state = status_payload(root, full=True)
    print(f"{state['id']}: {state['state']}")
    print(f"Task: {state['task']}")
    print(f"Target: {delivery_target(state)}")
    model = state.get("change_model") or {}
    if model:
        print(f"Risk: {model.get('risk')}")
    budget = ensure_budget(state)
    print(
        "Budget: "
        f"full {budget['full_verifier_runs']}/{budget['max_full_verifier_runs']}, "
        f"targeted {budget['targeted_verifier_runs']}/{budget['max_targeted_verifier_runs']}, "
        f"repairs {budget['repair_cycles']}/{budget['max_repair_cycles']}"
    )
    if state.get("state") == "VERIFYING":
        print(
            f"Verification mode: {state.get('verification_mode')} "
            f"via {verification_route(state)}"
        )
    if state.get("qa_repair_route") and state.get("state") == "REPAIRING":
        print(f"QA repair route: {state.get('qa_repair_route')}")
    if state.get("worker_claim"):
        print(f"Worker: {state['worker_claim'].get('role')}")
    print(f"Changed paths: {len(state['changed_paths'])}")
    open_defects = [item for item in state.get("defects", []) if item.get("status") == "open"]
    print(f"Open defects: {len(open_defects)}")
    if state.get("handoff"):
        print(f"Next action: {state['handoff']['next_action']}")


def command_report(root: Path) -> None:
    state = status_payload(root, full=True)
    if state["state"] != "READY_FOR_MANUAL_QA":
        raise DeliveryError(f"Manual-QA package is unavailable while state is {state['state']}")
    model = state["change_model"]
    if not isinstance(model, dict):
        raise DeliveryError("READY state is invalid: missing Change Model")
    validate_change_model(model, delivery_target(state))
    target_error = validate_candidate_target(state, state.get("changed_paths", []))
    if target_error:
        raise DeliveryError(
            "READY state is invalid for the requested delivery target: " + target_error
            + " Retarget the stale delivery instead of accepting this report."
        )
    print("READY FOR MANUAL QA")
    print()
    print("Task")
    print(state["task"])
    print(f"Target: {delivery_target(state)}")
    refs = state.get("reference_artifacts", [])
    if refs:
        print("References: " + ", ".join(refs))
    print()
    print("Implemented")
    print(model["intent"])
    print()
    print("System impact")
    for item in model["affected"]:
        print(f"- {item}")
    for item in model["do_not_change"]:
        print(f"- Preserved: {item}")
    print()
    print("Verification")
    for item in state["quality"]["checks"]:
        print(f"- PASS: {item['command']}")
    print("- PASS: independent domain/system verification")
    print("- PASS: independent implementation verification")
    repaired = [
        item
        for item in state.get("defects", [])
        if item.get("source") == "verifier"
        and item.get("status") == "verified-repaired"
    ]
    if repaired:
        print()
        print("Verifier-found defects repaired")
        for item in repaired:
            print(f"- {item['actual']}")
    observations = state.get("observations", [])
    if observations:
        print()
        print("Non-blocking observations")
        for item in observations[-5:]:
            print(f"- {item.get('text')}")
    print()
    print("Residual risk")
    risks = state["verifier"].get("residual_risks", [])
    if risks:
        for item in risks:
            print(f"- {item}")
    else:
        print("- None identified.")
    print()
    print(f"Diff: {len(state['changed_paths'])} paths changed")
    print()
    print("Next")
    print("- Test the real application manually, especially overlays, clipping, scrolling and visual completeness.")
    print("- If defects exist: /qa-fix <up to three concrete defects>.")
    print("- If accepted: /qa-accept <short acceptance note>.")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-root")
    sub = parser.add_subparsers(dest="command", required=True)

    start = sub.add_parser("start")
    start.add_argument("--task", required=True)
    start.add_argument("--target", choices=sorted(DELIVERY_TARGETS), default="production")
    start.add_argument("--reference", action="append", default=[])

    model = sub.add_parser("model")
    model.add_argument("--file", required=True)

    authorize = sub.add_parser("authorize-high")
    authorize.add_argument("--reason", required=True)

    sub.add_parser("quality")

    worker = sub.add_parser("worker-claim")
    worker.add_argument("--role", required=True)
    worker.add_argument("--json", action="store_true")

    claim = sub.add_parser("verifier-claim")
    claim.add_argument("--json", action="store_true")

    verifier = sub.add_parser("verifier")
    verifier.add_argument("--report", required=True)
    verifier.add_argument("--verdict", choices=("pass", "fail"), required=True)

    handoff = sub.add_parser("handoff")
    handoff.add_argument("--file", required=True)

    checkpoint = sub.add_parser("checkpoint")
    checkpoint.add_argument("--reason", default="session boundary")

    qa_fix = sub.add_parser("qa-fix")
    qa_fix.add_argument("--file", required=True)

    qa_accept = sub.add_parser("qa-accept")
    qa_accept.add_argument("--reason", required=True)

    retarget = sub.add_parser("retarget")
    retarget.add_argument("--target", choices=sorted(DELIVERY_TARGETS), required=True)
    retarget.add_argument("--task")
    retarget.add_argument("--reference", action="append", default=[])
    retarget.add_argument("--reason", required=True)

    resume = sub.add_parser("resume-human")
    resume.add_argument("--reason", required=True)
    resume.add_argument("--extra-repairs", type=int, default=1)
    resume.add_argument("--extra-targeted", type=int, default=1)

    failed = sub.add_parser("fail")
    failed.add_argument("--reason", required=True)

    status = sub.add_parser("status")
    status.add_argument("--json", action="store_true")
    status.add_argument(
        "--full",
        action="store_true",
        help="include baseline hashes, full defect history and verifier receipts (runtime debugging only)",
    )

    sub.add_parser("report")
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    root = project_root(args.project_root)
    try:
        if args.command == "start":
            command_start(root, args.task, args.target, args.reference)
        elif args.command == "model":
            command_model(root, args.file)
        elif args.command == "authorize-high":
            command_authorize(root, args.reason)
        elif args.command == "quality":
            command_quality(root)
        elif args.command == "worker-claim":
            command_worker_claim(root, args.role, args.json)
        elif args.command == "verifier-claim":
            command_verifier_claim(root, args.json)
        elif args.command == "verifier":
            command_verifier(root, args.report, args.verdict)
        elif args.command == "handoff":
            command_handoff(root, args.file)
        elif args.command == "checkpoint":
            command_checkpoint(root, args.reason)
        elif args.command == "qa-fix":
            command_qa_fix(root, args.file)
        elif args.command == "qa-accept":
            command_qa_accept(root, args.reason)
        elif args.command == "retarget":
            command_retarget(root, args.target, args.task, args.reference, args.reason)
        elif args.command == "resume-human":
            command_resume_human(
                root,
                args.reason,
                args.extra_repairs,
                args.extra_targeted,
            )
        elif args.command == "fail":
            command_fail(root, args.reason)
        elif args.command == "status":
            command_status(root, args.json, args.full)
        elif args.command == "report":
            command_report(root)
    except DeliveryError as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(2) from exc


if __name__ == "__main__":
    main()
