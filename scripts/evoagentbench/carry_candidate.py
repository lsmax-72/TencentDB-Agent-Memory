#!/usr/bin/env python3
"""Carry an immutable candidate into a new evaluation root without rewriting it."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
from pathlib import Path

from .protocol import sha256_json


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def carry(source_root: Path, target_root: Path, revision: int, protocol_file: Path) -> dict[str, object]:
    source = source_root / "frozen" / f"refinement-r{revision}"
    target = target_root / "frozen" / f"refinement-r{revision}"
    if target.exists():
        raise FileExistsError("TARGET_CANDIDATE_ALREADY_EXISTS")
    protocol = json.loads(protocol_file.read_text())
    frozen = protocol.get("candidate") or {}
    generation = protocol.get("candidate_generation") or {}
    if not frozen and generation.get("memory_revision") == revision:
        frozen = {
            "revision": revision,
            "artifact_hash": generation.get("source_memory_artifact_hash"),
            "source_protocol_hash": generation.get("source_protocol_hash"),
        }
    if frozen.get("revision") != revision:
        raise ValueError("CANDIDATE_REVISION_NOT_FROZEN_FOR_PROTOCOL")
    manifest = json.loads((source / "manifest.json").read_text())
    memories = json.loads((source / "memories.json").read_text())
    skills = json.loads((source / "skills.json").read_text())
    manifest_without_hash = dict(manifest)
    artifact_hash = manifest_without_hash.pop("artifact_hash", None)
    if sha256_json({"manifest": manifest_without_hash, "memories": memories, "skills": skills}) != artifact_hash:
        raise ValueError("SOURCE_CANDIDATE_ARTIFACT_HASH_MISMATCH")
    if artifact_hash != frozen.get("artifact_hash") or manifest.get("protocol_hash") != frozen.get("source_protocol_hash"):
        raise ValueError("SOURCE_CANDIDATE_NOT_FROZEN_FOR_PROTOCOL")

    target.mkdir(parents=True, mode=0o700)
    required_files = ("manifest.json", "memories.json", "skills.json")
    files = required_files + (("review.json",) if (source / "review.json").is_file() else ())
    for name in files:
        destination = target / name
        descriptor = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o444)
        with os.fdopen(descriptor, "wb") as output, (source / name).open("rb") as input_file:
            shutil.copyfileobj(input_file, output)
    receipt: dict[str, object] = {
        "schema": "tdai-evoagentbench-candidate-carry-v1",
        "source_protocol_hash": manifest["protocol_hash"],
        "target_protocol_hash": protocol["protocol_hash"],
        "candidate_revision": revision,
        "candidate_artifact_hash": artifact_hash,
        "source_files": {name: sha256_file(source / name) for name in files},
    }
    receipt["receipt_hash"] = sha256_json(receipt)
    receipt_path = target / "carry-receipt.json"
    descriptor = os.open(receipt_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o444)
    with os.fdopen(descriptor, "w") as handle:
        json.dump(receipt, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    return receipt


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-root", type=Path, required=True)
    parser.add_argument("--target-root", type=Path, required=True)
    parser.add_argument("--revision", type=int, required=True)
    parser.add_argument("--protocol", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(carry(args.source_root, args.target_root, args.revision, args.protocol), ensure_ascii=False))


if __name__ == "__main__":
    main()
