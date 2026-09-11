#!/usr/bin/env python3
"""Paired transfer metrics for the frozen three-arm research protocol."""

from __future__ import annotations

import hashlib
import random
from statistics import mean
from typing import Any


def classify(vanilla: dict[str, Any], evolved: dict[str, Any]) -> str:
    if "INFRA_ERROR" in {vanilla["status"], evolved["status"]}:
        return "incomparable"
    before, after = vanilla["reward"] == 1, evolved["reward"] == 1
    if not before and after:
        return "newly_fixed"
    if before and not after:
        return "newly_broken"
    return "unchanged_success" if before else "unchanged_failure"


def _bootstrap_ci(deltas: list[float], seed: str, samples: int = 10_000) -> list[float] | None:
    if not deltas:
        return None
    rng = random.Random(int(hashlib.sha256(seed.encode()).hexdigest(), 16))
    estimates = sorted(mean(rng.choice(deltas) for _ in deltas) for _ in range(samples))
    return [estimates[int(samples * 0.025)], estimates[min(samples - 1, int(samples * 0.975))]]


def _totals(rows: list[dict[str, Any]]) -> dict[str, Any]:
    fields = ("total_tokens", "model_call_count", "tool_call_count")
    totals: dict[str, Any] = {field: 0 for field in fields}
    totals["elapsed_ms"] = 0
    for row in rows:
        for field in fields:
            value = row["usage"].get(field)
            if value is None:
                totals[field] = None
            elif totals[field] is not None:
                totals[field] += value
        totals["elapsed_ms"] += row.get("elapsed_ms", 0)
    return totals


def compare(arms: dict[str, list[dict[str, Any]]], seed: str) -> dict[str, Any]:
    if set(arms) != {"vanilla", "memory", "skill"}:
        raise ValueError("THREE_ARMS_REQUIRED")
    indexed = {}
    for arm, rows in arms.items():
        keys = [(row["task_id"], row["trial"]) for row in rows]
        if len(keys) != len(set(keys)):
            raise ValueError("DUPLICATE_ARM_TRIAL")
        indexed[arm] = {key: row for key, row in zip(keys, rows, strict=True)}
    keys = set(indexed["vanilla"])
    if any(set(rows) != keys for rows in indexed.values()):
        raise ValueError("PAIRED_TASK_SET_MISMATCH")

    comparisons: dict[str, Any] = {}
    for arm in ("memory", "skill"):
        pairs = []
        for key in sorted(keys):
            vanilla, evolved = indexed["vanilla"][key], indexed[arm][key]
            if vanilla["protocol_hash"] != evolved["protocol_hash"]:
                raise ValueError("PAIR_PROTOCOL_HASH_MISMATCH")
            classification = classify(vanilla, evolved)
            pairs.append({
                "case_ref": {"id": key[0], "trial": key[1]},
                "baseline": {"status": vanilla["status"], "reward": vanilla["reward"], "usage": vanilla["usage"]},
                "candidate": {"status": evolved["status"], "reward": evolved["reward"], "usage": evolved["usage"]},
                "classification": classification,
            })
        comparable = [pair for pair in pairs if pair["classification"] != "incomparable"]
        deltas = [pair["candidate"]["reward"] - pair["baseline"]["reward"] for pair in comparable]
        counts = {name: sum(pair["classification"] == name for pair in pairs) for name in (
            "newly_fixed", "newly_broken", "unchanged_success", "unchanged_failure", "incomparable"
        )}
        comparisons[arm] = {
            "pairs": pairs,
            "counts": counts,
            "transfer_gain": mean(deltas) if deltas else None,
            "paired_bootstrap_95_ci": _bootstrap_ci(deltas, f"{seed}:{arm}"),
            "pass_at_1": mean(row["reward"] for row in indexed[arm].values()) if keys else None,
        }

    costs = {arm: _totals(list(indexed[arm].values())) for arm in indexed}
    for arm in ("memory", "skill"):
        baseline_tokens, arm_tokens = costs["vanilla"]["total_tokens"], costs[arm]["total_tokens"]
        comparisons[arm]["token_cost_change"] = (
            (arm_tokens - baseline_tokens) / baseline_tokens
            if isinstance(baseline_tokens, int) and baseline_tokens > 0 and isinstance(arm_tokens, int)
            else None
        )
    return {"comparisons": comparisons, "cost_summary": costs}
