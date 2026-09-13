#!/usr/bin/env python3
"""Run and summarize immutable diagnostic trials without changing the main Attempt."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

from .driver import PROTOCOL_FILE, canonical_hash, readonly_connectivity, write_new


def run_id(task_id: str, arm: str, trial: int, candidate_revision: int) -> str:
    revision = "" if arm == "vanilla" else f"-r{candidate_revision}"
    return f"development-{task_id}-{arm}{revision}-trial-{trial}"


def summarize(rows: list[dict[str, Any]]) -> dict[str, Any]:
    grouped: dict[str, dict[str, list[dict[str, Any]]]] = {}
    for row in rows:
        grouped.setdefault(row["task_id"], {}).setdefault(row["arm"], []).append(row)
    tasks: dict[str, Any] = {}
    for task_id, arms in sorted(grouped.items()):
        tasks[task_id] = {}
        for arm, arm_rows in sorted(arms.items()):
            ordered = sorted(arm_rows, key=lambda item: item["trial"])
            totals = [item["usage"]["total_tokens"] for item in ordered]
            tasks[task_id][arm] = {
                "trials": [item["trial"] for item in ordered],
                "statuses": [item["status"] for item in ordered],
                "passes": sum(item["status"] == "TASK_PASS" for item in ordered),
                "failures": sum(item["status"] == "TASK_FAIL" for item in ordered),
                "infra_errors": sum(item["status"] == "INFRA_ERROR" for item in ordered),
                "mean_reward": sum(item["reward"] for item in ordered) / len(ordered),
                "mean_total_tokens": sum(value for value in totals if value is not None) / len(totals)
                if totals and all(value is not None for value in totals) else None,
                "injected_asset_sets": sorted({
                    canonical_hash(item.get("injected_assets", [])) for item in ordered
                }),
            }
    return tasks


def collect(root: Path, probe_id: str, tasks: list[str], arms: list[str], trials: list[int], candidate_revision: int) -> Path:
    protocol = json.loads(PROTOCOL_FILE.read_text())
    allowed_tasks = set(protocol["selection"]["development"])
    if not tasks or not set(tasks) <= allowed_tasks:
        raise ValueError("PROBE_TASK_OUTSIDE_FROZEN_DEVELOPMENT")
    if not arms or not set(arms) <= set(protocol["arms"]):
        raise ValueError("PROBE_ARM_OUTSIDE_FROZEN_PROTOCOL")
    if not trials or min(trials) < 1:
        raise ValueError("PROBE_TRIAL_INVALID")

    for task_id in tasks:
        for arm in arms:
            for trial in trials:
                identifier = run_id(task_id, arm, trial, candidate_revision)
                evidence = root / "runs" / identifier / "evidence.json"
                if evidence.is_file():
                    continue
                if (root / "runs" / identifier).exists():
                    raise RuntimeError(f"PROBE_RUN_INCOMPLETE:{identifier}")
                connectivity = readonly_connectivity()
                if not connectivity.get("memory_proxy", {}).get("reachable") or not connectivity.get("vllm", {}).get("model_present"):
                    raise RuntimeError("MODEL_OR_PROXY_UNAVAILABLE")
                command = [
                    sys.executable, "-m", "scripts.evoagentbench.driver", "run",
                    "--root", str(root), "--phase", "development", "--arm", arm,
                    "--task", task_id, "--trial", str(trial),
                ]
                if arm != "vanilla":
                    command.extend(["--candidate-revision", str(candidate_revision)])
                completed = subprocess.run(command, env=os.environ)
                if completed.returncode != 0:
                    raise RuntimeError(f"PROBE_RUN_FAILED:{identifier}:{completed.returncode}")

    rows = []
    for task_id in tasks:
        for arm in arms:
            for trial in trials:
                evidence = root / "runs" / run_id(task_id, arm, trial, candidate_revision) / "evidence.json"
                rows.append(json.loads(evidence.read_text()))
    candidate_hashes = {row.get("candidate_artifact_hash") for row in rows if row.get("candidate_artifact_hash")}
    if len(candidate_hashes) != 1:
        raise RuntimeError("PROBE_CANDIDATE_BINDING_INCONSISTENT")
    report = {
        "schema": "tdai-evoagentbench-stability-probe-v1",
        "probe_id": probe_id,
        "role": "diagnostic_only",
        "replaces_main_attempt": False,
        "main_attempt_id": "factorial-frozen-composite-r2-main",
        "protocol_id": protocol["protocol_id"],
        "protocol_hash": protocol["protocol_hash"],
        "candidate_revision": candidate_revision,
        "candidate_hash": candidate_hashes.pop(),
        "tasks": tasks,
        "arms": arms,
        "trials": trials,
        "results": summarize(rows),
        "source_run_hashes": sorted(row["evidence_hash"] for row in rows),
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    report["artifact_hash"] = canonical_hash(report)
    output = root / "probes" / f"{probe_id}.json"
    write_new(output, report)
    return output


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--probe-id", required=True)
    parser.add_argument("--task", action="append", required=True)
    parser.add_argument("--arm", action="append", required=True)
    parser.add_argument("--trial", action="append", type=int, required=True)
    parser.add_argument("--candidate-revision", type=int, required=True)
    args = parser.parse_args()
    output = collect(args.root, args.probe_id, args.task, args.arm, args.trial, args.candidate_revision)
    print(json.dumps({"probe": str(output)}))


if __name__ == "__main__":
    main()
