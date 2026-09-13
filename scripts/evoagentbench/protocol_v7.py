#!/usr/bin/env python3
"""Version train-only decision-principle review without changing the v5 suite."""

from __future__ import annotations

import argparse
import json
import os
from copy import deepcopy
from pathlib import Path
from typing import Any

from .protocol import sha256_json
from .protocol_v6 import validate_frozen_protocol_v6
from .trace_cluster_review import PRINCIPLE_CLUSTER_ALGORITHM


PROTOCOL_ID = "tdai-evoagentbench-code-v5-factorial-generation-v3"
ROOT = Path(__file__).resolve().parent
V6_FILE = ROOT / "protocol-code-v6.json"
SOURCE_FILE = ROOT / "protocol-code-v7-source.json"


def build_protocol(v6: dict[str, Any], source: dict[str, Any]) -> dict[str, Any]:
    if source.get("predecessor_protocol_hash") != v6.get("protocol_hash"):
        raise ValueError("V7_SOURCE_PROTOCOL_MISMATCH")
    if source.get("source_task_count") != len(v6["selection"]["experience"]):
        raise ValueError("V7_SOURCE_TASK_COUNT_MISMATCH")
    if source.get("source_pass_count", 0) + source.get("source_fail_count", 0) != source["source_task_count"]:
        raise ValueError("V7_SOURCE_OUTCOME_COUNT_MISMATCH")
    if source.get("source_infra_error_count") != 0 or source.get("source_cluster_count") != 0:
        raise ValueError("V7_SOURCE_NOT_ELIGIBLE_FOR_PRINCIPLE_REVIEW")
    protocol = deepcopy(v6)
    protocol["protocol_id"] = PROTOCOL_ID
    protocol["protocol_revision"] = 7
    protocol["predecessors"] = [
        *v6.get("predecessors", []),
        {"protocol_id": v6["protocol_id"], "protocol_hash": v6["protocol_hash"]},
    ]
    protocol["candidate_generation"] = {
        "method": "trace2skill-transferable-principle-review-v4",
        "memory_revision": 1,
        "candidate_revision": 2,
        "minimum_independent_support": 2,
        "failed_trace_strategy_support": False,
        "development_or_test_visible": False,
        "cluster_algorithm": PRINCIPLE_CLUSTER_ALGORITHM,
        "pair_proposal": "mutual-nearest-tfidf-within-prefrozen-capability-family",
        "review_temperature": 0,
        "source_protocol_hash": source["source_memory_protocol_hash"],
        "source_memory_artifact_hash": source["source_memory_artifact_hash"],
        "source_patch_artifact_hash": source["source_patch_artifact_hash"],
        "source_task_count": source["source_task_count"],
        "source_proposal_count": source["source_proposal_count"],
        "source_cluster_count": source["source_cluster_count"],
    }
    protocol["governance"] = {
        **v6["governance"],
        "generation_revision_reason": (
            "The concrete-procedure review rejected all train-only pairs; review the "
            "same frozen proposals at the transferable decision-principle level without "
            "exposing development data."
        ),
    }
    protocol.pop("protocol_hash", None)
    protocol["protocol_hash"] = sha256_json(protocol)
    return protocol


def validate_frozen_protocol_v7(protocol: dict[str, Any], split: dict[str, Any]) -> None:
    v6 = json.loads(V6_FILE.read_text())
    validate_frozen_protocol_v6(v6, split)
    expected = build_protocol(v6, json.loads(SOURCE_FILE.read_text()))
    if protocol != expected:
        raise ValueError("FROZEN_PROTOCOL_V7_MISMATCH")


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
    v6 = json.loads(V6_FILE.read_text())
    validate_frozen_protocol_v6(v6, split)
    protocol = build_protocol(v6, json.loads(SOURCE_FILE.read_text()))
    if args.check:
        validate_frozen_protocol_v7(json.loads(args.output.read_text()), split)
    else:
        write_new(args.output, protocol)
    print(protocol["protocol_hash"])


if __name__ == "__main__":
    main()
