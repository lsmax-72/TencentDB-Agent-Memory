#!/usr/bin/env python3
"""Resume the frozen v5 train-to-factorial-pilot workflow stage by stage."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

from .driver import DEFAULT_ROOT, PROTOCOL_FILE


PATCH_ATTEMPT = "factorial-patches-r1-a1"
SEMANTIC_ATTEMPT = "factorial-semantic-r1"
SKILL_ATTEMPT = "factorial-skills-r2-a1"
REPORT_ATTEMPT = "factorial-heldout-r2-main"


def _run(arguments: list[str]) -> None:
    completed = subprocess.run([sys.executable, "-m", *arguments], env=os.environ)
    if completed.returncode != 0:
        raise RuntimeError(f"PIPELINE_STAGE_FAILED:{arguments[0]}:{completed.returncode}")


def run(root: Path, *, ingest: bool) -> None:
    protocol = json.loads(PROTOCOL_FILE.read_text())
    if protocol.get("protocol_id") != "tdai-evoagentbench-code-v5-factorial-heldout":
        raise ValueError("V5_FACTORIAL_PROTOCOL_REQUIRED")

    _run(["scripts.evoagentbench.batch", "experience", "--root", str(root)])

    memory = root / "frozen/refinement-r1"
    if not memory.exists():
        _run(["scripts.evoagentbench.refine", "--root", str(root), "--revision", "1", "--attempt", "1", "--memory-only"])

    patches = root / "frozen" / f"trace-patches-{PATCH_ATTEMPT}"
    if not patches.exists():
        _run(["scripts.evoagentbench.trace_patch_runner", "--root", str(root), "--source-revision", "1", "--attempt-id", PATCH_ATTEMPT])

    semantic = root / "frozen" / f"trace-patches-{SEMANTIC_ATTEMPT}"
    if not semantic.exists():
        _run([
            "scripts.evoagentbench.trace_recluster", "--root", str(root),
            "--source-artifact", str(patches),
            "--source-memories", str(memory / "memories.json"),
            "--attempt-id", SEMANTIC_ATTEMPT,
        ])
    semantic_manifest = json.loads((semantic / "manifest.json").read_text())
    if semantic_manifest.get("eligible_cluster_count", 0) < 1:
        raise RuntimeError("NO_ELIGIBLE_TRAIN_ONLY_SKILL_CLUSTER")

    candidate = root / "frozen/refinement-r2"
    if not candidate.exists():
        _run([
            "scripts.evoagentbench.trace_skill_runner", "--root", str(root),
            "--patch-artifact", str(semantic), "--source-revision", "1",
            "--target-revision", "2", "--attempt-id", SKILL_ATTEMPT,
        ])

    preflight = root / "preflight/factorial-r2.json"
    if not preflight.exists():
        _run(["scripts.evoagentbench.factorial_preflight", "--root", str(root), "--candidate-revision", "2"])
    preflight_result = json.loads(preflight.read_text())
    if preflight_result.get("status") != "READY":
        raise RuntimeError("FACTORIAL_PREFLIGHT_BLOCKED")

    _run(["scripts.evoagentbench.batch", "development", "--root", str(root), "--candidate-revision", "2"])

    report = root / "attempts" / f"{REPORT_ATTEMPT}.json"
    if not report.exists():
        command = [
            "scripts.evoagentbench.report", "--root", str(root), "--phase", "development",
            "--attempt-id", REPORT_ATTEMPT, "--candidate-revision", "2",
            "--candidate", str(candidate / "skills.json"),
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
