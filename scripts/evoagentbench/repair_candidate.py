#!/usr/bin/env python3
"""Create one immutable candidate revision by pruning review-rejected skills."""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path
from typing import Any

from .driver import DEFAULT_ROOT, PROTOCOL_FILE, canonical_hash, write_new
from .refine import _validate_skills


REPO = Path(__file__).resolve().parents[2]
DEFAULT_POLICY = REPO / "scripts/evoagentbench/refinement-policy-v2.json"


def _read(path: Path) -> Any:
    return json.loads(path.read_text())


def _validate_policy(path: Path, protocol: dict[str, Any]) -> dict[str, Any]:
    policy = _read(path)
    expected = dict(policy)
    digest = expected.pop("policy_hash", None)
    if digest != canonical_hash(expected):
        raise ValueError("REFINEMENT_POLICY_HASH_MISMATCH")
    if policy.get("source_protocol_id") != protocol["protocol_id"] or policy.get("source_protocol_hash") != protocol["protocol_hash"]:
        raise ValueError("REFINEMENT_POLICY_PROTOCOL_MISMATCH")
    if policy.get("evaluation_protocol_unchanged") is not True or policy.get("repair_strategy") != "remove_review_rejected_skills_without_regeneration":
        raise ValueError("REFINEMENT_POLICY_SCOPE_INVALID")
    return policy


def repair(root: Path, source_revision: int, target_revision: int, policy_path: Path = DEFAULT_POLICY) -> dict[str, Any]:
    protocol = _read(PROTOCOL_FILE)
    policy = _validate_policy(policy_path, protocol)
    if target_revision != source_revision + 1 or target_revision > policy["max_skill_revisions"]:
        raise ValueError("REFINEMENT_REVISION_NOT_ALLOWED")
    source = root / "frozen" / f"refinement-r{source_revision}"
    target = root / "frozen" / f"refinement-r{target_revision}"
    attempt = root / "refinement-attempts" / f"r{target_revision}-mechanical-repair"
    if target.exists() or attempt.exists():
        raise FileExistsError("REFINEMENT_REVISION_ALREADY_EXISTS")

    manifest = _read(source / "manifest.json")
    memories = _read(source / "memories.json")
    skills = _read(source / "skills.json")
    review = _read(source / "review.json")
    manifest_without_hash = dict(manifest)
    manifest_without_hash.pop("artifact_hash", None)
    if manifest.get("protocol_hash") != protocol["protocol_hash"] or canonical_hash({"manifest": manifest_without_hash, "memories": memories, "skills": skills}) != manifest.get("artifact_hash"):
        raise ValueError("REFINEMENT_SOURCE_ARTIFACT_INVALID")
    if review.get("status") != policy["requirements"]["source_review_status"] or review.get("artifact_hash") != manifest["artifact_hash"]:
        raise ValueError("REFINEMENT_SOURCE_REVIEW_INVALID")
    findings = review.get("findings")
    rejected_ids = {row.get("skill_id") for row in findings if isinstance(row, dict)} if isinstance(findings, list) else set()
    source_ids = {skill.get("id") for skill in skills}
    if not rejected_ids or not rejected_ids <= source_ids:
        raise ValueError("REFINEMENT_REJECTED_SKILL_SET_INVALID")
    retained = [dict(skill) for skill in skills if skill["id"] not in rejected_ids]
    if not retained:
        raise ValueError("REFINEMENT_NO_VALID_SKILL_REMAINS")
    memories_by_id = {row["source_task_id"]: row for row in memories}
    validation_keys = ("name", "description", "content", "support_task_ids", "support_evidence")
    _validate_skills({"skills": [{key: skill[key] for key in validation_keys} for skill in retained]}, memories_by_id)

    repaired_skills = []
    for index, skill in enumerate(retained, start=1):
        previous_id = skill["id"]
        skill["id"] = f"skill-r{target_revision}-{index:02d}"
        skill["derived_from_skill_id"] = previous_id
        repaired_skills.append(skill)
    repaired_manifest = {
        "schema": "tdai-evoagentbench-refinement-v1", "revision": target_revision,
        "protocol_hash": protocol["protocol_hash"], "source_manifest_hash": manifest["source_manifest_hash"],
        "memory_count": len(memories), "skill_count": len(repaired_skills),
        "generation_usage": manifest["generation_usage"], "generation_attempts": manifest["generation_attempts"],
        "generation_sources": manifest["generation_sources"], "active_attempt_model_calls": 0,
        "reused_model_calls": manifest["generation_usage"]["model_calls"], "reused_memories_from_revision": source_revision,
        "repair_source_revision": source_revision, "repair_model_calls": 0,
        "refinement_policy_id": policy["policy_id"], "refinement_policy_hash": policy["policy_hash"],
        "model": manifest["model"], "temperature": manifest["temperature"], "fallback": manifest["fallback"],
        "train_only": True, "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    repaired_manifest["artifact_hash"] = canonical_hash({"manifest": repaired_manifest, "memories": memories, "skills": repaired_skills})
    repaired_review = {
        "status": "APPROVED_FOR_DEVELOPMENT", "artifact_hash": repaired_manifest["artifact_hash"],
        "reason": "Review-rejected skills were removed; retained skills passed the existing grounded multi-source validation.",
        "removed_skill_ids": sorted(rejected_ids), "retained_from_skill_ids": [skill["derived_from_skill_id"] for skill in repaired_skills],
        "repair_model_calls": 0, "test_results_used": False, "promotion_allowed": False,
        "action": "Development evaluation is allowed. This receipt does not authorize test access or promotion.",
    }
    attempt.mkdir(parents=True, mode=0o700)
    write_new(attempt / "source.json", {"revision": source_revision, "artifact_hash": manifest["artifact_hash"], "review": review})
    write_new(attempt / "policy.json", policy)
    target.mkdir(parents=True, mode=0o700)
    write_new(target / "memories.json", memories)
    write_new(target / "skills.json", repaired_skills)
    write_new(target / "manifest.json", repaired_manifest)
    write_new(target / "review.json", repaired_review)
    write_new(attempt / "result.json", {"revision": target_revision, "artifact_hash": repaired_manifest["artifact_hash"], "review": repaired_review})
    return {"manifest": repaired_manifest, "review": repaired_review, "skills": repaired_skills}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=DEFAULT_ROOT)
    parser.add_argument("--source-revision", type=int, required=True)
    parser.add_argument("--target-revision", type=int, required=True)
    parser.add_argument("--policy", type=Path, default=DEFAULT_POLICY)
    args = parser.parse_args()
    result = repair(args.root, args.source_revision, args.target_revision, args.policy)
    print(json.dumps({"status": result["review"]["status"], "artifact_hash": result["manifest"]["artifact_hash"], "skills": [row["id"] for row in result["skills"]], "model_calls": 0}))


if __name__ == "__main__":
    main()
