#!/usr/bin/env python3
"""LiveCodeBench grader for the evolution evaluation binding.

This replaces the whole EvoAgentBench driver stack that used to live in
``scripts/evoagentbench/``. All of it -- the driver, the proxy bridge, the CLI
shim, the hand-rolled retrieve/inject/extract layer -- existed only because the
benchmark could not reuse the product's own evaluation path. What is genuinely
this project's own is *grading an external suite*: everything else is line A's
``MinimalEvaluationRunner`` + ``NanobotAgentAdapter``.

Grading is delegated to LiveCodeBench's own scorer, ``check_correctness``. The
previous version imported ``benchmark.src.domains.code_implementation.livecode``
from a checkout that only existed on the author's laptop, so inside the
evaluation container every graded arm died with ``ModuleNotFoundError``. That
was recorded as an ordinary task failure, which made a broken instrument look
like a null effect.

Exit codes are part of the contract, because the Oracle asserts on them:

  0  every test passed
  1  a graded failure: no submission, or the submission failed its tests
  2  the grader itself could not run (missing repo, unloadable task, checker
     crash). The fixture adapter turns this into an INFRA_ERROR, never a
     task failure, so an unvalidated instrument can never report a null effect.

Usage:
  benchmark_code_grader.py --pool <pool.jsonl> --task <id> \
      --solution <workspace>/solution.py [--lcb-repo <dir>] [--timeout 6]
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

#: Exit code that means "the instrument failed", not "the submission failed".
GRADER_UNAVAILABLE = 2

#: Search order for the LiveCodeBench checkout that owns `lcb_runner`.
DEFAULT_LCB_REPOS = ("/opt/lcb", "/Users/lsmax/Coder/LiveCodeBench")


def resolve_lcb_repo(explicit: str | None) -> Path:
    candidates = [explicit, os.environ.get("LCB_REPO"), *DEFAULT_LCB_REPOS]
    for candidate in candidates:
        if not candidate:
            continue
        root = Path(candidate)
        if (root / "lcb_runner").is_dir():
            return root
    raise RuntimeError(f"no LiveCodeBench checkout with lcb_runner; tried {[c for c in candidates if c]}")


def load_problem(pool: Path, task_id: str):
    paths = [pool, *sorted(pool.parent.glob("*.jsonl"))] if pool.parent.is_dir() else [pool]
    for path in paths:
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
    raise RuntimeError(f"TASK_NOT_IN_POOL:{task_id} in {pool}")


def grade(args: argparse.Namespace) -> int:
    solution = Path(args.solution)
    if not solution.is_file():
        # No submission is a graded failure, never an infrastructure pass.
        print(json.dumps({"passed": 0, "total": 0, "error": "SOLUTION_MISSING"}))
        return 1
    code = solution.read_text()

    lcb_repo = resolve_lcb_repo(args.lcb_repo)
    if str(lcb_repo) not in sys.path:
        sys.path.insert(0, str(lcb_repo))
    from lcb_runner.benchmarks.code_generation import CodeGenerationProblem
    from lcb_runner.evaluation.compute_code_generation_metrics import check_correctness

    problem = CodeGenerationProblem(**load_problem(Path(args.pool), args.task))
    sample = problem.get_evaluation_sample()
    # A checker crash is not a verdict on the submission; `check_correctness`
    # already scores syntax and runtime errors as ordinary failures, so anything
    # that escapes it is the harness misbehaving.
    result_list, _metadata = check_correctness(sample, code, timeout=args.timeout)

    results = [r is True or r == 1 for r in result_list]
    total = len(results)
    passed = sum(1 for r in results if r)
    print(json.dumps({"passed": passed, "total": total, "reward": 1.0 if total and passed == total else 0.0}))
    # A zero-length suite means the tests never ran; refuse to call that a pass.
    return 0 if total > 0 and passed == total else 1


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pool", required=True)
    parser.add_argument("--task", required=True)
    parser.add_argument("--solution", required=True)
    parser.add_argument("--lcb-repo", default=None)
    parser.add_argument("--timeout", type=int, default=6)
    args = parser.parse_args()

    try:
        return grade(args)
    except Exception as error:  # noqa: BLE001 - the exit code is the contract
        print(f"GRADER_UNAVAILABLE:{type(error).__name__}:{error}")
        return GRADER_UNAVAILABLE


if __name__ == "__main__":
    raise SystemExit(main())
