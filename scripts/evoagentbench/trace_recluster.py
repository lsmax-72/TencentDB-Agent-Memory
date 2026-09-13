#!/usr/bin/env python3
"""Create an immutable semantic-clustering revision from frozen train patches."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from .driver import DEFAULT_ROOT, PROTOCOL_FILE
from .trace_patches import (
    SEMANTIC_CLUSTER_ALGORITHM, freeze_semantic_recluster, load_patch_artifact,
)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=DEFAULT_ROOT)
    parser.add_argument("--source-artifact", type=Path, required=True)
    parser.add_argument("--source-memories", type=Path, required=True)
    parser.add_argument("--attempt-id", required=True)
    args = parser.parse_args()
    if not args.attempt_id.replace("-", "").isalnum():
        parser.error("attempt-id must contain only letters, numbers, and hyphens")
    protocol = json.loads(PROTOCOL_FILE.read_text())
    generation = protocol.get("candidate_generation", {})
    if generation.get("cluster_algorithm") != SEMANTIC_CLUSTER_ALGORITHM:
        raise ValueError("TRACE_RECLUSTER_ALGORITHM_NOT_FROZEN")
    source_manifest, _, _ = load_patch_artifact(args.source_artifact)
    if source_manifest["artifact_hash"] != generation.get("source_patch_artifact_hash"):
        raise ValueError("TRACE_RECLUSTER_SOURCE_NOT_FROZEN")
    output = args.root / "frozen" / f"trace-patches-{args.attempt_id}"
    manifest = freeze_semantic_recluster(
        args.source_artifact,
        args.source_memories,
        output,
        protocol_hash=protocol["protocol_hash"],
        minimum_similarity=generation["cluster_minimum_similarity"],
    )
    print(json.dumps({
        "status": "PATCHES_RECLUSTERED",
        "attempt_id": args.attempt_id,
        "artifact_hash": manifest["artifact_hash"],
        "eligible_cluster_count": manifest["eligible_cluster_count"],
        "candidate_generated": False,
        "promotion_allowed": False,
    }))


if __name__ == "__main__":
    main()
