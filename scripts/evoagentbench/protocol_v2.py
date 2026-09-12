#!/usr/bin/env python3
"""Freeze the metadata-stratified discriminative development protocol."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
from collections import Counter
from pathlib import Path
from typing import Any

from .protocol import sha256_json, validate_frozen_protocol


PROTOCOL_ID = "tdai-evoagentbench-code-v2-discriminative"
QUOTAS = {"hard": 12, "medium": 8, "easy": 4}
SOURCE = Path("/Users/lsmax/Coder/evoagentbench-data/livecode/release_v6.json")
V1_PROTOCOL = Path(__file__).with_name("protocol-code-v1.json")
JQ_FILTER = r'''select((length == 2) and ((.[0] | length) == 2) and ((.[0][1] == "question_id") or (.[0][1] == "difficulty") or (.[0][1] == "platform") or (.[0][1] == "question_title")))'''


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(8 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_metadata(source: Path) -> list[dict[str, str]]:
    completed = subprocess.run(
        ["jq", "--stream", "-c", JQ_FILTER, str(source)],
        check=True,
        capture_output=True,
        text=True,
    )
    indexed: dict[int, dict[str, str]] = {}
    for line in completed.stdout.splitlines():
        path, value = json.loads(line)
        indexed.setdefault(int(path[0]), {})[str(path[1])] = str(value)
    required = {"question_id", "difficulty", "platform", "question_title"}
    rows = [row for _, row in sorted(indexed.items()) if required <= row.keys()]
    if not rows:
        raise ValueError("LIVECODE_METADATA_EMPTY")
    return rows


def build_protocol(split: dict[str, Any], metadata: list[dict[str, str]], v1: dict[str, Any], source_sha256: str) -> tuple[dict[str, Any], dict[str, Any]]:
    validate_frozen_protocol(v1, split)
    train = [str(item) for item in split["train"]]
    test = [str(item) for item in split["test"]]
    by_id = {row["question_id"]: row for row in metadata}
    missing = sorted(set(train) - by_id.keys())
    if missing:
        raise ValueError(f"TRAIN_METADATA_MISSING:{','.join(missing)}")

    excluded = set(v1["selection"]["experience"] + v1["selection"]["development"])
    eligible = [by_id[task_id] for task_id in train if task_id not in excluded]
    selected = []
    for difficulty, quota in QUOTAS.items():
        group = [row for row in eligible if row["difficulty"] == difficulty]
        group.sort(key=lambda row: hashlib.sha256(f"{PROTOCOL_ID}\0{difficulty}\0{row['question_id']}".encode()).hexdigest())
        if len(group) < quota:
            raise ValueError(f"DIFFICULTY_POOL_TOO_SMALL:{difficulty}")
        selected.extend(group[:quota])

    metadata_snapshot: dict[str, Any] = {
        "schema": "tdai-evoagentbench-code-metadata-v1",
        "release": "release_v6",
        "source_sha256": source_sha256,
        "official_train_rows": [by_id[task_id] for task_id in train],
    }
    metadata_snapshot["artifact_hash"] = sha256_json(metadata_snapshot)
    protocol: dict[str, Any] = {
        "protocol_id": PROTOCOL_ID,
        "protocol_revision": 2,
        "predecessor_protocol_id": v1["protocol_id"],
        "predecessor_protocol_hash": v1["protocol_hash"],
        "benchmark": {
            **v1["benchmark"],
            "dataset_source_sha256": source_sha256,
            "metadata_snapshot_hash": metadata_snapshot["artifact_hash"],
        },
        "selection": {
            "seed": PROTOCOL_ID,
            "algorithm": "difficulty quota, then sha256(seed\\0difficulty\\0task_id), ascending",
            "eligibility": "official train minus v1 experience and v1 development",
            "difficulty_quotas": QUOTAS,
            "eligible_count": len(eligible),
            "eligible_difficulty_counts": dict(sorted(Counter(row["difficulty"] for row in eligible).items())),
            "regression": v1["selection"]["development"],
            "development": [row["question_id"] for row in selected],
            "development_metadata": selected,
            "final_test": test,
            "test_checkpoint": v1["selection"]["test_checkpoint"],
        },
        "candidate": {
            "revision": 3,
            "artifact_hash": "789d040f5fbaba0b2561e05a9070a9ec2a1d32ed10c786e8a397cbe68fe5e181",
            "source_protocol_hash": v1["protocol_hash"],
            "refinement_allowed": False,
        },
        "regression_reference": {
            "main_attempt_id": "pilot-r3-main",
            "main_attempt_artifact_hash": "cef68f83856f46bcaeda801e36ffb6f1b9252bce0a4e00d5d8d2a21ed31242d0",
            "implementation_fix_attempt_id": "pilot-r3-implementation-fix-retry-1",
            "implementation_fix_attempt_artifact_hash": "97d05af30e9afae966263e5e86f2f1631ae238c4e973b04f71c7945b56139517",
        },
        "arms": v1["arms"],
        "retrieval": v1["retrieval"],
        "agent": v1["agent"],
        "pilot_gate": {
            "skill_transfer_gain_gt": 0,
            "newly_fixed_gte_newly_broken": True,
            "mean_token_or_turn_cost_increase_lte": 0.25,
        },
        "test_stop": v1["test_stop"],
        "strong_evidence": v1["strong_evidence"],
        "governance": v1["governance"],
    }
    protocol["protocol_hash"] = sha256_json(protocol)
    return protocol, metadata_snapshot


def validate_frozen_protocol_v2(protocol: dict[str, Any], split: dict[str, Any], metadata_snapshot: dict[str, Any]) -> None:
    expected_snapshot = dict(metadata_snapshot)
    snapshot_hash = expected_snapshot.pop("artifact_hash", None)
    if sha256_json(expected_snapshot) != snapshot_hash:
        raise ValueError("METADATA_SNAPSHOT_HASH_MISMATCH")
    v1 = json.loads(V1_PROTOCOL.read_text())
    expected, _ = build_protocol(split, metadata_snapshot["official_train_rows"], v1, metadata_snapshot["source_sha256"])
    if protocol != expected:
        raise ValueError("FROZEN_PROTOCOL_V2_MISMATCH")


def write_new(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)
    with os.fdopen(descriptor, "w") as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2)
        handle.write("\n")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--split", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--metadata-output", type=Path, required=True)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    split = json.loads(args.split.read_text())
    if args.check:
        validate_frozen_protocol_v2(
            json.loads(args.output.read_text()),
            split,
            json.loads(args.metadata_output.read_text()),
        )
        print(json.loads(args.output.read_text())["protocol_hash"])
        return
    metadata = load_metadata(SOURCE)
    protocol, snapshot = build_protocol(split, metadata, json.loads(V1_PROTOCOL.read_text()), sha256_file(SOURCE))
    write_new(args.metadata_output, snapshot)
    write_new(args.output, protocol)
    print(protocol["protocol_hash"])


if __name__ == "__main__":
    main()
