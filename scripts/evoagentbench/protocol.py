#!/usr/bin/env python3
"""Freeze and validate the deterministic EvoAgentBench task protocol."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any


PROTOCOL_ID = "tdai-evoagentbench-code-v1"
EVOAGENTBENCH_REVISION = "948a17288782d5120778da16b4cf1cad9305d8b4"
LIVECODEBENCH_REVISION = "28fef95ea8c9f7a547c8329f2cd3d32b92c1fa24"


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sha256_json(value: Any) -> str:
    return hashlib.sha256(canonical_json(value).encode()).hexdigest()


def _ordered(task_ids: list[str], seed: str, partition: str) -> list[str]:
    return sorted(
        task_ids,
        key=lambda task_id: hashlib.sha256(
            f"{seed}\0{partition}\0{task_id}".encode()
        ).hexdigest(),
    )


def build_protocol(split: dict[str, list[str]]) -> dict[str, Any]:
    train = [str(item) for item in split.get("train", [])]
    test = [str(item) for item in split.get("test", [])]
    if len(train) != 182 or len(test) != 86:
        raise ValueError(f"PINNED_SPLIT_SIZE_MISMATCH: train={len(train)} test={len(test)}")
    if len(set(train)) != len(train) or len(set(test)) != len(test) or set(train) & set(test):
        raise ValueError("PINNED_SPLIT_NOT_DISJOINT")

    train_order = _ordered(train, PROTOCOL_ID, "train")
    test_order = _ordered(test, PROTOCOL_ID, "test")
    protocol: dict[str, Any] = {
        "protocol_id": PROTOCOL_ID,
        "protocol_revision": 1,
        "benchmark": {
            "name": "EvoAgentBench-compatible / Algorithmic Reasoning",
            "evoagentbench_revision": EVOAGENTBENCH_REVISION,
            "livecodebench_revision": LIVECODEBENCH_REVISION,
            "release": "release_v6",
            "split_hash": sha256_json({"train": train, "test": test}),
            "official_train_count": len(train),
            "official_test_count": len(test),
        },
        "selection": {
            "seed": PROTOCOL_ID,
            "algorithm": "sha256(seed\\0partition\\0task_id), ascending",
            "smoke": train_order[:2],
            "experience": train_order[:24],
            "development": train_order[24:36],
            "final_train": train,
            "test_checkpoint": test_order[:20],
            "final_test": test,
        },
        "arms": ["vanilla", "memory", "skill"],
        "retrieval": {
            "top_k": 2,
            "memory_source": "official_train_experience_only",
            "skill_source": "official_train_evidence_only",
            "test_records_observation_only": True,
        },
        "agent": {
            "host": "nanobot-ai==0.1.4.post3",
            "provider": "vllm-via-memory-proxy",
            "model": "qwen3.8-27b",
            "temperature": 0,
            "fallback": "disabled",
            "max_retries": 0,
            "agent_timeout_seconds": 1800,
            "test_timeout_seconds": 6,
            "max_tool_iterations": 12,
            "max_output_tokens_per_call": 8192,
            "context_window_tokens": 65536,
        },
        "pilot_gate": {
            "skill_transfer_gain_gt": 0,
            "newly_fixed_gte_newly_broken": True,
            "mean_token_or_turn_cost_increase_lte": 0.25,
            "max_skill_revisions": 2,
        },
        "test_stop": {
            "infrastructure_failure_rate_gt": 0.10,
            "skill_transfer_gain_lte": -0.10,
            "no_gain_and_cost_increase_gt": 0.50,
        },
        "strong_evidence": {
            "skill_transfer_gain_gt": 0,
            "paired_bootstrap_ci_lower_gt": 0,
            "newly_fixed_gt_newly_broken": True,
            "cost_increase_lte": 0.25,
        },
        "governance": {
            "promotion": "forbidden",
            "production_assets_mutable": False,
            "test_data_candidate_generation": False,
            "wiki_in_scope": False,
        },
    }
    protocol["protocol_hash"] = sha256_json(protocol)
    return protocol


def validate_frozen_protocol(protocol: dict[str, Any], split: dict[str, list[str]]) -> None:
    expected = build_protocol(split)
    if protocol != expected:
        raise ValueError("FROZEN_PROTOCOL_MISMATCH")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--split", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    split = json.loads(args.split.read_text())
    protocol = build_protocol(split)
    if args.check:
        validate_frozen_protocol(json.loads(args.output.read_text()), split)
        print(protocol["protocol_hash"])
        return
    if args.output.exists():
        raise FileExistsError("FROZEN_PROTOCOL_ALREADY_EXISTS")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(protocol, ensure_ascii=False, indent=2) + "\n")
    print(protocol["protocol_hash"])


if __name__ == "__main__":
    main()

