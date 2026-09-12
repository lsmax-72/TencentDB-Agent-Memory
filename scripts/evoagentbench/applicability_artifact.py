#!/usr/bin/env python3
"""Create an immutable applicability-aware projection of frozen Skill assets."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
from pathlib import Path
from typing import Any

from .protocol import sha256_json
from .retrieval import APPLICABILITY_ALGORITHM, _family_tokens, _query_upper_bounds


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _write_new(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w") as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2)
        handle.write("\n")


def annotate_skill(skill: dict[str, Any]) -> dict[str, Any]:
    required = {"id", "content_hash", "name", "description", "content", "support_task_ids"}
    if not required <= skill.keys():
        raise ValueError("APPLICABILITY_SOURCE_SKILL_INVALID")
    evidence_refs = skill["support_task_ids"]
    if not isinstance(evidence_refs, list) or not all(isinstance(item, str) and item for item in evidence_refs) or len(set(evidence_refs)) < 2:
        raise ValueError("APPLICABILITY_SOURCE_EVIDENCE_INVALID")
    trigger = re.search(r"\bTrigger:\s*(.+?)(?=\s+Procedure:)", skill["content"], re.I | re.S)
    if not trigger:
        raise ValueError("APPLICABILITY_TRIGGER_MISSING")
    source_text = f"{skill['description']}\n{skill['content']}"
    complexities = re.findall(r"\bO\([^)]{1,40}\)", source_text)
    if not complexities:
        raise ValueError("APPLICABILITY_COMPLEXITY_MISSING")
    bounds = _query_upper_bounds(f"{skill['description']}\n{skill['content']}")
    constraints = [
        {"parameter": parameter, "max_value": int(value) if value.is_integer() else value}
        for parameter, value in sorted(bounds.items())
    ]
    if not constraints:
        raise ValueError("APPLICABILITY_EXPLICIT_CONSTRAINT_MISSING")
    limits = ", ".join(f"{row['parameter']} <= {row['max_value']}" for row in constraints)
    pair_enumeration = re.search(r"(?:all (?:possible )?pairs|enumerat\w* (?:through )?(?:all )?pairs)", source_text, re.I)
    complexity = (
        "O(number_of_pairs) total; O(1) per pair"
        if pair_enumeration and set(complexities) == {"O(1)"}
        else "; ".join(dict.fromkeys(complexities))
    )
    entity_terms = sorted(_family_tokens(skill["name"]))
    objective_map = {
        "maximum": "maximum", "maximize": "maximum", "maximise": "maximum",
        "minimum": "minimum", "minimize": "minimum", "minimise": "minimum", "count": "count",
        "counting": "count", "number": "number", "total": "total",
        "optimum": "optimum",
    }
    objective_terms = sorted({
        normalized for token, normalized in objective_map.items()
        if re.search(rf"\b{token}\b", trigger.group(1), re.I)
    })
    if not entity_terms or not objective_terms:
        raise ValueError("APPLICABILITY_TASK_SIGNALS_MISSING")
    profile = {
        "task_family": skill["name"].strip(),
        "when_to_apply": trigger.group(1).strip(),
        "do_not_apply_when": f"Do not apply unless the task explicitly establishes {limits}.",
        "constraints": constraints,
        "complexity": complexity,
        "evidence_refs": sorted(set(evidence_refs)),
        "task_signals": {
            "entity_terms": entity_terms,
            "objective_terms": objective_terms,
            "same_sentence": True,
        },
    }
    projected = dict(skill)
    projected["source_content_hash"] = skill["content_hash"]
    projected["applicability_profile"] = profile
    projected["content_hash"] = sha256_json({
        key: projected[key]
        for key in ("name", "description", "content", "applicability_profile")
    })
    return projected


def freeze_projection(
    source: Path, output: Path, algorithm: str = APPLICABILITY_ALGORITHM
) -> dict[str, Any]:
    if output.exists():
        raise FileExistsError("APPLICABILITY_OUTPUT_ALREADY_EXISTS")
    value = json.loads(source.read_text())
    if not isinstance(value, list) or not value:
        raise ValueError("APPLICABILITY_SOURCE_POOL_INVALID")
    skills = [annotate_skill(skill) for skill in value]
    manifest = {
        "schema": "tdai-skill-applicability-artifact-v1",
        "algorithm": algorithm,
        "source_path": str(source.resolve()),
        "source_sha256": sha256_file(source),
        "skill_count": len(skills),
        "model_calls": 0,
        "content_rewritten": False,
    }
    manifest["artifact_hash"] = sha256_json({"manifest": manifest, "skills": skills})
    output.mkdir(parents=True, mode=0o700)
    _write_new(output / "skills.json", skills)
    _write_new(output / "manifest.json", manifest)
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(freeze_projection(args.source, args.output), ensure_ascii=False))


if __name__ == "__main__":
    main()
