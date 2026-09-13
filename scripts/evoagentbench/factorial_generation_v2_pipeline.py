#!/usr/bin/env python3
"""Resume the v6 train-only cluster review and four-arm held-out pilot."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

from .driver import DEFAULT_ROOT, PROTOCOL_FILE


SOURCE_ROOT = Path("/Users/lsmax/Coder/evoagentbench-artifacts/code-v5-factorial")
SOURCE_PATCHES = SOURCE_ROOT / "frozen/trace-patches-factorial-semantic-r1"
CLUSTER_ATTEMPT = "factorial-cluster-review-r1-a1"
SKILL_ATTEMPT = "factorial-skills-r2-a1"
REPORT_ATTEMPT = "factorial-generation-v2-r2-main"


def _run(arguments: list[str]) -> None:
    completed = subprocess.run([sys.executable, "-m", *arguments], env=os.environ)
    if completed.returncode != 0:
        raise RuntimeError(f"PIPELINE_STAGE_FAILED:{arguments[0]}:{completed.returncode}")


def run(root: Path, *, ingest: bool) -> None:
    protocol = json.loads(PROTOCOL_FILE.read_text())
    if protocol.get("protocol_id") != "tdai-evoagentbench-code-v5-factorial-generation-v2":
        raise ValueError("V6_FACTORIAL_GENERATION_PROTOCOL_REQUIRED")

    if not root.exists():
        _run(["scripts.evoagentbench.driver", "setup", "--root", str(root)])
    memory = root / "frozen/refinement-r1"
    if not memory.exists():
        _run([
            "scripts.evoagentbench.carry_candidate",
            "--source-root", str(SOURCE_ROOT), "--target-root", str(root),
            "--revision", "1", "--protocol", str(PROTOCOL_FILE),
        ])
    development_cache = root / "phase-cache/development"
    if not development_cache.exists():
        _run([
            "scripts.evoagentbench.subset_cache", "--root", str(root),
            "--phase", "development",
        ])

    reviewed = root / "frozen" / f"trace-patches-{CLUSTER_ATTEMPT}"
    if not reviewed.exists():
        _run([
            "scripts.evoagentbench.trace_cluster_runner", "--root", str(root),
            "--source-artifact", str(SOURCE_PATCHES),
            "--source-memories", str(memory / "memories.json"),
            "--attempt-id", CLUSTER_ATTEMPT,
        ])
    reviewed_manifest = json.loads((reviewed / "manifest.json").read_text())
    if reviewed_manifest.get("eligible_cluster_count", 0) < 1:
        raise RuntimeError("NO_ADJUDICATED_TRAIN_ONLY_SKILL_CLUSTER")

    candidate = root / "frozen/refinement-r2"
    if not candidate.exists():
        _run([
            "scripts.evoagentbench.trace_skill_runner", "--root", str(root),
            "--patch-artifact", str(reviewed), "--source-revision", "1",
            "--target-revision", "2", "--attempt-id", SKILL_ATTEMPT,
        ])
    preflight = root / "preflight/factorial-r2.json"
    if not preflight.exists():
        _run([
            "scripts.evoagentbench.factorial_preflight", "--root", str(root),
            "--candidate-revision", "2",
        ])
    if json.loads(preflight.read_text()).get("status") != "READY":
        raise RuntimeError("FACTORIAL_PREFLIGHT_BLOCKED")

    _run([
        "scripts.evoagentbench.batch", "development", "--root", str(root),
        "--candidate-revision", "2",
    ])
    report = root / "attempts" / f"{REPORT_ATTEMPT}.json"
    if not report.exists():
        command = [
            "scripts.evoagentbench.report", "--root", str(root),
            "--phase", "development", "--attempt-id", REPORT_ATTEMPT,
            "--candidate-revision", "2", "--candidate", str(candidate / "skills.json"),
        ]
        if ingest:
            command.append("--ingest")
        _run(command)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=DEFAULT_ROOT)
    parser.add_argument("--ingest", action="store_true")
    args = parser.parse_args()
    run(args.root, ingest=args.ingest)


if __name__ == "__main__":
    main()
