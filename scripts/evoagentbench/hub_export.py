#!/usr/bin/env python3
"""Build an immutable, redacted MemoryHub import bundle from frozen train artifacts."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from .driver import DEFAULT_ROOT, PROTOCOL_FILE, canonical_hash, write_new


SCHEMA = "tdai-evoagentbench-refinement-export-v1"


def _read(path: Path) -> Any:
    return json.loads(path.read_text())


def _validated_revision(root: Path, revision: int, protocol_hash: str) -> tuple[dict[str, Any], list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
    directory = root / "frozen" / f"refinement-r{revision}"
    manifest = _read(directory / "manifest.json")
    memories = _read(directory / "memories.json")
    skills = _read(directory / "skills.json")
    review = _read(directory / "review.json")
    if manifest.get("schema") != "tdai-evoagentbench-refinement-v1" or manifest.get("revision") != revision:
        raise ValueError("REFINEMENT_MANIFEST_INVALID")
    if manifest.get("protocol_hash") != protocol_hash or manifest.get("train_only") is not True:
        raise ValueError("REFINEMENT_PROTOCOL_MISMATCH")
    expected = canonical_hash({"manifest": {key: value for key, value in manifest.items() if key != "artifact_hash"}, "memories": memories, "skills": skills})
    if manifest.get("artifact_hash") != expected:
        raise ValueError("REFINEMENT_ARTIFACT_HASH_MISMATCH")
    if manifest.get("memory_count") != len(memories) or manifest.get("skill_count") != len(skills):
        raise ValueError("REFINEMENT_COUNT_MISMATCH")
    if review.get("artifact_hash") != manifest["artifact_hash"] or review.get("promotion_allowed") is not False:
        raise ValueError("REFINEMENT_REVIEW_INVALID")
    return manifest, memories, skills, review


def build_bundle(root: Path, revisions: tuple[int, ...] = (1, 2), include_memories: bool = True) -> dict[str, Any]:
    protocol = _read(PROTOCOL_FILE)
    protocol_hash = protocol["protocol_hash"]
    if not revisions or len(set(revisions)) != len(revisions) or any(revision < 1 for revision in revisions):
        raise ValueError("REFINEMENT_EXPORT_REVISIONS_INVALID")
    frozen_revisions = [_validated_revision(root, revision, protocol_hash) for revision in revisions]

    candidates: list[dict[str, Any]] = []
    if include_memories:
        # Only the newest requested Memory snapshot is logical state. Importing
        # every inherited copy would duplicate the same train evidence.
        final_manifest, final_memories, _, _ = frozen_revisions[-1]
        for memory in final_memories:
            public = {key: memory[key] for key in ("task_intent", "approach", "key_insight", "applicability")}
            if canonical_hash(public) != memory.get("content_hash"):
                raise ValueError("MEMORY_CONTENT_HASH_MISMATCH")
            candidates.append({
                "asset_kind": "memory", "candidate_id": memory["id"], "candidate_revision": final_manifest["revision"],
                "status": "TRAIN_ONLY_FROZEN", "content": public, "content_hash": memory["content_hash"],
                "source_task_ids": [memory["source_task_id"]], "source_evidence_hashes": [memory["source_evidence_hash"]],
                "source_status": memory["source_status"], "derived_from_candidate_id": memory.get("derived_from_memory_id"),
                "artifact_hash": final_manifest["artifact_hash"], "generation_usage": final_manifest["generation_usage"],
                "train_only": True, "research_only": True, "promotion_allowed": False,
            })

    for manifest, _, skills, review in frozen_revisions:
        for skill in skills:
            public = {key: skill[key] for key in ("name", "description", "content")}
            if canonical_hash(public) != skill.get("content_hash"):
                raise ValueError("SKILL_CONTENT_HASH_MISMATCH")
            candidates.append({
                "asset_kind": "skill", "candidate_id": skill["id"], "candidate_revision": manifest["revision"],
                "status": review["status"], "content": public, "content_hash": skill["content_hash"],
                "source_task_ids": skill["support_task_ids"], "support_evidence": skill.get("support_evidence", []),
                "artifact_hash": manifest["artifact_hash"], "generation_usage": manifest["generation_usage"],
                "active_model_calls": manifest.get("active_attempt_model_calls"), "repair_model_calls": manifest.get("repair_model_calls"),
                "review_reason": review["reason"], "review_findings": review.get("findings", []), "review_action": review["action"],
                "train_only": True, "research_only": True, "promotion_allowed": False,
            })

    bundle: dict[str, Any] = {
        "schema": SCHEMA,
        "protocol_id": protocol["protocol_id"], "protocol_hash": protocol_hash,
        "source_revisions": [{
            "revision": manifest["revision"], "artifact_hash": manifest["artifact_hash"],
            "review_status": review["status"], "generation_usage": manifest["generation_usage"],
            "memory_count": manifest["memory_count"], "skill_count": manifest["skill_count"],
        } for manifest, _, _, review in frozen_revisions],
        "candidate_count": len(candidates), "candidates": candidates,
        "evidence_limitations": [
            "Only train-derived frozen research assets are included.",
            "Historical candidates are read-only and cannot be adopted or injected into production.",
            "Rejected Skill revisions are retained with their original review findings.",
        ],
    }
    bundle["bundle_hash"] = canonical_hash(bundle)
    return bundle


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=DEFAULT_ROOT)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--revisions", type=int, nargs="+", default=[1, 2])
    parser.add_argument("--skip-memories", action="store_true")
    args = parser.parse_args()
    bundle = build_bundle(args.root, tuple(args.revisions), not args.skip_memories)
    write_new(args.output, bundle)
    print(json.dumps({"output": str(args.output), "bundle_hash": bundle["bundle_hash"], "candidates": bundle["candidate_count"]}))


if __name__ == "__main__":
    main()
