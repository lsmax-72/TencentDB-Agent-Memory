#!/usr/bin/env python3
"""Freeze a four-arm pilot using independent frozen Memory and Skill sources."""

from __future__ import annotations

import argparse
import json
import os
from copy import deepcopy
from pathlib import Path
from typing import Any

from .protocol import sha256_json
from .protocol_v7 import validate_frozen_protocol_v7


PROTOCOL_ID = "tdai-evoagentbench-code-v5-factorial-frozen-composite-v1"
ROOT = Path(__file__).resolve().parent
V7_FILE = ROOT / "protocol-code-v7.json"
SOURCE_FILE = ROOT / "protocol-code-v8-source.json"


def build_protocol(v7: dict[str, Any], source: dict[str, Any]) -> dict[str, Any]:
    if source.get("predecessor_protocol_hash") != v7.get("protocol_hash"):
        raise ValueError("V8_SOURCE_PROTOCOL_MISMATCH")
    if source.get("source_principle_cluster_count") != 0:
        raise ValueError("V8_SOURCE_PRINCIPLE_RESULT_MISMATCH")
    if source.get("source_skill_count") != 1 or source.get("source_skill_current_development_visible"):
        raise ValueError("V8_SKILL_SOURCE_NOT_CANDIDATE_BLIND")
    protocol = deepcopy(v7)
    protocol["protocol_id"] = PROTOCOL_ID
    protocol["protocol_revision"] = 8
    protocol["predecessors"] = [
        *v7.get("predecessors", []),
        {"protocol_id": v7["protocol_id"], "protocol_hash": v7["protocol_hash"]},
    ]
    protocol["candidate_generation"] = {
        "method": "compose-independent-frozen-memory-and-skill-v1",
        "candidate_revision": 2,
        "development_or_test_visible": False,
        "composition_model_calls": 0,
        "source_memory_protocol_hash": source["source_memory_protocol_hash"],
        "source_memory_artifact_hash": source["source_memory_artifact_hash"],
        "source_skill_candidate_hash": source["source_skill_candidate_hash"],
        "source_skill_projection_hash": source["source_skill_projection_hash"],
        "source_skill_projection_algorithm": source["source_skill_projection_algorithm"],
        "source_skill_count": source["source_skill_count"],
        "source_principle_review_artifact_hash": source["source_principle_review_artifact_hash"],
    }
    protocol["governance"] = {
        **v7["governance"],
        "generation_revision_reason": (
            "The current train sample produced no supported Skill. Compose its frozen "
            "Memory with the latest previously reviewed modular Skill, which was frozen "
            "before this held-out suite was selected."
        ),
    }
    protocol.pop("protocol_hash", None)
    protocol["protocol_hash"] = sha256_json(protocol)
    return protocol


def validate_frozen_protocol_v8(protocol: dict[str, Any], split: dict[str, Any]) -> None:
    v7 = json.loads(V7_FILE.read_text())
    validate_frozen_protocol_v7(v7, split)
    expected = build_protocol(v7, json.loads(SOURCE_FILE.read_text()))
    if protocol != expected:
        raise ValueError("FROZEN_PROTOCOL_V8_MISMATCH")


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
    v7 = json.loads(V7_FILE.read_text())
    validate_frozen_protocol_v7(v7, split)
    protocol = build_protocol(v7, json.loads(SOURCE_FILE.read_text()))
    if args.check:
        validate_frozen_protocol_v8(json.loads(args.output.read_text()), split)
    else:
        write_new(args.output, protocol)
    print(protocol["protocol_hash"])


if __name__ == "__main__":
    main()
