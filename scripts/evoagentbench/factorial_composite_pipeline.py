#!/usr/bin/env python3
"""Resume the frozen composite Candidate and four-arm held-out pilot."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

from .driver import DEFAULT_ROOT, PROTOCOL_FILE


MEMORY_SOURCE = Path("/Users/lsmax/Coder/evoagentbench-artifacts/code-v5-factorial/frozen/refinement-r1")
SKILL_SOURCE = Path("/Users/lsmax/Coder/evoagentbench-artifacts/code-v1/frozen/retrieval-policy-v6-r1")
REPORT_ATTEMPT = "factorial-frozen-composite-r2-main"


def _run(arguments: list[str]) -> None:
    completed = subprocess.run([sys.executable, "-m", *arguments], env=os.environ)
    if completed.returncode != 0:
        raise RuntimeError(f"PIPELINE_STAGE_FAILED:{arguments[0]}:{completed.returncode}")


def run(root: Path, *, ingest: bool) -> None:
    protocol = json.loads(PROTOCOL_FILE.read_text())
    if protocol.get("protocol_id") != "tdai-evoagentbench-code-v5-factorial-frozen-composite-v1":
        raise ValueError("V8_FACTORIAL_COMPOSITE_PROTOCOL_REQUIRED")
    if not root.exists():
        _run(["scripts.evoagentbench.driver", "setup", "--root", str(root)])
    if not (root / "phase-cache/development").exists():
        _run([
            "scripts.evoagentbench.subset_cache", "--root", str(root),
            "--phase", "development",
        ])
    candidate = root / "frozen/refinement-r2"
    if not candidate.exists():
        _run([
            "scripts.evoagentbench.composite_candidate",
            "--memory-source", str(MEMORY_SOURCE),
            "--skill-source", str(SKILL_SOURCE),
            "--output", str(candidate), "--protocol", str(PROTOCOL_FILE),
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
