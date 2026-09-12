#!/usr/bin/env python3
"""Freeze a fresh train/development protocol for Trace2Skill evaluation."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from collections import Counter
from pathlib import Path
from typing import Any

from .protocol import sha256_json, validate_frozen_protocol
from .protocol_v2 import validate_frozen_protocol_v2


PROTOCOL_ID = "tdai-evoagentbench-code-v3-trace2skill"
EXPERIENCE_QUOTAS = {"hard": 4, "medium": 20, "easy": 24}
DEVELOPMENT_QUOTAS = {"hard": 4, "medium": 10, "easy": 10}
ROOT = Path(__file__).resolve().parent
V1_FILE = ROOT / "protocol-code-v1.json"
V2_FILE = ROOT / "protocol-code-v2.json"
METADATA_FILE = ROOT / "protocol-code-v2-metadata.json"


def _select(
    rows: list[dict[str, str]],
    excluded: set[str],
    quotas: dict[str, int],
    partition: str,
) -> list[dict[str, str]]:
    selected = []
    for difficulty, quota in quotas.items():
        group = [
            row for row in rows
            if row["question_id"] not in excluded and row["difficulty"] == difficulty
        ]
        group.sort(key=lambda row: hashlib.sha256(
            f"{PROTOCOL_ID}\0{partition}\0{difficulty}\0{row['question_id']}".encode()
        ).hexdigest())
        if len(group) < quota:
            raise ValueError(f"TRACE2SKILL_{partition.upper()}_POOL_TOO_SMALL:{difficulty}")
        chosen = group[:quota]
        selected.extend(chosen)
        excluded.update(row["question_id"] for row in chosen)
    return selected


def build_protocol(
    split: dict[str, Any],
    metadata_snapshot: dict[str, Any],
    v1: dict[str, Any],
    v2: dict[str, Any],
) -> dict[str, Any]:
    validate_frozen_protocol(v1, split)
    validate_frozen_protocol_v2(v2, split, metadata_snapshot)
    rows = metadata_snapshot["official_train_rows"]
    train = set(str(item) for item in split["train"])
    if {row["question_id"] for row in rows} != train:
        raise ValueError("TRACE2SKILL_METADATA_TRAIN_SET_MISMATCH")
    excluded = set(
        v1["selection"]["experience"]
        + v1["selection"]["development"]
        + v2["selection"]["development"]
    )
    prior_ids = sorted(excluded)
    experience = _select(rows, excluded, EXPERIENCE_QUOTAS, "experience")
    development = _select(rows, excluded, DEVELOPMENT_QUOTAS, "development")
    remaining = [row for row in rows if row["question_id"] not in excluded]
    protocol: dict[str, Any] = {
        "protocol_id": PROTOCOL_ID,
        "protocol_revision": 3,
        "predecessors": [
            {"protocol_id": v1["protocol_id"], "protocol_hash": v1["protocol_hash"]},
            {"protocol_id": v2["protocol_id"], "protocol_hash": v2["protocol_hash"]},
        ],
        "benchmark": {
            **v1["benchmark"],
            "metadata_snapshot_hash": metadata_snapshot["artifact_hash"],
        },
        "selection": {
            "seed": PROTOCOL_ID,
            "algorithm": "difficulty quota, then sha256(seed\\0partition\\0difficulty\\0task_id), ascending",
            "excluded_prior_train_ids": prior_ids,
            "experience_quotas": EXPERIENCE_QUOTAS,
            "development_quotas": DEVELOPMENT_QUOTAS,
            "experience": [row["question_id"] for row in experience],
            "development": [row["question_id"] for row in development],
            "remaining_train_count": len(remaining),
            "remaining_difficulty_counts": dict(sorted(Counter(row["difficulty"] for row in remaining).items())),
        },
        "arms": v1["arms"],
        "retrieval": {
            **v1["retrieval"],
            "skill_algorithm": "lexical-idf-applicability-v6",
            "memory_algorithm": "lexical-idf-v1",
        },
        "candidate_generation": {
            "method": "trace2skill-local-patch-cluster-v1",
            "memory_revision": 1,
            "candidate_revision": 2,
            "minimum_independent_support": 2,
            "failed_trace_strategy_support": False,
            "development_or_test_visible": False,
        },
        "agent": v1["agent"],
        "pilot_gate": v1["pilot_gate"],
        "test_stop": v1["test_stop"],
        "strong_evidence": v1["strong_evidence"],
        "governance": {
            **v1["governance"],
            "official_test_locked_until_pilot_pass": True,
            "historical_results_mutable": False,
        },
    }
    protocol["protocol_hash"] = sha256_json(protocol)
    return protocol


def validate_frozen_protocol_v3(protocol: dict[str, Any], split: dict[str, Any]) -> None:
    expected = build_protocol(
        split,
        json.loads(METADATA_FILE.read_text()),
        json.loads(V1_FILE.read_text()),
        json.loads(V2_FILE.read_text()),
    )
    if protocol != expected:
        raise ValueError("FROZEN_PROTOCOL_V3_MISMATCH")


def write_new(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)
    with os.fdopen(descriptor, "w") as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2)
        handle.write("\n")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--split", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    split = json.loads(args.split.read_text())
    protocol = build_protocol(
        split,
        json.loads(METADATA_FILE.read_text()),
        json.loads(V1_FILE.read_text()),
        json.loads(V2_FILE.read_text()),
    )
    if args.check:
        validate_frozen_protocol_v3(json.loads(args.output.read_text()), split)
    else:
        write_new(args.output, protocol)
    print(protocol["protocol_hash"])


if __name__ == "__main__":
    main()
