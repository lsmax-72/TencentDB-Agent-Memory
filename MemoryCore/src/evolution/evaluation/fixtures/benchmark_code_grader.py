#!/usr/bin/env python3
"""Thin LiveCodeBench grader for the evolution evaluation binding.

This replaces the whole EvoAgentBench driver stack that used to live in
``scripts/evoagentbench/``. All of it -- the driver, the proxy bridge, the CLI
shim, the hand-rolled retrieve/inject/extract layer -- existed only because the
benchmark could not reuse the product's own evaluation path. What is genuinely
this project's own is the *grading*: everything else is now line A's
``MinimalEvaluationRunner`` + ``NanobotAgentAdapter``.

Contract: read one task from a frozen pool, grade the solution file found in the
agent's workspace, and exit 0 only when every test passes. The Oracle asserts on
the exit code, so this script must never report success for a suite that did not
run -- an unrunnable submission is a failure, not a pass. That distinction is
the exact bug that made two earlier instruments unreadable.

Usage:
  benchmark_code_grader.py --pool <pool.jsonl> --task <id> \
      --solution <workspace>/solution.py [--lcb-repo <dir>] [--timeout 6]
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

DEFAULT_LCB_REPO = "/Users/lsmax/Coder/LiveCodeBench"
#: The harness that owns `_verify_code`; still the official scoring path.
EVO_REPO = "/Users/lsmax/Coder/EvoAgentBench"
BENCH_SRC = f"{EVO_REPO}/benchmark/src"


def load_problem(pool: Path, task_id: str):
    for path in (pool, *sorted(pool.parent.glob("*.jsonl"))):
        if not path.is_file():
            continue
        with path.open() as handle:
            for line in handle:
                line = line.strip()
                if not line:
                    continue
                record = json.loads(line)
                if record.get("question_id") == task_id:
                    return record
    raise SystemExit(f"TASK_NOT_IN_POOL:{task_id}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pool", required=True)
    parser.add_argument("--task", required=True)
    parser.add_argument("--solution", required=True)
    parser.add_argument("--lcb-repo", default=DEFAULT_LCB_REPO)
    parser.add_argument("--timeout", type=int, default=6)
    args = parser.parse_args()

    solution = Path(args.solution)
    if not solution.is_file():
        # No submission is a graded failure, never an infrastructure pass.
        print(json.dumps({"passed": 0, "total": 0, "error": "SOLUTION_MISSING"}))
        return 1
    code = solution.read_text()

    # Both roots are needed: EVO_REPO resolves `benchmark.src...`, while
    # BENCH_SRC satisfies the `from domains.base import ...` inside livecode.py.
    for path in (EVO_REPO, BENCH_SRC, args.lcb_repo):
        if path not in sys.path:
            sys.path.insert(0, path)
    import benchmark.src.domains.code_implementation.livecode as livecode
    livecode._LCB_REPO = Path(args.lcb_repo)
    from lcb_runner.benchmarks.code_generation import CodeGenerationProblem

    problem = CodeGenerationProblem(**load_problem(Path(args.pool), args.task))
    result = livecode._verify_code(problem, code, timeout=args.timeout)

    total = result.get("total") or 0
    passed = result.get("passed") or 0
    print(json.dumps({k: result.get(k) for k in ("passed", "total", "reward", "error")}))
    # A zero-length suite means the tests never ran; refuse to call that a pass.
    return 0 if total > 0 and passed == total else 1


if __name__ == "__main__":
    raise SystemExit(main())
