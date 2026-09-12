#!/usr/bin/env python3
"""Build an immutable phase cache from the official local LiveCodeBench cache."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path

from .protocol import sha256_json


SOURCE = Path("/Users/lsmax/Coder/evoagentbench-data/livecode/release_v6.json")
PROTOCOL_FILE = Path(__file__).with_name("protocol-code-v1.json")


def write_new(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)
    with os.fdopen(descriptor, "w") as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2)
        handle.write("\n")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(8 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def build(root: Path, phase: str) -> dict[str, object]:
    protocol = json.loads(PROTOCOL_FILE.read_text())
    selected_ids = protocol["selection"][phase]
    cache_dir = root / "phase-cache" / phase
    cache_path = cache_dir / "release_v6.json"
    manifest_path = cache_dir / "manifest.json"
    if cache_path.exists() or manifest_path.exists():
        raise FileExistsError("IMMUTABLE_PHASE_CACHE_ALREADY_EXISTS")
    with SOURCE.open() as handle:
        records = json.load(handle)
    by_id = {str(record.get("question_id")): record for record in records}
    missing = [task_id for task_id in selected_ids if task_id not in by_id]
    if missing:
        raise ValueError(f"PHASE_TASKS_MISSING:{','.join(missing)}")
    subset = [by_id[task_id] for task_id in selected_ids]
    cache_dir.mkdir(parents=True, mode=0o700)
    write_new(cache_path, subset)
    manifest = {
        "schema": "tdai-evoagentbench-phase-cache-v1", "phase": phase,
        "protocol_hash": protocol["protocol_hash"], "source_path": str(SOURCE),
        "source_size": SOURCE.stat().st_size, "source_sha256": sha256_file(SOURCE),
        "source_record_count": len(records), "selected_task_ids": selected_ids,
        "selected_record_hashes": {task_id: sha256_json(by_id[task_id]) for task_id in selected_ids},
        "cache_sha256": sha256_file(cache_path),
    }
    manifest["artifact_hash"] = sha256_json(manifest)
    write_new(manifest_path, manifest)
    os.chmod(cache_path, 0o444)
    os.chmod(manifest_path, 0o444)
    return manifest


def validate(root: Path, phase: str) -> Path | None:
    protocol = json.loads(PROTOCOL_FILE.read_text())
    cache_dir = root / "phase-cache" / phase
    cache_path, manifest_path = cache_dir / "release_v6.json", cache_dir / "manifest.json"
    if not cache_path.exists() and not manifest_path.exists():
        return None
    if not cache_path.is_file() or not manifest_path.is_file():
        raise ValueError("PHASE_CACHE_INCOMPLETE")
    manifest = json.loads(manifest_path.read_text())
    expected = dict(manifest)
    artifact_hash = expected.pop("artifact_hash", None)
    if sha256_json(expected) != artifact_hash or manifest.get("protocol_hash") != protocol["protocol_hash"]:
        raise ValueError("PHASE_CACHE_MANIFEST_MISMATCH")
    if manifest.get("selected_task_ids") != protocol["selection"][phase] or sha256_file(cache_path) != manifest.get("cache_sha256"):
        raise ValueError("PHASE_CACHE_CONTENT_MISMATCH")
    return cache_dir


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--phase", choices=["development", "test_checkpoint", "final_test"], required=True)
    args = parser.parse_args()
    print(json.dumps(build(args.root, args.phase)))


if __name__ == "__main__":
    main()
