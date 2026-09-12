#!/usr/bin/env python3
"""Regrade the final raw assistant code block with the pinned official verifier."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from pathlib import Path
from types import SimpleNamespace


EVO_REPO = Path("/Users/lsmax/Coder/EvoAgentBench")
BENCHMARK_SRC = EVO_REPO / "benchmark/src"


def final_python_block(session_path: Path) -> str:
    from domains.code_implementation.livecode import _extract_code_from_text

    for raw_line in reversed(session_path.read_text().splitlines()):
        record = json.loads(raw_line)
        content = record.get("content") if record.get("role") == "assistant" else None
        if content and "```python" in content:
            code = _extract_code_from_text(content)
            if code:
                return code
    raise ValueError("FINAL_ASSISTANT_PYTHON_BLOCK_MISSING")


def canonical_hash(value: object) -> str:
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def write_new(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)
    with os.fdopen(descriptor, "w") as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2)
        handle.write("\n")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--retry-id")
    args = parser.parse_args()

    sys.path.insert(0, str(BENCHMARK_SRC))
    from config import load_config
    from domains.code_implementation.livecode import LiveCodeBenchAdapter, _verify_code

    result_path = next(args.run_dir.glob("official/official/*__trial_1/result.json"))
    session_path = result_path.with_name("session.jsonl")
    task_id = json.loads(result_path.read_text())["task_name"]
    load_config(str(args.run_dir / "private/config.yaml"))
    adapter = LiveCodeBenchAdapter()
    adapter.load_tasks(SimpleNamespace(split=None, task=task_id))
    raw_code = final_python_block(session_path)
    result = _verify_code(adapter._problems[task_id], raw_code, timeout=6)
    regrade = {
        "schema": "tdai-evoagentbench-regrade-v1",
        "task_id": task_id,
        "source": "raw_final_assistant",
        "source_session_sha256": hashlib.sha256(session_path.read_bytes()).hexdigest(),
        "code_sha256": hashlib.sha256(raw_code.encode()).hexdigest(),
        **result,
    }
    regrade["artifact_hash"] = canonical_hash(regrade)
    if args.output_dir:
        if not args.retry_id:
            parser.error("--output-dir requires --retry-id")
        source = json.loads((args.run_dir / "evidence.json").read_text())
        retry = dict(source)
        retry["run_id"] = args.output_dir.name
        retry["status"] = "TASK_PASS" if result["reward"] == 1 else "TASK_FAIL"
        retry["failure_reason"] = None if result["reward"] == 1 else "VERIFIER_REJECTED"
        retry["reward"] = float(result["reward"])
        retry["final_output"] = next(
            json.loads(line)["content"]
            for line in reversed(session_path.read_text().splitlines())
            if json.loads(line).get("role") == "assistant" and "```python" in (json.loads(line).get("content") or "")
        )
        retry["verifier"] = {
            "reward": float(result["reward"]),
            "passed": result.get("passed"),
            "total": result.get("total"),
            "error": result.get("error"),
        }
        retry["implementation_fix_retry"] = {
            "retry_id": args.retry_id,
            "reason": "CLI_RESPONSE_WRAP_AND_SESSION_FALLBACK_SELECTED_NON_FINAL_CODE",
            "source_run_id": source["run_id"],
            "source_evidence_hash": source["evidence_hash"],
            "regrade_artifact_hash": regrade["artifact_hash"],
            "model_reexecuted": False,
        }
        retry["source_artifacts"] = {
            **retry["source_artifacts"],
            "implementation_retry_source_evidence_hash": source["evidence_hash"],
            "raw_final_code_sha256": regrade["code_sha256"],
        }
        retry.pop("evidence_hash", None)
        retry["evidence_hash"] = canonical_hash(retry)
        write_new(args.output_dir / "regrade.json", regrade)
        write_new(args.output_dir / "evidence.json", retry)
    print(json.dumps(regrade, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
