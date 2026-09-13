#!/usr/bin/env python3
"""Freeze retrieval exposure before spending tokens on a four-arm pilot."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from .adapter import candidate_contamination
from .driver import DEFAULT_ROOT, PROTOCOL_FILE, _candidate_assets, canonical_hash, write_new
from .retrieval import select_assets, select_skill_assets_for_algorithm
from .subset_cache import validate as validate_phase_cache


def build(root: Path, candidate_revision: int) -> dict[str, Any]:
    protocol = json.loads(PROTOCOL_FILE.read_text())
    if "memory_skill" not in protocol.get("arms", []):
        raise ValueError("FACTORIAL_PROTOCOL_REQUIRED")
    cache_dir = validate_phase_cache(root, "development")
    if cache_dir is None:
        raise FileNotFoundError("DEVELOPMENT_PHASE_CACHE_REQUIRED")
    records = json.loads((cache_dir / "release_v6.json").read_text())
    by_id = {str(row["question_id"]): row for row in records}
    if set(by_id) != set(protocol["selection"]["development"]):
        raise ValueError("PREFLIGHT_TASK_SET_MISMATCH")

    memories, memory_hash = _candidate_assets(
        root, candidate_revision, "memory", protocol["protocol_hash"]
    )
    skills, skill_hash = _candidate_assets(
        root, candidate_revision, "skill", protocol["protocol_hash"]
    )
    if memory_hash != skill_hash:
        raise ValueError("PREFLIGHT_CANDIDATE_HASH_MISMATCH")

    rows = []
    for task_id in protocol["selection"]["development"]:
        prompt = str(by_id[task_id].get("question_content") or "")
        selected_skill, decisions = select_skill_assets_for_algorithm(
            prompt, skills, protocol["retrieval"]["skill_algorithm"],
            top_k=protocol["retrieval"]["top_k"],
        )
        selected_memory = select_assets(
            prompt, "memory", memories, top_k=protocol["retrieval"]["top_k"]
        )
        rows.append({
            "task_id": task_id,
            "capability_family": protocol["selection"]["capability_assignments"][task_id],
            "skill": [{"id": item["id"], "hash": item["content_hash"]} for item in selected_skill],
            "memory": [{"id": item["id"], "hash": item["content_hash"]} for item in selected_memory],
            "skill_decisions": decisions,
        })

    skill_hits = sum(bool(row["skill"]) for row in rows)
    minimum_hits = protocol["evidence_completeness"]["minimum_skill_retrieval_count"]
    contamination = candidate_contamination(
        json.dumps(skills, ensure_ascii=False), protocol["selection"]["development"]
    )
    status = "READY" if skill_hits >= minimum_hits and not contamination else "BLOCKED"
    reasons = []
    if skill_hits < minimum_hits:
        reasons.append("SKILL_TREATMENT_EXPOSURE_BELOW_MINIMUM")
    if contamination:
        reasons.append("CANDIDATE_DEVELOPMENT_CONTAMINATION")
    manifest = json.loads((cache_dir / "manifest.json").read_text())
    result = {
        "schema": "tdai-evoagentbench-factorial-preflight-v1",
        "status": status,
        "reasons": reasons,
        "protocol_id": protocol["protocol_id"],
        "protocol_hash": protocol["protocol_hash"],
        "candidate_revision": candidate_revision,
        "candidate_artifact_hash": skill_hash,
        "development_cache_artifact_hash": manifest["artifact_hash"],
        "skill_hit_task_count": skill_hits,
        "memory_hit_task_count": sum(bool(row["memory"]) for row in rows),
        "combined_selection_reuses_standalone": True,
        "combined_injection_order": protocol["retrieval"]["combined_order"],
        "contamination_findings": contamination,
        "tasks": rows,
    }
    result["artifact_hash"] = canonical_hash(result)
    return result


def validate(root: Path, candidate_revision: int) -> dict[str, Any]:
    path = root / "preflight" / f"factorial-r{candidate_revision}.json"
    if not path.is_file():
        raise FileNotFoundError("FACTORIAL_PREFLIGHT_REQUIRED")
    result = json.loads(path.read_text())
    unsigned = dict(result)
    artifact_hash = unsigned.pop("artifact_hash", None)
    protocol = json.loads(PROTOCOL_FILE.read_text())
    if canonical_hash(unsigned) != artifact_hash or result.get("protocol_hash") != protocol["protocol_hash"]:
        raise ValueError("FACTORIAL_PREFLIGHT_HASH_MISMATCH")
    if result.get("candidate_revision") != candidate_revision or result.get("status") != "READY":
        raise ValueError("FACTORIAL_PREFLIGHT_NOT_READY")
    if [row.get("task_id") for row in result.get("tasks", [])] != protocol["selection"]["development"]:
        raise ValueError("FACTORIAL_PREFLIGHT_TASK_SET_MISMATCH")
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=DEFAULT_ROOT)
    parser.add_argument("--candidate-revision", type=int, required=True)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if args.check:
        result = validate(args.root, args.candidate_revision)
    else:
        output = args.root / "preflight" / f"factorial-r{args.candidate_revision}.json"
        if output.exists():
            raise FileExistsError("IMMUTABLE_FACTORIAL_PREFLIGHT_ALREADY_EXISTS")
        result = build(args.root, args.candidate_revision)
        write_new(output, result)
    print(json.dumps({key: result[key] for key in (
        "status", "reasons", "skill_hit_task_count", "memory_hit_task_count", "artifact_hash"
    )}))


if __name__ == "__main__":
    main()
