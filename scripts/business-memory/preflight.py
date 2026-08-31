"""Extract a single pinned benchmark task into a NEW private preparation directory."""
from __future__ import annotations

import argparse
import hashlib
import json
import tarfile
from pathlib import Path, PurePosixPath

from workbook_oracle import inspect_workbook

REVISION = "49b73a94775fb489063f60ca1865e3a650079a79"
ARCHIVE_SHA256 = "10ef893dd29cb13ab97143ea787e68cdc9574a13873ab9a54e50b31dc03fc949"


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def prepare(archive_path: Path, destination: Path, task_id="141-20"):
    archive_hash = digest(archive_path)
    if archive_hash != ARCHIVE_SHA256:
        raise ValueError(f"unrecognized archive hash: {archive_hash}")
    destination.mkdir(mode=0o700)  # Existing evidence is never overwritten.
    with tarfile.open(archive_path, "r:gz") as archive:
        members = archive.getmembers()
        metadata = [m for m in members if m.name.endswith("/dataset.json") and m.isfile()]
        if len(metadata) != 1 or metadata[0].size > 10_000_000:
            raise ValueError("invalid dataset metadata")
        rows = json.load(archive.extractfile(metadata[0]))
        selected = [row for row in rows if str(row["id"]) == task_id]
        if len(selected) != 1:
            raise ValueError("task id missing or duplicated")
        task = selected[0]
        files = []
        for member in members:
            path = PurePosixPath(member.name)
            if task_id not in path.parts or path.suffix != ".xlsx":
                continue
            if not member.isfile() or member.size > 10_000_000 or ".." in path.parts:
                raise ValueError("unsafe archive member")
            role = "reference" if "answer" in path.name or "golden" in path.name else "input"
            folder = destination / role
            folder.mkdir(mode=0o700, exist_ok=True)
            target = folder / path.name
            with target.open("xb") as output:
                output.write(archive.extractfile(member).read())
            target.chmod(0o600)
            # Inspection is structural only: reference values never enter task prompts.
            files.append({"path": str(target.relative_to(destination)), "role": role,
                          "sha256": digest(target), "inspection": inspect_workbook(target)})
        if not any(f["role"] == "input" for f in files) or not any(f["role"] == "reference" for f in files):
            raise ValueError("unrecognized verified fixture layout")
    result = {"status": "PREPARED_NOT_EXECUTED", "revision": REVISION,
              "archive_sha256": archive_hash, "data_role": "development_not_heldout",
              "task": task, "files": files}
    with (destination / "manifest.json").open("x") as output:
        json.dump(result, output, ensure_ascii=False, indent=2)
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("archive", type=Path)
    parser.add_argument("destination", type=Path)
    parser.add_argument("--task-id", default="141-20")
    args = parser.parse_args()
    print(json.dumps(prepare(args.archive, args.destination, args.task_id), ensure_ascii=False, indent=2))
