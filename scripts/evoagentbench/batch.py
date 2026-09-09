#!/usr/bin/env python3
"""Resume the frozen train collection without overwriting any trial."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path
from typing import Any

from .driver import DEFAULT_ROOT, PROTOCOL_FILE, readonly_connectivity


def _outcome(path: Path) -> dict[str, Any] | None:
    for name in ("evidence.json", "runner-failure.json"):
        candidate = path / name
        if candidate.is_file():
            return json.loads(candidate.read_text())
    return None


def experience_state(root: Path, task_id: str, smoke_ids: set[str]) -> tuple[str, str | None]:
    candidates = []
    if task_id in smoke_ids:
        candidates.extend(sorted((root / "runs").glob(f"smoke-{task_id}-vanilla-trial-1*")))
    candidates.append(root / "runs" / f"experience-{task_id}-vanilla-trial-1")
    completed = []
    incomplete = []
    for candidate in candidates:
        if not candidate.is_dir():
            continue
        outcome = _outcome(candidate)
        if outcome is None:
            incomplete.append(candidate.name)
        elif outcome.get("status") == "INFRA_ERROR":
            continue
        else:
            completed.append(candidate.name)
    if completed:
        return "complete", completed[-1]
    primary = candidates[-1]
    primary_outcome = _outcome(primary) if primary.is_dir() else None
    if primary_outcome and primary_outcome.get("status") == "INFRA_ERROR":
        return "infra_error", primary.name
    if incomplete:
        return "incomplete", incomplete[-1]
    return "pending", None


def collect_experience(root: Path) -> None:
    protocol = json.loads(PROTOCOL_FILE.read_text())
    tasks = protocol["selection"]["experience"]
    smoke = set(protocol["selection"]["smoke"])
    for index, task_id in enumerate(tasks, start=1):
        state, source = experience_state(root, task_id, smoke)
        print(json.dumps({"position": index, "total": len(tasks), "task_id": task_id, "state": state, "source": source}), flush=True)
        if state == "complete":
            continue
        if state != "pending":
            raise RuntimeError(f"EXPERIENCE_{state.upper()}:{task_id}:{source}")
        checks = readonly_connectivity()
        if not checks.get("memory_proxy", {}).get("reachable") or not checks.get("vllm", {}).get("model_present"):
            raise RuntimeError("MODEL_OR_PROXY_UNAVAILABLE")
        completed = subprocess.run([
            sys.executable, "-m", "scripts.evoagentbench.driver", "run", "--root", str(root),
            "--phase", "experience", "--arm", "vanilla", "--task", task_id, "--trial", "1",
        ])
        if completed.returncode != 0:
            raise RuntimeError(f"EXPERIENCE_DRIVER_FAILED:{task_id}:{completed.returncode}")
        outcome = _outcome(root / "runs" / f"experience-{task_id}-vanilla-trial-1")
        if not outcome or outcome.get("status") == "INFRA_ERROR":
            raise RuntimeError(f"EXPERIENCE_INFRA_ERROR:{task_id}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["experience"])
    parser.add_argument("--root", type=Path, default=DEFAULT_ROOT)
    args = parser.parse_args()
    collect_experience(args.root)


if __name__ == "__main__":
    main()
