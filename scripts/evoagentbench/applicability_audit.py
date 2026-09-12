#!/usr/bin/env python3
"""Replay frozen task prompts through old and applicability-aware retrieval."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from .adapter import parse_session
from .applicability_artifact import _write_new, sha256_file
from .protocol import sha256_json
from .retrieval import (
    ALGORITHM, APPLICABILITY_ALGORITHM, select_assets,
    select_skill_assets_for_algorithm,
)


def build_audit(
    runs: Path, source_skills: Path, projected_skills: Path, phase: str,
    candidate_algorithm: str,
) -> dict[str, Any]:
    source = json.loads(source_skills.read_text())
    projected = json.loads(projected_skills.read_text())
    rows = []
    seen = set()
    for evidence_path in sorted(runs.glob(f"{phase}-*-vanilla-trial-1/evidence.json")):
        evidence = json.loads(evidence_path.read_text())
        task_id = evidence.get("task_id")
        if not isinstance(task_id, str) or task_id in seen:
            raise ValueError("APPLICABILITY_AUDIT_TASK_ID_INVALID")
        seen.add(task_id)
        sessions = list((evidence_path.parent / "official").glob("**/session.jsonl"))
        if len(sessions) != 1:
            raise ValueError("APPLICABILITY_AUDIT_SESSION_INVALID")
        prompt = parse_session(sessions[0])["task_input"]
        if not isinstance(prompt, str) or not prompt:
            raise ValueError("APPLICABILITY_AUDIT_PROMPT_MISSING")
        legacy = select_assets(prompt, "skill", source, top_k=2)
        selected, decisions = select_skill_assets_for_algorithm(
            prompt, projected, candidate_algorithm, top_k=2
        )
        rows.append({
            "task_id": task_id,
            "legacy_asset_ids": [asset["id"] for asset in legacy],
            "v2_asset_ids": [asset["id"] for asset in selected],
            "v2_decisions": decisions,
        })
    if not rows:
        raise ValueError("APPLICABILITY_AUDIT_RUNS_EMPTY")
    result = {
        "schema": "tdai-skill-applicability-audit-v1",
        "phase": phase,
        "task_count": len(rows),
        "source_skills_sha256": sha256_file(source_skills),
        "projected_skills_sha256": sha256_file(projected_skills),
        "legacy_algorithm": ALGORITHM,
        "candidate_algorithm": candidate_algorithm,
        "legacy_retrieval_count": sum(bool(row["legacy_asset_ids"]) for row in rows),
        "candidate_retrieval_count": sum(bool(row["v2_asset_ids"]) for row in rows),
        "prevented_task_ids": [row["task_id"] for row in rows if row["legacy_asset_ids"] and not row["v2_asset_ids"]],
        "introduced_task_ids": [row["task_id"] for row in rows if not row["legacy_asset_ids"] and row["v2_asset_ids"]],
        "rows": rows,
        "interpretation": "Retrieval-only replay; no task outcome or capability claim.",
    }
    result["artifact_hash"] = sha256_json(result)
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--runs", type=Path, required=True)
    parser.add_argument("--source-skills", type=Path, required=True)
    parser.add_argument("--projected-skills", type=Path, required=True)
    parser.add_argument("--phase", required=True)
    parser.add_argument(
        "--algorithm", choices=[APPLICABILITY_ALGORITHM],
        required=True,
    )
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = build_audit(
        args.runs, args.source_skills, args.projected_skills, args.phase,
        args.algorithm,
    )
    _write_new(args.output, result)
    print(json.dumps({key: result[key] for key in (
        "artifact_hash", "task_count", "legacy_retrieval_count",
        "candidate_retrieval_count", "prevented_task_ids", "introduced_task_ids",
    )}, ensure_ascii=False))


if __name__ == "__main__":
    main()
