#!/usr/bin/env python3
"""Freeze a candidate-blind, capability-stratified four-arm train pilot."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
from collections import Counter
from pathlib import Path
from typing import Any

from .protocol import sha256_json
from .protocol_v4 import validate_frozen_protocol_v4


PROTOCOL_ID = "tdai-evoagentbench-code-v5-factorial-heldout"
ROOT = Path(__file__).resolve().parent
V4_FILE = ROOT / "protocol-code-v4.json"
METADATA_FILE = ROOT / "protocol-code-v2-metadata.json"
EXPERIENCE_PER_FAMILY = 8
DEVELOPMENT_PER_FAMILY = 4

# Classification uses only frozen public titles. It cannot observe a Candidate,
# a model response, verifier reward, or any prior development result.
FAMILY_RULES = (
    ("counting_frequency_sets", re.compile(r"count|pair|distinct|common|difference|triangle|set", re.I)),
    ("strings_grids_simulation", re.compile(
        r"string|substring|palindrome|prefix|hamming|grid|snuke|scheme|hands|pentagon|cat|walk|racecar|aaaadaa|santa|^ab$",
        re.I,
    )),
)
DEFAULT_FAMILY = "sequence_state_optimization"


def capability_family(title: str) -> str:
    return next((name for name, pattern in FAMILY_RULES if pattern.search(title)), DEFAULT_FAMILY)


def _select(rows: list[dict[str, str]], family: str, partition: str, count: int) -> list[dict[str, str]]:
    group = [row for row in rows if row["capability_family"] == family]
    group.sort(key=lambda row: hashlib.sha256(
        f"{PROTOCOL_ID}\0{partition}\0{family}\0{row['question_id']}".encode()
    ).hexdigest())
    if len(group) < count:
        raise ValueError(f"V5_CAPABILITY_POOL_TOO_SMALL:{family}:{partition}")
    return group[:count]


def build_protocol(
    split: dict[str, Any],
    metadata_snapshot: dict[str, Any],
    v4: dict[str, Any],
) -> dict[str, Any]:
    validate_frozen_protocol_v4(v4, split)
    train = {str(item) for item in split["train"]}
    rows = metadata_snapshot["official_train_rows"]
    if {row["question_id"] for row in rows} != train:
        raise ValueError("V5_METADATA_TRAIN_SET_MISMATCH")

    excluded = set(
        v4["selection"]["excluded_prior_train_ids"]
        + v4["selection"]["experience"]
        + v4["selection"]["development"]
    )
    remaining = [
        {**row, "capability_family": capability_family(row["question_title"])}
        for row in rows
        if row["question_id"] not in excluded
    ]
    families = tuple(name for name, _ in FAMILY_RULES) + (DEFAULT_FAMILY,)
    experience: list[dict[str, str]] = []
    development: list[dict[str, str]] = []
    for family in families:
        chosen_experience = _select(remaining, family, "experience", EXPERIENCE_PER_FAMILY)
        experience.extend(chosen_experience)
        experience_ids = {row["question_id"] for row in chosen_experience}
        heldout_pool = [row for row in remaining if row["question_id"] not in experience_ids]
        development.extend(_select(heldout_pool, family, "development", DEVELOPMENT_PER_FAMILY))

    selected = {row["question_id"] for row in experience + development}
    protocol: dict[str, Any] = {
        "protocol_id": PROTOCOL_ID,
        "protocol_revision": 5,
        "predecessors": [
            *v4.get("predecessors", []),
            {"protocol_id": v4["protocol_id"], "protocol_hash": v4["protocol_hash"]},
        ],
        "benchmark": v4["benchmark"],
        "selection": {
            "seed": PROTOCOL_ID,
            "algorithm": "title-only capability family, then sha256(seed\\0partition\\0family\\0task_id), ascending",
            "candidate_blind_fields": ["question_id", "question_title", "difficulty"],
            "excluded_prior_train_ids": sorted(excluded),
            "capability_rules": [
                {"family": name, "title_regex": pattern.pattern}
                for name, pattern in FAMILY_RULES
            ] + [{"family": DEFAULT_FAMILY, "title_regex": "default"}],
            "experience_per_family": EXPERIENCE_PER_FAMILY,
            "development_per_family": DEVELOPMENT_PER_FAMILY,
            "experience": [row["question_id"] for row in experience],
            "development": [row["question_id"] for row in development],
            "capability_assignments": {
                row["question_id"]: row["capability_family"]
                for row in sorted(experience + development, key=lambda item: item["question_id"])
            },
            "remaining_train_count": len(remaining) - len(selected),
            "remaining_difficulty_counts": dict(sorted(Counter(
                row["difficulty"] for row in remaining if row["question_id"] not in selected
            ).items())),
        },
        "arms": ["vanilla", "memory", "skill", "memory_skill"],
        "retrieval": {
            **v4["retrieval"],
            "combined_order": ["skill", "memory"],
            "combined_reuses_standalone_selection": True,
            "combined_top_k_per_kind": v4["retrieval"]["top_k"],
        },
        "candidate_generation": {
            "method": "trace2skill-local-patch-semantic-cluster-v2",
            "memory_revision": 1,
            "candidate_revision": 2,
            "minimum_independent_support": 2,
            "failed_trace_strategy_support": False,
            "development_or_test_visible": False,
            "cluster_algorithm": v4["candidate_generation"]["cluster_algorithm"],
            "cluster_minimum_similarity": v4["candidate_generation"]["cluster_minimum_similarity"],
        },
        "agent": v4["agent"],
        "pilot_gate": v4["pilot_gate"],
        "test_stop": v4["test_stop"],
        "strong_evidence": v4["strong_evidence"],
        "evidence_completeness": {
            "minimum_skill_retrieval_count": 1,
            "combined_selection_must_match_standalone": True,
            "zero_skill_exposure_result": "EFFECT_NOT_ATTRIBUTABLE",
        },
        "factorial_analysis": {
            "comparisons": [
                "memory-vs-vanilla", "skill-vs-vanilla", "memory_skill-vs-vanilla",
                "memory_skill-vs-memory", "memory_skill-vs-skill",
            ],
            "interaction_is_secondary": True,
            "combined_context_cost_is_reported": True,
        },
        "governance": {
            **v4["governance"],
            "suite_definition_unchanged_from_protocol_hash": None,
            "generation_revision_reason": "New candidate-blind capability-stratified train/development split; no prior Candidate output or reward used.",
            "official_test_locked_until_pilot_pass": True,
            "historical_results_mutable": False,
        },
    }
    protocol["protocol_hash"] = sha256_json(protocol)
    return protocol


def validate_frozen_protocol_v5(protocol: dict[str, Any], split: dict[str, Any]) -> None:
    expected = build_protocol(
        split,
        json.loads(METADATA_FILE.read_text()),
        json.loads(V4_FILE.read_text()),
    )
    if protocol != expected:
        raise ValueError("FROZEN_PROTOCOL_V5_MISMATCH")


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
        json.loads(V4_FILE.read_text()),
    )
    if args.check:
        validate_frozen_protocol_v5(json.loads(args.output.read_text()), split)
    else:
        write_new(args.output, protocol)
    print(protocol["protocol_hash"])


if __name__ == "__main__":
    main()
