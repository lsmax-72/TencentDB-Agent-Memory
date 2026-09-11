#!/usr/bin/env python3
"""Build and optionally ingest immutable three-arm comparison evidence."""

from __future__ import annotations

import argparse
import json
import os
import time
from pathlib import Path
from typing import Any

from .adapter import candidate_contamination
from .driver import CORE_URL, PROTOCOL_FILE, api, canonical_hash
from .metrics import compare


def _load_runs(root: Path, phase: str, candidate_revision: int | None = None) -> dict[str, list[dict[str, Any]]]:
    arms: dict[str, list[dict[str, Any]]] = {"vanilla": [], "memory": [], "skill": []}
    for path in sorted((root / "runs").glob(f"{phase}-*/evidence.json")):
        row = json.loads(path.read_text())
        if row.get("phase") != phase:
            continue
        if row.get("arm") != "vanilla" and candidate_revision is not None and row.get("candidate_revision") != candidate_revision:
            continue
        arms[row["arm"]].append(row)
    return arms


def _coverage(rows: list[dict[str, Any]]) -> float:
    return sum(row.get("retrieval_count", 0) > 0 for row in rows) / len(rows) if rows else 0


def _status(phase: str, comparison: dict[str, Any], infra: int, total: int) -> tuple[str, list[str]]:
    if infra:
        return "INFRA_ERROR", [f"{infra}/{total} arm runs are infrastructure failures"]
    skill = comparison["comparisons"]["skill"]
    gain = skill["transfer_gain"]
    fixed, broken = skill["counts"]["newly_fixed"], skill["counts"]["newly_broken"]
    cost = skill["token_cost_change"]
    if phase == "development":
        reasons = []
        if gain is None or gain <= 0: reasons.append("SKILL_TRANSFER_GAIN_NOT_POSITIVE")
        if fixed < broken: reasons.append("NEWLY_FIXED_LT_NEWLY_BROKEN")
        if cost is None or cost > 0.25: reasons.append("TOKEN_COST_INCREASE_EXCEEDS_25_PERCENT")
        return ("FAIL", reasons) if reasons else ("PASS", [])
    ci = skill["paired_bootstrap_95_ci"]
    reasons = []
    if gain is None or gain <= 0: reasons.append("SKILL_TRANSFER_GAIN_NOT_POSITIVE")
    if ci is None or ci[0] <= 0: reasons.append("PAIRED_CI_LOWER_NOT_POSITIVE")
    if fixed <= broken: reasons.append("NEWLY_FIXED_NOT_GT_NEWLY_BROKEN")
    if cost is None or cost > 0.25: reasons.append("TOKEN_COST_INCREASE_EXCEEDS_25_PERCENT")
    return ("FAIL", reasons) if reasons else ("PASS", [])


def build(root: Path, phase: str, attempt_id: str, candidate_file: Path | None, candidate_revision: int | None = None) -> dict[str, Any]:
    protocol = json.loads(PROTOCOL_FILE.read_text())
    arms = _load_runs(root, phase, candidate_revision)
    result = compare(arms, f"{protocol['protocol_id']}:{phase}:{attempt_id}")
    rows = [row for arm_rows in arms.values() for row in arm_rows]
    infra = sum(row["status"] == "INFRA_ERROR" for row in rows)
    status, reasons = _status(phase, result, infra, len(rows))
    candidate_hash = None
    contamination: list[str] = []
    if candidate_file:
        text = candidate_file.read_text()
        candidate_hash = __import__("hashlib").sha256(text.encode()).hexdigest()
        contamination = candidate_contamination(text, protocol["selection"]["final_test"])
        if contamination:
            status, reasons = "FAIL", reasons + ["CANDIDATE_TEST_CONTAMINATION"]
    source_hashes = sorted(row["evidence_hash"] for row in rows)
    attempt = {
        "schema": "tdai-evoagentbench-comparison-v1",
        "attempt_id": attempt_id,
        "protocol_id": protocol["protocol_id"], "protocol_hash": protocol["protocol_hash"],
        "benchmark": "EvoAgentBench-compatible", "phase": phase, "status": status, "reasons": reasons,
        "comparisons": result["comparisons"], "cost_summary": result["cost_summary"],
        "candidate_hash": candidate_hash,
        "candidate_revision": candidate_revision,
        "retrieval_coverage": {arm: _coverage(arms[arm]) for arm in ("memory", "skill")},
        "contamination_findings": contamination, "source_run_hashes": source_hashes,
        "source_hash": canonical_hash(source_hashes),
        "evidence_limitations": [
            "EvoAgentBench-compatible because the model differs from the paper configuration",
            "Research protocol only; this record cannot authorize production promotion",
            "Official test trajectories are observation-only and cannot generate candidates",
        ],
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    attempt["artifact_hash"] = canonical_hash(attempt)
    return attempt


def ingest(root: Path, attempt: dict[str, Any]) -> Any:
    scope = json.loads((root / "scope.json").read_text())
    user_key = json.loads((root / "private/secrets.json").read_text())["user_key"]
    body = {
        "team_id": scope["team_id"], "agent_id": scope["agent_id"],
        **{key: attempt[key] for key in (
            "attempt_id", "protocol_id", "protocol_hash", "source_hash", "phase", "status", "comparisons",
            "cost_summary", "candidate_hash", "retrieval_coverage", "evidence_limitations", "contamination_findings"
        )},
    }
    return api("/v3/evolution/benchmark/attempt/ingest", body, user_key)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--phase", choices=["development", "test_checkpoint", "test"], required=True)
    parser.add_argument("--attempt-id", required=True)
    parser.add_argument("--candidate", type=Path)
    parser.add_argument("--candidate-revision", type=int)
    parser.add_argument("--ingest", action="store_true")
    args = parser.parse_args()
    output = args.root / "attempts" / f"{args.attempt_id}.json"
    if output.exists():
        raise FileExistsError("IMMUTABLE_ATTEMPT_ALREADY_EXISTS")
    attempt = build(args.root, args.phase, args.attempt_id, args.candidate, args.candidate_revision)
    output.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)
    with os.fdopen(fd, "w") as handle:
        json.dump(attempt, handle, ensure_ascii=False, indent=2); handle.write("\n")
    record = ingest(args.root, attempt) if args.ingest else None
    print(json.dumps({"attempt": str(output), "status": attempt["status"], "reasons": attempt["reasons"], "record_id": record.get("id") if record else None}))


if __name__ == "__main__":
    main()
