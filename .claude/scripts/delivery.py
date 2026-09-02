#!/usr/bin/env python3
"""Machine-owned lifecycle and deterministic quality gate for /deliver."""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import os
import re
import shlex
import subprocess
import sys
import tempfile
import time
import statistics
import webbrowser
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


VERSION = 2
LEGACY_VERSION = 1
DELIVERY_TARGETS = {"production", "prototype"}
REFERENCE_PREFIXES = ("ui-ux/ux/", ".storybook/")
PRODUCTION_PREFIXES = ("src/", "server/", "migrations/", "public/")
PRODUCTION_FILES = {"index.html", "styles.css", "package.json", "tsconfig.json", "tsconfig.renderer.json"}
STATE_RELATIVE = Path(".claude/delivery/current.json")
METRICS_RELATIVE = Path("docs/agent/delivery-metrics.jsonl")
METRICS_DASHBOARD_RELATIVE = Path(".claude/metrics/dashboard.html")
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
MAX_MANUAL_QA_REOPENS = 1
MAX_HAIKU_QA_ATTEMPTS = 2
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


def decode_z(raw: bytes) -> list[str]:
    return [item.decode("utf-8") for item in raw.split(b"\0") if item]


def legacy_repository_paths(root: Path) -> list[str]:
    raw = run_git(root, "ls-files", "--cached", "--others", "--exclude-standard", "-z")
    return sorted(set(decode_z(raw)))


def legacy_full_snapshot(root: Path) -> dict[str, str]:
    result: dict[str, str] = {}
    for relative in legacy_repository_paths(root):
        path = root / relative
        if path.is_file() or path.is_symlink():
            result[relative] = hash_path(path)
    return result


def legacy_full_fingerprint(root: Path) -> str:
    encoded = json.dumps(
        legacy_full_snapshot(root), sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def git_head(root: Path) -> str:
    return run_git(root, "rev-parse", "HEAD").decode("utf-8", errors="replace").strip()


def tracked_paths_at(root: Path, revision: str = "HEAD") -> set[str]:
    return set(decode_z(run_git(root, "ls-tree", "-r", "--name-only", "-z", revision)))


def current_untracked_paths(root: Path) -> set[str]:
    return set(decode_z(run_git(root, "ls-files", "--others", "--exclude-standard", "-z")))


def tracked_diff_paths(root: Path, revision: str) -> set[str]:
    return set(
        decode_z(
            run_git(
                root,
                "diff",
                "--name-only",
                "--no-renames",
                "-z",
                revision,
                "--",
            )
        )
    )


def hash_path(path: Path) -> str:
    digest = hashlib.sha256()
    if path.is_symlink():
        digest.update(b"symlink\0")
        digest.update(os.readlink(path).encode("utf-8"))
        return digest.hexdigest()
    digest.update(path.read_bytes())
    return digest.hexdigest()


def path_state(root: Path, relative: str) -> dict[str, Any]:
    path = root / relative
    if not path.exists() and not path.is_symlink():
        return {"exists": False}
    if not (path.is_file() or path.is_symlink()):
        return {"exists": False}
    if path.is_symlink():
        kind = "symlink"
    else:
        kind = "executable" if os.access(path, os.X_OK) else "file"
    return {"exists": True, "kind": kind, "sha256": hash_path(path)}


def ignored_delivery_path(relative: str) -> bool:
    normalized = relative.replace("\\", "/")
    return (
        normalized.startswith(".claude/")
        or normalized == str(METRICS_RELATIVE).replace("\\", "/")
        or normalized.startswith("ui-ux/ux/baselines/images/")
        or normalized.startswith("ui-ux/ux/reviews/evidence/")
        or ("/" not in normalized and normalized.startswith(".claude") and normalized.endswith(".zip"))
        or ("/" not in normalized and normalized.startswith("adeo-claude-") and normalized.endswith(".zip"))
    )


def sparse_baseline(root: Path) -> dict[str, Any]:
    """Capture only information Git cannot reconstruct later.

    Clean tracked files are already represented by HEAD. We persist hashes only
    for paths that were dirty/untracked at delivery start so candidate changes
    can be measured relative to the user's pre-existing working tree.
    """
    head = git_head(root)
    tracked_dirty = tracked_diff_paths(root, head)
    untracked = current_untracked_paths(root)
    dirty: dict[str, Any] = {}
    for relative in sorted(tracked_dirty | untracked):
        if ignored_delivery_path(relative):
            continue
        dirty[relative] = {
            "origin": "untracked" if relative in untracked else "tracked",
            **path_state(root, relative),
        }
    return {"head": head, "dirty": dirty}


def baseline_is_sparse(value: Any) -> bool:
    return (
        isinstance(value, dict)
        and isinstance(value.get("head"), str)
        and isinstance(value.get("dirty"), dict)
    )


def hash_git_blob(root: Path, revision: str, relative: str) -> str | None:
    result = subprocess.run(
        ["git", "-C", str(root), "show", f"{revision}:{relative}"],
        check=False,
        capture_output=True,
    )
    if result.returncode != 0:
        return None
    return hashlib.sha256(result.stdout).hexdigest()


def migrate_legacy_baseline(root: Path, legacy: dict[str, Any]) -> dict[str, Any]:
    """Compact a v1 full-repository hash map using the current HEAD as anchor.

    Delivery workers are forbidden from committing, so active v1 deliveries are
    expected to still be on the same HEAD. The migration keeps exact v1 hashes
    only where the old working tree differed from HEAD; clean PNGs/assets/docs
    disappear from current.json entirely.
    """
    head = git_head(root)
    tracked = tracked_paths_at(root, head)
    dirty: dict[str, Any] = {}

    for relative, old_hash in legacy.items():
        if not isinstance(relative, str) or not isinstance(old_hash, str):
            continue
        if ignored_delivery_path(relative):
            continue
        if relative in tracked:
            head_hash = hash_git_blob(root, head, relative)
            if head_hash == old_hash:
                continue
            dirty[relative] = {
                "origin": "tracked",
                "exists": True,
                "sha256": old_hash,
            }
        else:
            dirty[relative] = {
                "origin": "untracked",
                "exists": True,
                "sha256": old_hash,
            }

    # A tracked file absent from the old full snapshot was deleted at baseline.
    for relative in sorted(tracked - set(legacy)):
        if ignored_delivery_path(relative):
            continue
        dirty[relative] = {"origin": "tracked", "exists": False}

    return {"head": head, "dirty": dirty, "migrated_from": "v1-full-snapshot"}


def baseline_state_for_path(baseline: dict[str, Any], relative: str) -> dict[str, Any] | None:
    dirty = baseline.get("dirty") or {}
    item = dirty.get(relative)
    if not isinstance(item, dict):
        return None
    return {key: item[key] for key in ("exists", "kind", "sha256") if key in item}


def path_state_matches(expected: dict[str, Any], actual: dict[str, Any]) -> bool:
    return all(actual.get(key) == value for key, value in expected.items())


def candidate_changed_paths(root: Path, baseline: dict[str, Any]) -> list[str]:
    if not baseline_is_sparse(baseline):
        raise DeliveryError("Delivery baseline is not sparse; reload state to migrate it")
    head = str(baseline["head"])
    dirty = baseline.get("dirty") or {}
    current_diff = tracked_diff_paths(root, head)
    current_untracked = current_untracked_paths(root)
    candidates = current_diff | current_untracked | set(dirty)
    changed: list[str] = []
    for relative in sorted(candidates):
        if ignored_delivery_path(relative):
            continue
        baseline_state = baseline_state_for_path(baseline, relative)
        current_state = path_state(root, relative)
        if baseline_state is not None:
            if not path_state_matches(baseline_state, current_state):
                changed.append(relative)
            continue
        # A path that was clean at start is changed iff Git/untracked discovery
        # says it now differs from HEAD.
        if relative in current_diff or relative in current_untracked:
            changed.append(relative)
    return changed


def candidate_snapshot(root: Path, baseline: dict[str, Any]) -> dict[str, Any]:
    return {
        relative: path_state(root, relative)
        for relative in candidate_changed_paths(root, baseline)
    }


def fingerprint_candidate(root: Path, baseline: dict[str, Any]) -> str:
    payload = {
        "head": baseline.get("head"),
        "paths": candidate_snapshot(root, baseline),
    }
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()

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


def read_json_stdin() -> dict[str, Any]:
    try:
        value = json.load(sys.stdin)
    except json.JSONDecodeError as exc:
        raise DeliveryError(f"Cannot read Change Model JSON from stdin: {exc}") from exc
    if not isinstance(value, dict):
        raise DeliveryError("Expected a JSON object on stdin")
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


def ensure_metrics(state: dict[str, Any]) -> dict[str, Any]:
    metrics = state.get("metrics")
    if not isinstance(metrics, dict):
        metrics = {}
        state["metrics"] = metrics
    defaults = {
        "sonnet_implementation_passes": 0,
        "sonnet_full_verifier_passes": 0,
        "sonnet_reopen_passes": 0,
        "sonnet_qa_escalation_passes": 0,
        "haiku_agent_passes": 0,
        "haiku_qa_attempts": 0,
        "qa_escalations_to_sonnet": 0,
        "qa_batches": 0,
        "reopens": 0,
    }
    for key, value in defaults.items():
        metrics.setdefault(key, value)
    metrics.setdefault("partial", bool(state.get("baseline_migration")))
    return metrics


def metric_increment(state: dict[str, Any], key: str, amount: int = 1) -> None:
    metrics = ensure_metrics(state)
    metrics[key] = int(metrics.get(key, 0)) + amount


def metrics_path(root: Path) -> Path:
    return root / METRICS_RELATIVE


def accepted_metric_record(state: dict[str, Any], reason: str, accepted_at: str) -> dict[str, Any]:
    metrics = ensure_metrics(state)
    risk = str((state.get("change_model") or {}).get("risk") or "unknown")
    expensive = (
        int(metrics.get("sonnet_implementation_passes", 0))
        + int(metrics.get("sonnet_full_verifier_passes", 0))
        + int(metrics.get("sonnet_reopen_passes", 0))
        + int(metrics.get("sonnet_qa_escalation_passes", 0))
    )
    return {
        "delivery_id": state.get("id"),
        "task": state.get("task"),
        "delivery_target": delivery_target(state),
        "risk": risk,
        "started_at": state.get("created_at"),
        "accepted_at": accepted_at,
        "outcome": "accepted",
        "sonnet_implementation_passes": int(metrics.get("sonnet_implementation_passes", 0)),
        "sonnet_full_verifier_passes": int(metrics.get("sonnet_full_verifier_passes", 0)),
        "sonnet_reopen_passes": int(metrics.get("sonnet_reopen_passes", 0)),
        "sonnet_qa_escalation_passes": int(metrics.get("sonnet_qa_escalation_passes", 0)),
        "haiku_agent_passes": int(metrics.get("haiku_agent_passes", 0)),
        "haiku_qa_attempts": int(metrics.get("haiku_qa_attempts", 0)),
        "qa_escalations_to_sonnet": int(metrics.get("qa_escalations_to_sonnet", 0)),
        "qa_batches": int(metrics.get("qa_batches", 0)),
        "reopens": int(metrics.get("reopens", 0)),
        "expensive_reasoning_passes": expensive,
        "manual_acceptance": True,
        "metrics_partial": bool(metrics.get("partial", False)),
        "acceptance_note": reason.strip(),
    }


def append_metric_record(root: Path, record: dict[str, Any]) -> bool:
    """Append one immutable JSONL record; repeated acceptance stays idempotent."""
    target = metrics_path(root)
    target.parent.mkdir(parents=True, exist_ok=True)
    delivery_id = str(record.get("delivery_id") or "")
    if target.is_file() and delivery_id:
        try:
            for line in target.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if not line:
                    continue
                try:
                    existing = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if isinstance(existing, dict) and str(existing.get("delivery_id") or "") == delivery_id:
                    return False
        except OSError as exc:
            raise DeliveryError(f"Cannot read delivery metrics ledger {target}: {exc}") from exc
    try:
        with target.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(record, sort_keys=True, separators=(",", ":")) + "\n")
    except OSError as exc:
        raise DeliveryError(f"Cannot append delivery metrics ledger {target}: {exc}") from exc
    return True


def load_metric_records(root: Path) -> tuple[list[dict[str, Any]], int]:
    # Read the append-only metrics ledger without mutating it.
    target = metrics_path(root)
    if not target.is_file():
        return [], 0
    records: list[dict[str, Any]] = []
    malformed = 0
    try:
        lines = target.read_text(encoding="utf-8").splitlines()
    except OSError as exc:
        raise DeliveryError(f"Cannot read delivery metrics ledger {target}: {exc}") from exc
    for line in lines:
        text = line.strip()
        if not text:
            continue
        try:
            item = json.loads(text)
        except json.JSONDecodeError:
            malformed += 1
            continue
        if not isinstance(item, dict):
            malformed += 1
            continue
        records.append(item)
    return records, malformed


def metric_int(record: dict[str, Any], key: str) -> int:
    try:
        return int(record.get(key, 0) or 0)
    except (TypeError, ValueError):
        return 0


def metric_float_mean(values: list[int]) -> float:
    return round(float(statistics.mean(values)), 2) if values else 0.0


def metric_dashboard_payload(root: Path) -> dict[str, Any]:
    records, malformed = load_metric_records(root)
    accepted = [
        item for item in records
        if item.get("outcome") == "accepted" and bool(item.get("manual_acceptance", False))
    ]
    complete = [item for item in accepted if not bool(item.get("metrics_partial", False))]
    basis = complete if complete else accepted
    expensive = [metric_int(item, "expensive_reasoning_passes") for item in basis]
    qa_batches = [metric_int(item, "qa_batches") for item in basis]
    escalated = [item for item in basis if metric_int(item, "qa_escalations_to_sonnet") > 0]
    reopened = [item for item in basis if metric_int(item, "reopens") > 0]

    distribution = {"0": 0, "1": 0, "2": 0, "3": 0, "4+": 0}
    for value in expensive:
        key = str(value) if value <= 3 else "4+"
        distribution[key] += 1

    attention: list[dict[str, Any]] = []
    for item in accepted:
        reasons: list[str] = []
        exp = metric_int(item, "expensive_reasoning_passes")
        haiku_qa = metric_int(item, "haiku_qa_attempts")
        escalations = metric_int(item, "qa_escalations_to_sonnet")
        reopens = metric_int(item, "reopens")
        if exp >= 3:
            reasons.append(f"{exp} expensive reasoning passes")
        if haiku_qa >= 2:
            reasons.append(f"{haiku_qa} Haiku QA attempts")
        if escalations:
            reasons.append(f"{escalations} QA escalation(s) to Sonnet")
        if reopens:
            reasons.append(f"{reopens} reopen(s)")
        if bool(item.get("metrics_partial", False)):
            reasons.append("partial pre-metrics history")
        if reasons:
            attention.append({
                "delivery_id": item.get("delivery_id"),
                "task": item.get("task") or item.get("delivery_id") or "unknown delivery",
                "reasons": reasons,
                "accepted_at": item.get("accepted_at"),
            })

    return {
        "ledger": str(METRICS_RELATIVE),
        "records_total": len(records),
        "accepted_total": len(accepted),
        "complete_total": len(complete),
        "partial_total": len(accepted) - len(complete),
        "malformed_lines": malformed,
        "averages_basis": "complete" if complete else ("all accepted" if accepted else "none"),
        "avg_expensive_reasoning_passes": metric_float_mean(expensive),
        "median_expensive_reasoning_passes": round(float(statistics.median(expensive)), 2) if expensive else 0.0,
        "avg_qa_batches": metric_float_mean(qa_batches),
        "qa_escalation_rate_pct": round((len(escalated) / len(basis) * 100.0), 1) if basis else 0.0,
        "reopen_rate_pct": round((len(reopened) / len(basis) * 100.0), 1) if basis else 0.0,
        "distribution": distribution,
        "accepted": accepted,
        "attention": attention,
    }


def truncate_metric_text(value: Any, width: int) -> str:
    text = " ".join(str(value or "").split())
    if len(text) <= width:
        return text
    return text[: max(1, width - 1)] + "…"


def command_metrics_terminal(root: Path, limit: int) -> None:
    payload = metric_dashboard_payload(root)
    accepted = payload["accepted"]
    if not accepted:
        print("DELIVERY METRICS")
        print(f"No accepted delivery records yet. Ledger: {METRICS_RELATIVE}")
        if payload["malformed_lines"]:
            print(f"Warning: {payload['malformed_lines']} malformed ledger line(s) ignored.")
        return

    print("DELIVERY METRICS")
    print(
        f"Accepted {payload['accepted_total']} | complete {payload['complete_total']} | "
        f"partial {payload['partial_total']} | averages use {payload['averages_basis']} records"
    )
    print(
        f"Avg expensive {payload['avg_expensive_reasoning_passes']:.2f} | "
        f"median {payload['median_expensive_reasoning_passes']:.2f} | "
        f"avg QA batches {payload['avg_qa_batches']:.2f} | "
        f"Sonnet escalation {payload['qa_escalation_rate_pct']:.1f}% | "
        f"reopen {payload['reopen_rate_pct']:.1f}%"
    )
    if payload["malformed_lines"]:
        print(f"Warning: {payload['malformed_lines']} malformed ledger line(s) ignored.")

    print("\nExpensive reasoning passes")
    distribution = payload["distribution"]
    max_count = max(distribution.values()) if distribution else 0
    for key in ("0", "1", "2", "3", "4+"):
        count = distribution[key]
        bar_len = round((count / max_count) * 20) if max_count else 0
        print(f"  {key:>2} {'█' * bar_len:<20} {count}")

    print("\nRecent accepted deliveries")
    print(f"{'Feature':44} {'Risk':7} {'Exp':>3} {'HQA':>3} {'QA':>2} {'Esc':>3} {'Re':>2} Flag")
    print("-" * 82)
    recent = accepted[-limit:]
    for item in reversed(recent):
        exp = metric_int(item, "expensive_reasoning_passes")
        hqa = metric_int(item, "haiku_qa_attempts")
        qa = metric_int(item, "qa_batches")
        esc = metric_int(item, "qa_escalations_to_sonnet")
        reopens = metric_int(item, "reopens")
        flag = "RED" if exp >= 3 or esc else ("WARN" if hqa >= 2 or reopens else "OK")
        if bool(item.get("metrics_partial", False)):
            flag = "PARTIAL"
        print(
            f"{truncate_metric_text(item.get('task') or item.get('delivery_id'), 44):44} "
            f"{truncate_metric_text(item.get('risk') or 'unknown', 7):7} "
            f"{exp:>3} {hqa:>3} {qa:>2} {esc:>3} {reopens:>2} {flag}"
        )

    if payload["attention"]:
        print("\nAttention")
        for item in payload["attention"][-limit:]:
            reasons = "; ".join(item["reasons"])
            print(f"- {truncate_metric_text(item['task'], 70)}: {reasons}")


def metric_trend_svg(records: list[dict[str, Any]]) -> str:
    points_source = records[-30:]
    if not points_source:
        return '<div class="empty">No accepted deliveries yet.</div>'
    values = [metric_int(item, "expensive_reasoning_passes") for item in points_source]
    width, height = 760, 190
    left, right, top, bottom = 35, 15, 20, 35
    plot_w = width - left - right
    plot_h = height - top - bottom
    ceiling = max(4, max(values) if values else 0)
    if len(values) == 1:
        xs = [left + plot_w / 2]
    else:
        xs = [left + (idx * plot_w / (len(values) - 1)) for idx in range(len(values))]
    ys = [top + plot_h - (value / ceiling * plot_h) for value in values]
    polyline = " ".join(f"{x:.1f},{y:.1f}" for x, y in zip(xs, ys))
    circles = "".join(
        f'<circle cx="{x:.1f}" cy="{y:.1f}" r="3"><title>{html.escape(str(points_source[idx].get("task") or "delivery"))}: {values[idx]}</title></circle>'
        for idx, (x, y) in enumerate(zip(xs, ys))
    )
    grid = "".join(
        f'<line x1="{left}" y1="{top + plot_h - (level / ceiling * plot_h):.1f}" x2="{width-right}" y2="{top + plot_h - (level / ceiling * plot_h):.1f}" class="grid" />'
        f'<text x="{left-8}" y="{top + plot_h - (level / ceiling * plot_h) + 4:.1f}" text-anchor="end">{level}</text>'
        for level in range(0, ceiling + 1)
    )
    return (
        f'<svg viewBox="0 0 {width} {height}" role="img" aria-label="Expensive reasoning passes per accepted delivery">'
        f'{grid}<polyline points="{polyline}" class="trend" />{circles}'
        f'<text x="{width/2:.0f}" y="{height-5}" text-anchor="middle">last {len(values)} accepted deliveries →</text>'
        '</svg>'
    )


def render_metrics_html(payload: dict[str, Any]) -> str:
    accepted = payload["accepted"]
    distribution = payload["distribution"]
    max_dist = max(distribution.values()) if distribution else 0
    bars = []
    for key in ("0", "1", "2", "3", "4+"):
        count = distribution[key]
        pct = (count / max_dist * 100.0) if max_dist else 0.0
        bars.append(
            f'<div class="bar-row"><span>{key}</span><div class="bar-track"><div class="bar" style="width:{pct:.1f}%"></div></div><strong>{count}</strong></div>'
        )

    rows = []
    for item in reversed(accepted[-50:]):
        exp = metric_int(item, "expensive_reasoning_passes")
        hqa = metric_int(item, "haiku_qa_attempts")
        esc = metric_int(item, "qa_escalations_to_sonnet")
        reopens = metric_int(item, "reopens")
        klass = "bad" if exp >= 3 or esc else ("warn" if hqa >= 2 or reopens else "good")
        if bool(item.get("metrics_partial", False)):
            klass = "partial"
        rows.append(
            "<tr>"
            f'<td><div class="task">{html.escape(str(item.get("task") or item.get("delivery_id") or ""))}</div>'
            f'<div class="muted">{html.escape(str(item.get("accepted_at") or ""))}</div></td>'
            f'<td>{html.escape(str(item.get("risk") or "unknown"))}</td>'
            f'<td class="num {klass}">{exp}</td>'
            f'<td class="num">{hqa}</td>'
            f'<td class="num">{metric_int(item, "qa_batches")}</td>'
            f'<td class="num">{esc}</td>'
            f'<td class="num">{reopens}</td>'
            f'<td><span class="pill {klass}">{klass}</span></td>'
            "</tr>"
        )

    attention = []
    for item in reversed(payload["attention"][-20:]):
        attention.append(
            '<div class="attention-item">'
            f'<strong>{html.escape(str(item["task"]))}</strong>'
            f'<div>{html.escape(" · ".join(item["reasons"]))}</div>'
            '</div>'
        )
    if not attention:
        attention.append('<div class="empty">No deliveries currently cross the attention thresholds.</div>')

    generated = utc_now()
    malformed_note = (
        f'<div class="warning">{payload["malformed_lines"]} malformed JSONL line(s) were ignored.</div>'
        if payload["malformed_lines"] else ""
    )
    return f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Adeo Delivery Metrics</title>
<style>
:root {{ color-scheme: light dark; --bg:#0f1115; --panel:#171a21; --text:#e8eaf0; --muted:#9aa3b2; --line:#2a3040; --good:#62d394; --warn:#f4c95d; --bad:#ff6b6b; --accent:#7aa2f7; }}
@media (prefers-color-scheme: light) {{ :root {{ --bg:#f5f7fb; --panel:#fff; --text:#1b2130; --muted:#667085; --line:#e4e7ec; --good:#16834a; --warn:#a36a00; --bad:#c93434; --accent:#356fe0; }} }}
* {{ box-sizing:border-box; }} body {{ margin:0; font:14px/1.45 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; background:var(--bg); color:var(--text); }}
main {{ max-width:1180px; margin:0 auto; padding:32px 22px 60px; }} h1 {{ margin:0 0 4px; font-size:28px; }} h2 {{ margin:0 0 16px; font-size:18px; }} .muted {{ color:var(--muted); font-size:12px; }}
.grid-cards {{ display:grid; grid-template-columns:repeat(auto-fit,minmax(170px,1fr)); gap:12px; margin:24px 0; }} .card,.panel {{ background:var(--panel); border:1px solid var(--line); border-radius:12px; }} .card {{ padding:16px; }} .value {{ font-size:27px; font-weight:700; margin-top:5px; }}
.layout {{ display:grid; grid-template-columns:minmax(0,2fr) minmax(260px,1fr); gap:16px; margin-bottom:16px; }} .panel {{ padding:18px; overflow:hidden; }} @media(max-width:800px) {{ .layout {{ grid-template-columns:1fr; }} }}
svg {{ width:100%; min-height:180px; }} svg text {{ fill:var(--muted); font-size:11px; }} .grid {{ stroke:var(--line); stroke-width:1; }} .trend {{ fill:none; stroke:var(--accent); stroke-width:3; stroke-linejoin:round; stroke-linecap:round; }} circle {{ fill:var(--accent); }}
.bar-row {{ display:grid; grid-template-columns:28px 1fr 30px; gap:9px; align-items:center; margin:10px 0; }} .bar-track {{ height:10px; background:var(--line); border-radius:999px; overflow:hidden; }} .bar {{ height:100%; background:var(--accent); border-radius:999px; }}
table {{ width:100%; border-collapse:collapse; min-width:760px; }} th,td {{ border-bottom:1px solid var(--line); text-align:left; padding:10px 8px; vertical-align:top; }} th {{ color:var(--muted); font-size:12px; font-weight:600; }} .table-wrap {{ overflow:auto; }} .task {{ max-width:520px; }} .num {{ text-align:right; font-variant-numeric:tabular-nums; }} .num.good {{ color:var(--good); }} .num.warn {{ color:var(--warn); }} .num.bad {{ color:var(--bad); font-weight:700; }}
.pill {{ display:inline-block; padding:2px 7px; border:1px solid currentColor; border-radius:999px; font-size:11px; }} .pill.good {{ color:var(--good); }} .pill.warn {{ color:var(--warn); }} .pill.bad {{ color:var(--bad); }} .pill.partial {{ color:var(--muted); }}
.attention-item {{ padding:11px 0; border-bottom:1px solid var(--line); }} .attention-item:last-child {{ border-bottom:0; }} .attention-item div {{ color:var(--muted); margin-top:3px; }} .empty {{ color:var(--muted); }} .warning {{ border:1px solid var(--warn); color:var(--warn); padding:10px 12px; border-radius:8px; margin:12px 0; }}
footer {{ color:var(--muted); margin-top:18px; font-size:12px; }}
</style>
</head>
<body><main>
<h1>Adeo delivery metrics</h1>
<div class="muted">Append-only source: {html.escape(str(payload["ledger"]))} · generated {html.escape(generated)}</div>
{malformed_note}
<div class="grid-cards">
  <div class="card"><div class="muted">Accepted features</div><div class="value">{payload["accepted_total"]}</div><div class="muted">{payload["complete_total"]} complete · {payload["partial_total"]} partial</div></div>
  <div class="card"><div class="muted">Avg expensive passes</div><div class="value">{payload["avg_expensive_reasoning_passes"]:.2f}</div><div class="muted">median {payload["median_expensive_reasoning_passes"]:.2f}</div></div>
  <div class="card"><div class="muted">Sonnet escalation rate</div><div class="value">{payload["qa_escalation_rate_pct"]:.1f}%</div><div class="muted">QA repair escalation</div></div>
  <div class="card"><div class="muted">Reopen rate</div><div class="value">{payload["reopen_rate_pct"]:.1f}%</div><div class="muted">human-reopened bugs</div></div>
  <div class="card"><div class="muted">Avg QA batches</div><div class="value">{payload["avg_qa_batches"]:.2f}</div><div class="muted">averages use {html.escape(str(payload["averages_basis"]))}</div></div>
</div>
<div class="layout">
  <section class="panel"><h2>Expensive reasoning passes / feature</h2>{metric_trend_svg(accepted)}</section>
  <section class="panel"><h2>Distribution</h2>{''.join(bars)}</section>
</div>
<section class="panel" style="margin-bottom:16px"><h2>Recent deliveries</h2><div class="table-wrap"><table>
<thead><tr><th>Feature</th><th>Risk</th><th class="num">Exp</th><th class="num">Haiku QA</th><th class="num">QA</th><th class="num">Esc</th><th class="num">Reopen</th><th>Signal</th></tr></thead>
<tbody>{''.join(rows) if rows else '<tr><td colspan="8" class="empty">No accepted deliveries yet.</td></tr>'}</tbody></table></div></section>
<section class="panel"><h2>Attention</h2>{''.join(attention)}</section>
<footer>Thresholds: RED = ≥3 expensive passes or Sonnet QA escalation; WARN = ≥2 Haiku QA attempts or reopen. Partial records are retained but excluded from averages while complete records exist.</footer>
</main></body></html>'''


def command_metrics(root: Path, *, as_json: bool, html_view: bool, open_view: bool, limit: int) -> None:
    if limit < 1 or limit > 100:
        raise DeliveryError("metrics --limit must be between 1 and 100")
    payload = metric_dashboard_payload(root)
    if as_json:
        compact = {key: value for key, value in payload.items() if key != "accepted"}
        compact["recent"] = payload["accepted"][-limit:]
        print(json.dumps(compact, indent=2, sort_keys=True))
        return
    if html_view or open_view:
        target = root / METRICS_DASHBOARD_RELATIVE
        target.parent.mkdir(parents=True, exist_ok=True)
        try:
            target.write_text(render_metrics_html(payload), encoding="utf-8")
        except OSError as exc:
            raise DeliveryError(f"Cannot write metrics dashboard {target}: {exc}") from exc
        print(f"Metrics dashboard: {target}")
        if open_view:
            try:
                opened = webbrowser.open(target.resolve().as_uri(), new=2)
            except Exception as exc:
                raise DeliveryError(f"Dashboard generated but browser open failed: {exc}") from exc
            if not opened:
                print("Browser did not confirm opening; open the printed dashboard path manually.", file=sys.stderr)
        return
    command_metrics_terminal(root, limit)


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


def current_snapshot(root: Path, baseline: dict[str, Any]) -> tuple[dict[str, Any], str]:
    files = candidate_snapshot(root, baseline)
    return files, fingerprint_candidate(root, baseline)


def load_state(root: Path, *, refresh_ready: bool = True) -> dict[str, Any]:
    target = state_path(root)
    if not target.is_file():
        raise DeliveryError("No active delivery. Start one with /deliver <task>.")
    state = read_json(target)
    version = state.get("version")
    migrated = False
    if version == LEGACY_VERSION:
        legacy = state.get("baseline")
        if not isinstance(legacy, dict):
            raise DeliveryError("Legacy delivery baseline has invalid shape")
        legacy_current = legacy_full_fingerprint(root)
        state["baseline"] = migrate_legacy_baseline(root, legacy)
        state["version"] = VERSION
        new_current = fingerprint_candidate(root, state["baseline"])
        for receipt_key in ("quality", "verifier", "verifier_claim"):
            receipt = state.get(receipt_key)
            if isinstance(receipt, dict) and receipt.get("fingerprint") == legacy_current:
                receipt["fingerprint"] = new_current
                if receipt_key == "quality":
                    receipt["changed_paths"] = candidate_changed_paths(root, state["baseline"])
        state["baseline_migration"] = {
            "from_version": LEGACY_VERSION,
            "at": utc_now(),
            "receipt_rebased": any(
                isinstance(state.get(key), dict)
                and state[key].get("fingerprint") == new_current
                for key in ("quality", "verifier", "verifier_claim")
            ),
        }
        migrated = True
    elif version != VERSION:
        raise DeliveryError("Unsupported delivery state version")
    if not baseline_is_sparse(state.get("baseline")):
        raise DeliveryError("Delivery baseline has invalid sparse shape")
    ensure_budget(state)
    ensure_metrics(state)
    # v1 compatibility: old runtimes called this product review even though UI
    # still required human acceptance. Treat it as manual-QA readiness.
    if state.get("state") == "READY_FOR_PRODUCT_REVIEW":
        state["state"] = "READY_FOR_MANUAL_QA"
        migrated = True
    if migrated:
        write_state(root, state)
    if refresh_ready and state.get("state") == "READY_FOR_MANUAL_QA":
        _, current = current_snapshot(root, state["baseline"])
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


def new_delivery_state(
    root: Path, task: str, target_kind: str, references: list[str] | None = None
) -> dict[str, Any]:
    """Build a new delivery state without splitting start/claim protocol across LLM turns."""
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
    baseline = sparse_baseline(root)
    return {
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


def command_start(root: Path, task: str, target_kind: str, references: list[str] | None = None) -> None:
    """Low-level backwards-compatible start. New controllers should use `begin`."""
    state = new_delivery_state(root, task, target_kind, references)
    write_state(root, state)
    print(f"{state['id']}: UNDERSTANDING")


def command_begin(
    root: Path,
    task: str,
    target_kind: str,
    references: list[str] | None = None,
    as_json: bool = False,
) -> None:
    """Atomically create a delivery and its single initial execution-worker claim."""
    state = new_delivery_state(root, task, target_kind, references)
    role = "implementer" if target_kind == "production" else "product-designer"
    claim = {
        "id": f"W-{role}-{int(time.time())}",
        "role": role,
        "phase": "UNDERSTANDING",
        "claimed_at": utc_now(),
    }
    state["worker_claim"] = claim
    write_state(root, state)
    payload = {
        "delivery_id": state["id"],
        "state": state["state"],
        "delivery_target": target_kind,
        "worker_claim": claim,
        "next": {"action": "invoke-worker", "agent": role},
    }
    if as_json:
        print(json.dumps(payload, indent=2, sort_keys=True))
    else:
        print(f"{state['id']}: UNDERSTANDING; worker={role}")


def command_model(root: Path, model_file: str | None, from_stdin: bool) -> None:
    state = load_state(root)
    require_state(state, {"UNDERSTANDING", "BLOCKED_DECISION"}, "record a Change Model")
    if from_stdin:
        model = read_json_stdin()
    elif model_file:
        model = read_json(Path(model_file).resolve())
    else:
        raise DeliveryError("Record the Change Model with exactly one of --stdin or --file")
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


def command_model_template(root: Path) -> None:
    state = load_state(root)
    require_state(state, {"UNDERSTANDING", "BLOCKED_DECISION"}, "inspect the Change Model contract")
    template = {
        "target": delivery_target(state),
        "intent": str(state.get("task") or ""),
        "current_system": "",
        "domain": "",
        "flow": [],
        "invariants": [],
        "implementation_location": [],
        "affected": [],
        "do_not_change": [],
        "unknowns": [],
        "risk": "low",
        "evidence": [],
        "feature_checks": [],
        "decision_required": False,
    }
    print(json.dumps(template, indent=2, ensure_ascii=False))


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
    if worker_claim.get("role") == "implementer":
        if previous_state == "REPAIRING" and state.get("qa_repair_route") == "qa-repairer":
            metric_increment(state, "haiku_agent_passes")
        elif previous_state == "REPAIRING" and state.get("qa_repair_route") == "qa-repairer-sonnet":
            if state.get("qa_escalation"):
                metric_increment(state, "sonnet_qa_escalation_passes")
            else:
                metric_increment(state, "sonnet_reopen_passes")
        else:
            metric_increment(state, "sonnet_implementation_passes")

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
    before_checks = candidate_snapshot(root, state["baseline"])
    paths = candidate_changed_paths(root, state["baseline"])
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

    after_checks, candidate = current_snapshot(root, state["baseline"])
    before_fingerprint = hashlib.sha256(json.dumps({"head": state["baseline"].get("head"), "paths": before_checks}, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()
    if failure is None and before_fingerprint != candidate:
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
        "changed_paths": candidate_changed_paths(root, state["baseline"]),
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
    _, current = current_snapshot(root, state["baseline"])
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
    _, current = current_snapshot(root, state["baseline"])
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
    route = str(claim.get("route") or verification_route(state))
    if mode == "full" and route == "verifier":
        metric_increment(state, "sonnet_full_verifier_passes")
    else:
        metric_increment(state, "haiku_agent_passes")
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
    baseline = sparse_baseline(root)
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


def normalized_manual_bug_identity(item: dict[str, Any]) -> str:
    """Return a stable identity for manual-QA records that predate explicit bug IDs.

    Explicit ids remain authoritative. Legacy/inline findings get a deterministic AUTO id
    from the human-visible problem statement plus reproduction steps, so the same report
    can be recognized as a reopen without hand-editing machine state.
    """
    explicit = item.get("manual_bug_id")
    if explicit is not None and str(explicit).strip():
        return str(explicit).strip()
    actual = " ".join(str(item.get("actual") or "").split()).casefold()
    reproduction = [" ".join(str(value).split()).casefold() for value in item.get("reproduction", [])]
    material = json.dumps({"actual": actual, "reproduction": reproduction}, sort_keys=True, ensure_ascii=False)
    return "AUTO-" + hashlib.sha256(material.encode("utf-8")).hexdigest()[:12]


def ensure_manual_bug_ids(state: dict[str, Any]) -> None:
    """Backfill stable ids onto legacy manual-QA history deterministically."""
    for item in state.get("defects", []):
        if item.get("source") == "manual-qa" and not str(item.get("manual_bug_id") or "").strip():
            item["manual_bug_id"] = normalized_manual_bug_identity(item)
            item["manual_bug_id_generated"] = True


def manual_bug_history(state: dict[str, Any], manual_bug_id: str) -> list[dict[str, Any]]:
    ensure_manual_bug_ids(state)
    return [
        item
        for item in state.get("defects", [])
        if item.get("source") == "manual-qa"
        and str(item.get("manual_bug_id") or "") == manual_bug_id
    ]


def compact_manual_qa_history(state: dict[str, Any]) -> list[dict[str, Any]]:
    ensure_manual_bug_ids(state)
    result: list[dict[str, Any]] = []
    for item in state.get("defects", []):
        if item.get("source") != "manual-qa":
            continue
        result.append({
            "defect_id": item.get("id"),
            "manual_bug_id": item.get("manual_bug_id"),
            "generated_id": bool(item.get("manual_bug_id_generated")),
            "status": item.get("status"),
            "actual": item.get("actual"),
            "reopen_count": int(item.get("reopen_count", 0)),
            "repair_route": item.get("repair_route"),
            "created_at": item.get("created_at"),
        })
    return result


def command_qa_history(root: Path, as_json: bool) -> None:
    state = load_state(root)
    rows = compact_manual_qa_history(state)
    if as_json:
        print(json.dumps({"delivery_id": state.get("id"), "state": state.get("state"), "defects": rows}, indent=2, sort_keys=True))
        return
    if not rows:
        print("No manual-QA defect history.")
        return
    for item in rows:
        print(
            f"{item['defect_id']} manual={item['manual_bug_id']} status={item['status']} "
            f"reopens={item['reopen_count']} :: {item['actual']}"
        )


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
        manual_bug_id = normalized_manual_bug_identity(item)
        item["manual_bug_id"] = manual_bug_id
        reopen_count = 0
        if manual_bug_id:
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
    # Human-triggered QA batches are not an autonomy budget: every /qa-fix invocation is
    # already an explicit human authorization to process another batch. Bound work inside
    # the batch (max defects, Haiku attempts, reopen count), never the number of human QA passes.

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
        defect["manual_bug_id"] = str(item.get("manual_bug_id"))
        if str(item.get("manual_bug_id", "")).startswith("AUTO-"):
            defect["manual_bug_id_generated"] = True
        if item.get("manual_status"):
            defect["manual_status"] = str(item.get("manual_status"))

    metric_increment(state, "qa_batches")
    reopened_count = sum(1 for _, reopen_count in classifications if reopen_count >= 1)
    if reopened_count:
        metric_increment(state, "reopens", reopened_count)

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
    state["qa_attempts_current_batch"] = 0
    state["qa_attempt"] = None
    state["qa_escalation"] = None
    write_state(root, state)
    kind = "reopen" if max_reopen >= 1 else "new"
    print(
        f"{state['id']}: REPAIRING ({len(defects)} manual-QA defects, {kind}, route={repair_route})"
    )


def command_qa_attempt(root: Path) -> None:
    """Authorize one bounded Haiku manual-QA repair attempt.

    The orchestrator calls this immediately before each fresh/resumed qa-repairer
    invocation. It is deliberately machine-counted so repeated cheap-model loops
    cannot hide behind one QA batch.
    """
    state = load_state(root)
    require_state(state, {"REPAIRING"}, "start a Haiku manual-QA repair attempt")
    if state.get("qa_repair_route") != "qa-repairer":
        raise DeliveryError(
            "Haiku QA attempts are allowed only while qa_repair_route=qa-repairer; "
            "obey the current route instead."
        )
    attempts = int(state.get("qa_attempts_current_batch", 0))
    if attempts >= MAX_HAIKU_QA_ATTEMPTS:
        state["state"] = "NEEDS_HUMAN_REVIEW"
        state["worker_claim"] = None
        add_observation(
            state,
            f"Haiku manual-QA repair failed to converge after {attempts} attempts; "
            "human may use /qa-escalate to authorize Sonnet medium.",
            severity="blocking",
        )
        write_state(root, state)
        raise DeliveryError(
            f"Haiku manual-QA repair attempt budget exhausted ({attempts}/{MAX_HAIKU_QA_ATTEMPTS}). "
            "Delivery moved to NEEDS_HUMAN_REVIEW; use /qa-escalate <reason> for explicit Sonnet escalation."
        )
    attempts += 1
    state["qa_attempts_current_batch"] = attempts
    metric_increment(state, "haiku_qa_attempts")
    # Every attempt is a new bounded worker lease, even when Claude resumes a prior
    # qa-repairer context. This prevents one stale claim from masking repeated work.
    state["worker_claim"] = None
    state["qa_attempt"] = {
        "number": attempts,
        "max": MAX_HAIKU_QA_ATTEMPTS,
        "recorded_at": utc_now(),
    }
    write_state(root, state)
    print(f"{state['id']}: Haiku QA attempt {attempts}/{MAX_HAIKU_QA_ATTEMPTS} authorized")


def command_qa_escalate(
    root: Path,
    reason: str,
    observed_haiku_attempts: int | None = None,
    defect_id: str | None = None,
    manual_bug_id: str | None = None,
) -> None:
    """Human-authorized narrow escalation to Sonnet medium.

    Two legal entry points exist:
    1. an active/non-converging Haiku batch (REPAIRING/NEEDS_HUMAN_REVIEW);
    2. READY_FOR_MANUAL_QA where the human explicitly selects a previously recorded
       manual-QA defect that still needs a stronger repair.
    """
    state = load_state(root)
    require_state(
        state,
        {"REPAIRING", "NEEDS_HUMAN_REVIEW", "READY_FOR_MANUAL_QA"},
        "escalate manual-QA repair to Sonnet",
    )
    validate_string(reason, "reason")
    ensure_manual_bug_ids(state)
    route = state.get("qa_repair_route")
    if route == "qa-repairer-sonnet":
        print(f"{state['id']}: QA repair is already escalated to qa-repairer-sonnet")
        return

    direct_from_manual_qa = route is None and state.get("state") in {"READY_FOR_MANUAL_QA", "NEEDS_HUMAN_REVIEW"}
    selected: list[dict[str, Any]] = []
    if direct_from_manual_qa:
        if bool(defect_id) == bool(manual_bug_id):
            raise DeliveryError(
                "Escalating from READY_FOR_MANUAL_QA requires exactly one selector: "
                "--defect-id D-... or --manual-bug-id <id>. Use `delivery.py qa-history --json` to resolve it."
            )
        for item in state.get("defects", []):
            if item.get("source") != "manual-qa":
                continue
            if defect_id and str(item.get("id")) == defect_id:
                selected.append(item)
            elif manual_bug_id and str(item.get("manual_bug_id")) == manual_bug_id:
                selected.append(item)
        if not selected:
            selector = defect_id or manual_bug_id
            raise DeliveryError(f"No manual-QA defect matches escalation selector {selector!r}")
        # manual_bug_id may have several historical records; reactivate only the newest one.
        selected = [selected[-1]]
        target = selected[0]
        prior_status = str(target.get("status") or "")
        if prior_status == "verified-repaired":
            reopen_count = int(target.get("reopen_count", 0)) + 1
            if reopen_count > MAX_MANUAL_QA_REOPENS:
                state["state"] = "NEEDS_HUMAN_REVIEW"
                write_state(root, state)
                raise DeliveryError(
                    f"Manual QA bug {target.get('manual_bug_id')} has already consumed its one autonomous reopen. "
                    "Keep it in human review rather than starting another autonomous repair."
                )
            target["reopen_count"] = reopen_count
            metric_increment(state, "reopens")
        target["status"] = "open"
        target["repair_route"] = "qa-repairer-sonnet"
        metric_increment(state, "qa_batches")
        budget = ensure_budget(state)
        budget["manual_qa_batches"] = int(budget.get("manual_qa_batches", 0)) + 1
        budget["human_extra_repairs"] = int(budget.get("human_extra_repairs", 0)) + 1
        budget["human_extra_targeted"] = int(budget.get("human_extra_targeted", 0)) + 1
        ensure_budget(state)
        state["quality"] = None
        state["verifier"] = None
        state["verifier_claim"] = None
        state["worker_claim"] = None
        state["verification_mode"] = "targeted"
        state["qa_attempts_current_batch"] = 0
        state["qa_attempt"] = None
        attempts = 0
    else:
        if route != "qa-repairer":
            raise DeliveryError(
                "QA escalation requires an active qa-repairer route, or an explicit defect selector "
                "from READY_FOR_MANUAL_QA. "
                f"Current route is {route!r}."
            )
        open_manual = [
            item for item in state.get("defects", [])
            if item.get("source") == "manual-qa" and item.get("status") == "open"
        ]
        if not open_manual:
            raise DeliveryError("QA escalation requires at least one open manual-QA defect")
        attempts = int(state.get("qa_attempts_current_batch", 0))
        if observed_haiku_attempts is not None:
            if not (0 <= observed_haiku_attempts <= 20):
                raise DeliveryError("Observed Haiku QA attempt backfill must be between 0 and 20")
            if observed_haiku_attempts < attempts:
                raise DeliveryError(
                    f"Observed Haiku QA attempts ({observed_haiku_attempts}) cannot be lower than "
                    f"the machine-recorded count ({attempts})"
                )
            if observed_haiku_attempts > attempts:
                metric_increment(state, "haiku_qa_attempts", observed_haiku_attempts - attempts)
                attempts = observed_haiku_attempts
                state["qa_attempts_current_batch"] = attempts
        elif attempts == 0:
            ensure_metrics(state)["partial"] = True

    state["state"] = "REPAIRING"
    state["qa_repair_route"] = "qa-repairer-sonnet"
    state["worker_claim"] = None
    state["verifier_claim"] = None
    state["qa_escalation"] = {
        "from": "manual-qa" if direct_from_manual_qa else "qa-repairer",
        "to": "qa-repairer-sonnet",
        "reason": reason.strip(),
        "defect_ids": [item.get("id") for item in selected] if direct_from_manual_qa else [],
        "after_haiku_attempts": attempts,
        "attempts_backfilled": observed_haiku_attempts is not None,
        "attempts_untracked": (not direct_from_manual_qa and observed_haiku_attempts is None and attempts == 0),
        "recorded_at": utc_now(),
    }
    metric_increment(state, "qa_escalations_to_sonnet")
    add_observation(
        state,
        f"Human authorized Sonnet/medium QA escalation after {attempts} Haiku attempt(s): {reason.strip()}",
        severity="note",
    )
    write_state(root, state)
    print(
        f"{state['id']}: REPAIRING (route=qa-repairer-sonnet, "
        f"human escalation after {attempts} Haiku attempt(s))"
    )


def command_qa_accept(root: Path, reason: str) -> None:
    state = load_state(root)
    require_state(state, {"READY_FOR_MANUAL_QA"}, "accept manual QA")
    validate_string(reason, "reason")
    _, current = current_snapshot(root, state["baseline"])
    verified = (state.get("verifier") or {}).get("fingerprint")
    if not verified or current != verified:
        raise DeliveryError("Manual QA cannot accept a candidate that differs from its verifier receipt")
    accepted_at = utc_now()
    record = accepted_metric_record(state, reason, accepted_at)
    appended = append_metric_record(root, record)
    state["state"] = "DONE"
    state["manual_qa_acceptance"] = {"reason": reason.strip(), "accepted_at": accepted_at}
    state["handoff"] = None
    state["metrics_recorded"] = True
    write_state(root, state)
    suffix = "metrics appended" if appended else "metrics already present"
    print(f"{state['id']}: DONE (manual QA accepted; {suffix})")


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
            "baseline": sparse_baseline(root),
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

def command_migrate_state(root: Path) -> None:
    target = state_path(root)
    if not target.is_file():
        print("No active delivery state to migrate.")
        return
    before_size = target.stat().st_size
    state = load_state(root, refresh_ready=False)
    after_size = target.stat().st_size
    dirty_count = len((state.get("baseline") or {}).get("dirty", {}))
    print(
        f"{state.get('id')}: state v{state.get('version')} sparse baseline "
        f"({dirty_count} pre-existing dirty paths; {before_size} -> {after_size} bytes)"
    )


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
    changed = candidate_changed_paths(root, state["baseline"])
    current_fp = fingerprint_candidate(root, state["baseline"])
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
        "qa_attempts_current_batch": int(state.get("qa_attempts_current_batch", 0)),
        "qa_attempt_limit": MAX_HAIKU_QA_ATTEMPTS,
        "qa_escalation": state.get("qa_escalation"),
        "verification_route": verification_route(state) if state.get("state") == "VERIFYING" else None,
        "metrics": ensure_metrics(state),
        "budget": {
            "full": [budget["full_verifier_runs"], budget["max_full_verifier_runs"]],
            "targeted": [budget["targeted_verifier_runs"], budget["max_targeted_verifier_runs"]],
            "repairs": [budget["repair_cycles"], budget["max_repair_cycles"]],
            "manual_qa_batches": budget.get("manual_qa_batches", 0),
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

    start = sub.add_parser("start", help="low-level backwards-compatible state creation")
    start.add_argument("--task", required=True)
    start.add_argument("--target", choices=sorted(DELIVERY_TARGETS), default="production")
    start.add_argument("--reference", action="append", default=[])

    begin = sub.add_parser("begin", help="atomically start a delivery and claim its initial worker")
    begin.add_argument("--task", required=True)
    begin.add_argument("--target", choices=sorted(DELIVERY_TARGETS), default="production")
    begin.add_argument("--reference", action="append", default=[])
    begin.add_argument("--json", action="store_true")

    model = sub.add_parser("model")
    model_source = model.add_mutually_exclusive_group(required=True)
    model_source.add_argument("--file")
    model_source.add_argument("--stdin", action="store_true")

    sub.add_parser("model-template")

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

    sub.add_parser("qa-attempt")

    qa_history = sub.add_parser("qa-history")
    qa_history.add_argument("--json", action="store_true")

    qa_escalate = sub.add_parser("qa-escalate")
    qa_escalate.add_argument("--reason", required=True)
    qa_escalate.add_argument("--observed-haiku-attempts", type=int)
    escalation_selector = qa_escalate.add_mutually_exclusive_group()
    escalation_selector.add_argument("--defect-id")
    escalation_selector.add_argument("--manual-bug-id")

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

    sub.add_parser("migrate-state")

    failed = sub.add_parser("fail")
    failed.add_argument("--reason", required=True)

    metrics = sub.add_parser("metrics", help="summarize the append-only delivery metrics ledger")
    metrics.add_argument("--json", action="store_true")
    metrics.add_argument("--html", action="store_true", dest="html_view")
    metrics.add_argument("--open", action="store_true", dest="open_view")
    metrics.add_argument("--limit", type=int, default=15)

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
        elif args.command == "begin":
            command_begin(root, args.task, args.target, args.reference, args.json)
        elif args.command == "model":
            command_model(root, args.file, args.stdin)
        elif args.command == "model-template":
            command_model_template(root)
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
        elif args.command == "qa-attempt":
            command_qa_attempt(root)
        elif args.command == "qa-history":
            command_qa_history(root, args.json)
        elif args.command == "qa-escalate":
            command_qa_escalate(
                root, args.reason, args.observed_haiku_attempts, args.defect_id, args.manual_bug_id
            )
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
        elif args.command == "migrate-state":
            command_migrate_state(root)
        elif args.command == "fail":
            command_fail(root, args.reason)
        elif args.command == "metrics":
            command_metrics(
                root,
                as_json=args.json,
                html_view=args.html_view,
                open_view=args.open_view,
                limit=args.limit,
            )
        elif args.command == "status":
            command_status(root, args.json, args.full)
        elif args.command == "report":
            command_report(root)
    except DeliveryError as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(2) from exc


if __name__ == "__main__":
    main()
