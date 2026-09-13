#!/usr/bin/env python3
"""Freeze current train Memory with a previously frozen, candidate-blind Skill."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any

from .driver import canonical_hash
from .protocol import sha256_json


def _write_new(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w") as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2)
        handle.write("\n")


def _load_candidate(path: Path) -> tuple[dict[str, Any], list[dict[str, Any]], list[dict[str, Any]]]:
    manifest = json.loads((path / "manifest.json").read_text())
    memories = json.loads((path / "memories.json").read_text())
    skills = json.loads((path / "skills.json").read_text())
    unsigned = dict(manifest)
    artifact_hash = unsigned.pop("artifact_hash", None)
    if sha256_json({"manifest": unsigned, "memories": memories, "skills": skills}) != artifact_hash:
        raise ValueError("COMPOSITE_MEMORY_SOURCE_HASH_MISMATCH")
    return manifest, memories, skills


def _load_skill_projection(path: Path) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    manifest = json.loads((path / "manifest.json").read_text())
    skills = json.loads((path / "skills.json").read_text())
    unsigned = dict(manifest)
    artifact_hash = unsigned.pop("artifact_hash", None)
    if sha256_json({"manifest": unsigned, "skills": skills}) != artifact_hash:
        raise ValueError("COMPOSITE_SKILL_SOURCE_HASH_MISMATCH")
    return manifest, skills


def freeze_composite(
    memory_source: Path,
    skill_source: Path,
    output: Path,
    protocol_file: Path,
) -> dict[str, Any]:
    if output.exists():
        raise FileExistsError("COMPOSITE_CANDIDATE_ALREADY_EXISTS")
    protocol = json.loads(protocol_file.read_text())
    generation = protocol.get("candidate_generation", {})
    memory_manifest, memories, source_memory_skills = _load_candidate(memory_source)
    skill_manifest, skills = _load_skill_projection(skill_source)
    if source_memory_skills:
        raise ValueError("COMPOSITE_MEMORY_SOURCE_CONTAINS_SKILLS")
    if memory_manifest.get("artifact_hash") != generation.get("source_memory_artifact_hash"):
        raise ValueError("COMPOSITE_MEMORY_SOURCE_NOT_FROZEN")
    if skill_manifest.get("artifact_hash") != generation.get("source_skill_projection_hash"):
        raise ValueError("COMPOSITE_SKILL_SOURCE_NOT_FROZEN")
    development_ids = set(protocol["selection"]["development"])
    public_skill_text = json.dumps(skills, ensure_ascii=False)
    if any(task_id in public_skill_text for task_id in development_ids):
        raise ValueError("COMPOSITE_SKILL_DEVELOPMENT_CONTAMINATION")
    if not memories or not skills:
        raise ValueError("COMPOSITE_SOURCE_POOL_EMPTY")
    for skill in skills:
        required = {"id", "content_hash", "applicability_profile", "support_task_ids"}
        if not required <= skill.keys() or set(skill["support_task_ids"]) & development_ids:
            raise ValueError("COMPOSITE_SKILL_INVALID")

    manifest = {
        "schema": "tdai-evoagentbench-factorial-composite-v1",
        "revision": generation["candidate_revision"],
        "protocol_hash": protocol["protocol_hash"],
        "source_memory_artifact_hash": memory_manifest["artifact_hash"],
        "source_skill_projection_hash": skill_manifest["artifact_hash"],
        "memory_count": len(memories), "skill_count": len(skills),
        "generation_usage": {
            "input_tokens": 0, "output_tokens": 0, "total_tokens": 0,
            "model_calls": 0,
        },
        "model": protocol["agent"]["model"], "temperature": 0,
        "fallback": "disabled", "retrieval_algorithm": protocol["retrieval"]["skill_algorithm"],
        "train_only": True, "candidate_generated": False,
        "composed_from_frozen_assets": True, "promotion_allowed": False,
    }
    manifest["artifact_hash"] = canonical_hash({
        "manifest": manifest, "memories": memories, "skills": skills,
    })
    output.mkdir(parents=True, mode=0o700)
    _write_new(output / "memories.json", memories)
    _write_new(output / "skills.json", skills)
    _write_new(output / "manifest.json", manifest)
    _write_new(output / "review.json", {
        "status": "APPROVED_FOR_DEVELOPMENT",
        "artifact_hash": manifest["artifact_hash"],
        "reason": "Both inputs were frozen before the held-out suite was opened; composition used no model call.",
        "effect_proven": False, "promotion_allowed": False,
        "action": "Four-arm development evaluation is allowed; adoption is forbidden.",
    })
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--memory-source", type=Path, required=True)
    parser.add_argument("--skill-source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--protocol", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(freeze_composite(
        args.memory_source, args.skill_source, args.output, args.protocol,
    ), ensure_ascii=False))


if __name__ == "__main__":
    main()
