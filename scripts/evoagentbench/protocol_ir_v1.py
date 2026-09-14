#!/usr/bin/env python3
"""Freeze a candidate-blind, low-cost BrowseComp-Plus calibration protocol."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
from typing import Any

from .protocol import sha256_json


PROTOCOL_ID = "tdai-evoagentbench-ir-v1-low-cost-calibration"
SEED = "tdai-evoagentbench-ir-v1"
CLUSTERS = ("GEO_LANDMARK", "HISTORICAL_FIGURE", "MUSIC_PERSON", "RESEARCH_PAPER")
EVO_REVISION = "948a17288782d5120778da16b4cf1cad9305d8b4"


def file_hash(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def select_tasks(split: dict[str, Any]) -> dict[str, Any]:
    clusters = split.get("clusters", {})
    selected: dict[str, dict[str, list[str]]] = {}
    experience: list[str] = []
    development: list[str] = []
    for name in CLUSTERS:
        row = clusters.get(name)
        if not row or len(row.get("train", [])) < 3:
            raise ValueError(f"IR_CLUSTER_TOO_SMALL:{name}")
        pool = sorted(
            (str(value) for value in row["train"]),
            key=lambda value: hashlib.sha256(f"{SEED}:{name}:{value}".encode()).hexdigest(),
        )
        selected[name] = {"experience": pool[:2], "development": pool[2:3]}
        experience.extend(pool[:2])
        development.extend(pool[2:3])
    if set(experience) & set(development):
        raise ValueError("IR_SELECTION_OVERLAP")
    official_test = {
        str(value)
        for row in clusters.values()
        for value in row.get("test", [])
    }
    if (set(experience) | set(development)) & official_test:
        raise ValueError("IR_TEST_CONTAMINATION")
    return {
        "seed": SEED,
        "cluster_order": list(CLUSTERS),
        "by_cluster": selected,
        "smoke": [experience[0]],
        "experience": experience,
        "development": development,
        "official_test": [],
    }


def build_protocol(split_path: Path, evo_benchmark: Path) -> dict[str, Any]:
    split = json.loads(split_path.read_text())
    domain = evo_benchmark / "src/domains/information_retrieval"
    protocol = {
        "schema": "tdai-evoagentbench-ir-protocol-v1",
        "protocol_id": PROTOCOL_ID,
        "protocol_revision": 1,
        "benchmark": {
            "name": "EvoAgentBench-compatible / Information Retrieval",
            "dataset": "BrowseComp-Plus",
            "evoagentbench_revision": EVO_REVISION,
            "official_split_hash": file_hash(split_path),
            "official_train_count": 154,
            "official_test_count": 65,
            "official_adapter_hash": file_hash(domain / "browsecomp_plus.py"),
            "official_prompt_hash": file_hash(domain / "prompt.md"),
            "official_config_hash": file_hash(domain / "information_retrieval.yaml"),
            "official_test_opened": False,
        },
        "selection": select_tasks(split),
        "arms": ["vanilla", "memory", "skill", "memory_skill"],
        "agent": {
            "host": "nanobot-ai==0.1.4.post3",
            "provider": "vllm-via-memory-proxy",
            "model": "qwen3.8-27b",
            "temperature": 0,
            "fallback": "disabled",
            "max_retries": 0,
            "agent_timeout_seconds": 900,
            "max_tool_iterations": 8,
            "max_output_tokens_per_call": 4096,
            "context_window_tokens": 65536,
        },
        "judge": {
            "primary": "llm_judge",
            "model": "qwen3.8-27b",
            "provider": "vllm-via-isolated-memory-proxy",
            "temperature": 0,
            "max_output_tokens": 2048,
            "fallback": "disabled",
            "shadow_metric": "normalized_exact_match",
            "judge_usage_separate_from_agent_usage": True,
        },
        "retrieval_environment": {
            "searcher": "faiss",
            "index": "qwen3-embedding-0.6b",
            "search_top_k": 5,
            "snippet_max_tokens": 512,
            "network_search_disabled": True,
        },
        "candidate_generation": {
            "source": "experience_only",
            "memory_per_task_max": 1,
            "skill_min_independent_support": 2,
            "skill_count_max": 4,
            "semantic_revisions_max": 1,
            "development_or_test_visible": False,
        },
        "candidate_retrieval": {
            "top_k_per_kind": 2,
            "combined_order": ["skill", "memory"],
            "combined_reuses_standalone_selection": True,
        },
        "calibration_gate": {
            "smoke_requires": [
                "evaluation_auxiliary_isolation",
                "complete_usage",
                "at_least_one_real_search_tool_event",
                "llm_judge_result",
                "exact_match_shadow_result",
            ],
            "development_requires": [
                "zero_infra_error",
                "candidate_retrieval_coverage_gt_zero",
                "vanilla_pass_count_lt_four",
                "formal_asset_snapshot_unchanged",
            ],
            "stop_after_development": True,
            "promotion_allowed": False,
        },
        "governance": {
            "research_only": True,
            "candidate_evaluation_only": True,
            "historical_attempts_immutable": True,
            "test_traces_cannot_generate_assets": True,
            "no_suite_change_after_first_run": True,
        },
    }
    protocol["protocol_hash"] = sha256_json(protocol)
    return protocol


def validate(protocol: dict[str, Any], split_path: Path, evo_benchmark: Path) -> None:
    if protocol != build_protocol(split_path, evo_benchmark):
        raise ValueError("FROZEN_IR_PROTOCOL_MISMATCH")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--split", type=Path, required=True)
    parser.add_argument("--evo-benchmark", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    protocol = build_protocol(args.split, args.evo_benchmark)
    if args.check:
        validate(json.loads(args.output.read_text()), args.split, args.evo_benchmark)
    else:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)
        with os.fdopen(fd, "w") as handle:
            json.dump(protocol, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
    print(protocol["protocol_hash"])


if __name__ == "__main__":
    main()
