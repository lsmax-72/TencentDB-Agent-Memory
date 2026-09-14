#!/usr/bin/env python3
"""Read-only readiness gate for a BrowseComp-Plus evaluation revision."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import platform
import shutil
import subprocess
import time
from pathlib import Path
from typing import Any


PINNED_EVO_REVISION = "948a17288782d5120778da16b4cf1cad9305d8b4"
REQUIRED_MODULES = ("datasets", "faiss", "fastmcp", "huggingface_hub", "tevatron", "torch", "transformers")
OPTIONAL_BM25_MODULES = ("pyserini",)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def split_counts(path: Path) -> tuple[int, int]:
    if not path.is_file():
        return 0, 0
    value = json.loads(path.read_text())
    clusters = value.get("clusters", {})
    return (
        sum(len(row.get("train", [])) for row in clusters.values()),
        sum(len(row.get("test", [])) for row in clusters.values()),
    )


def python_modules(python: Path) -> dict[str, bool]:
    program = (
        "import importlib.util,json;"
        f"print(json.dumps({{m: importlib.util.find_spec(m) is not None for m in {(REQUIRED_MODULES + OPTIONAL_BM25_MODULES)!r}}}))"
    )
    try:
        completed = subprocess.run([str(python), "-c", program], capture_output=True, text=True, timeout=30, check=True)
        return json.loads(completed.stdout)
    except (OSError, subprocess.SubprocessError, json.JSONDecodeError):
        return {name: False for name in REQUIRED_MODULES + OPTIONAL_BM25_MODULES}


def build_report(evo_repo: Path, python: Path, judge_mode: str, min_free_gb: float) -> dict[str, Any]:
    benchmark = evo_repo / "benchmark"
    split = benchmark / "data/splits/information_retrieval.json"
    dataset = benchmark / "data/BrowseComp-Plus/browsecomp_plus_decrypted.jsonl"
    index_dir = benchmark / "data/BrowseComp-Plus/indexes/qwen3-embedding-0.6b"
    index_files = sorted(index_dir.glob("corpus.*.pkl"))
    modules = python_modules(python)
    train_count, test_count = split_counts(split)
    try:
        revision = subprocess.run(
            ["git", "-C", str(evo_repo), "rev-parse", "HEAD"],
            capture_output=True, text=True, timeout=10, check=True,
        ).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        revision = None
    free_bytes = shutil.disk_usage(evo_repo).free if evo_repo.exists() else 0
    java = shutil.which("java")
    java_works = False
    if java:
        try:
            java_works = subprocess.run([java, "-version"], capture_output=True, timeout=10).returncode == 0
        except (OSError, subprocess.SubprocessError):
            pass

    checks = {
        "pinned_evo_revision": revision == PINNED_EVO_REVISION,
        "official_split_shape": (train_count, test_count) == (154, 65),
        "dataset_present": dataset.is_file(),
        "small_index_complete": len(index_files) == 4,
        "python_environment_present": python.is_file(),
        "faiss_python_modules_present": all(modules[name] for name in REQUIRED_MODULES),
        "disk_headroom": free_bytes >= int(min_free_gb * 1024**3),
        "judge_mode_frozen": judge_mode in {"exact_match", "llm_judge"},
    }
    reasons = [name.upper() for name, passed in checks.items() if not passed]
    report = {
        "schema": "tdai-evoagentbench-ir-preflight-v1",
        "status": "READY" if not reasons else "BLOCKED",
        "reasons": reasons,
        "read_only": True,
        "evo_repo": str(evo_repo),
        "expected_revision": PINNED_EVO_REVISION,
        "actual_revision": revision,
        "architecture": platform.machine(),
        "python": str(python),
        "python_modules": modules,
        "java": java,
        "optional_bm25": {"java_available": java_works, "pyserini_available": modules["pyserini"]},
        "judge_mode": judge_mode,
        "split": {
            "path": str(split), "sha256": sha256_file(split) if split.is_file() else None,
            "train": train_count, "test": test_count,
        },
        "dataset": {"path": str(dataset), "present": dataset.is_file()},
        "index": {"path": str(index_dir), "file_count": len(index_files), "bytes": sum(p.stat().st_size for p in index_files)},
        "disk": {"free_bytes": free_bytes, "minimum_free_bytes": int(min_free_gb * 1024**3)},
        "checks": checks,
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    encoded = json.dumps(report, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    report["artifact_hash"] = hashlib.sha256(encoded).hexdigest()
    return report


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--evo-repo", type=Path, default=Path("/Users/lsmax/Coder/EvoAgentBench"))
    parser.add_argument("--python", type=Path)
    parser.add_argument("--judge-mode", choices=("unresolved", "exact_match", "llm_judge"), default="unresolved")
    parser.add_argument("--min-free-gb", type=float, default=4.0)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    python = args.python or args.evo_repo / ".venv-tdai/bin/python"
    # Keep the venv entrypoint path intact. Resolving its interpreter symlink
    # would silently drop the virtual environment's site-packages.
    report = build_report(args.evo_repo.resolve(), python.expanduser().absolute(), args.judge_mode, args.min_free_gb)
    rendered = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)
        with os.fdopen(fd, "w") as handle:
            handle.write(rendered)
    print(rendered, end="")


if __name__ == "__main__":
    main()
