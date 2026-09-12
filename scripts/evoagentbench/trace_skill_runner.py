#!/usr/bin/env python3
"""Synthesize one immutable Skill per supported train-only trace cluster."""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path
from typing import Any

from .driver import (
    DEFAULT_ROOT, PROTOCOL_FILE, _candidate_assets, api, local_user_key, write_new,
)
from .refine import _chat, _response_json
from .trace_patches import load_patch_artifact
from .trace_skills import (
    SKILL_SYSTEM, freeze_skill_candidate, skill_response_format,
    validate_cluster_skill,
)


def _total_usage(events: list[dict[str, Any]]) -> dict[str, int]:
    return {
        "input_tokens": sum(row["usage"]["prompt_tokens"] for row in events),
        "output_tokens": sum(row["usage"]["completion_tokens"] for row in events),
        "total_tokens": sum(row["usage"]["total_tokens"] for row in events),
        "model_calls": len(events),
    }


def synthesize(
    root: Path,
    patch_artifact: Path,
    source_revision: int,
    target_revision: int,
    attempt_id: str,
) -> dict[str, Any]:
    protocol = json.loads(PROTOCOL_FILE.read_text())
    attempt = root / "trace-skill-attempts" / attempt_id
    output = root / "frozen" / f"refinement-r{target_revision}"
    if attempt.exists() or output.exists():
        raise FileExistsError("TRACE_SKILL_ATTEMPT_ALREADY_EXISTS")
    attempt.mkdir(parents=True, mode=0o700)
    patch_manifest, patches, clusters = load_patch_artifact(patch_artifact)
    if patch_manifest["protocol_hash"] != protocol["protocol_hash"]:
        raise ValueError("TRACE_SKILL_PROTOCOL_MISMATCH")
    if not clusters:
        raise ValueError("TRACE_SKILL_NO_ELIGIBLE_CLUSTER")
    memories, source_candidate_hash = _candidate_assets(
        root, source_revision, "memory", protocol["protocol_hash"]
    )
    by_memory = {row["source_task_id"]: row for row in memories}
    by_patch = {row["source_task_id"]: row for row in patches}
    if set(by_memory) != set(by_patch):
        raise ValueError("TRACE_SKILL_SOURCE_SET_MISMATCH")

    scope = json.loads((root / "scope.json").read_text())
    key = local_user_key()
    task = api("/v3/meta/task/create", {
        "team_id": scope["team_id"], "creator_user_id": scope["owner_user_id"],
        "title": f"EvoAgentBench / train-only modular Skill / {attempt_id}",
        "description": "Research-only per-cluster Skill synthesis; no effect or promotion claim",
        "source_type": "other", "auto_assign_floating_assets": False,
        "metadata_json": json.dumps({
            "protocol_hash": protocol["protocol_hash"], "train_only": True,
            "source_revision": source_revision, "target_revision": target_revision,
            "source_candidate_hash": source_candidate_hash,
            "source_patch_hash": patch_manifest["artifact_hash"],
        }),
        "linked_agents": [{"agent_id": scope["agent_id"]}],
    }, key)
    headers = {
        "content-type": "application/json", "authorization": f"Bearer {key}",
        "x-tdai-user-key": key, "x-team-id": scope["team_id"],
        "x-agent-id": scope["agent_id"], "x-task-id": task["task_id"],
        "x-session-id": f"eab-trace-skills-{attempt_id}",
        "x-deepseek-harness-compact": "1",
    }
    responses = []
    events: list[dict[str, Any]] = []
    try:
        for position, cluster in enumerate(clusters, start=1):
            support_ids = cluster["support_task_ids"]
            cluster_memories = {task_id: by_memory[task_id] for task_id in support_ids}
            payload = {
                "cluster": cluster,
                "patches": [by_patch[task_id] for task_id in support_ids],
                "case_memories": [{
                    "source_task_id": task_id,
                    **{
                        key: by_memory[task_id][key]
                        for key in ("task_intent", "approach", "key_insight", "applicability")
                    },
                } for task_id in support_ids],
            }
            body = {
                "model": protocol["agent"]["model"], "temperature": 0,
                "max_tokens": 3600, "stream": False,
                "response_format": skill_response_format(
                    support_ids, cluster["mechanism_key"]
                ),
                "chat_template_kwargs": {"enable_thinking": False},
                "messages": [
                    {"role": "system", "content": SKILL_SYSTEM},
                    {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
                ],
            }
            text, usage, response_hash = _chat(body, headers)
            parsed = _response_json(text)
            validate_cluster_skill(parsed, cluster, cluster_memories)
            response = {"mechanism_key": cluster["mechanism_key"], "skill": parsed}
            event = {
                "mechanism_key": cluster["mechanism_key"], "usage": usage,
                "response_hash": response_hash,
            }
            responses.append(response)
            events.append(event)
            write_new(attempt / "responses" / f"{position:02d}.json", response, private=True)
            write_new(attempt / "events" / f"{position:02d}.json", event, private=True)
            print(json.dumps({
                "position": position, "total": len(clusters),
                "mechanism_key": cluster["mechanism_key"], "usage": usage,
            }), flush=True)
        write_new(attempt / "responses.json", responses, private=True)
        write_new(attempt / "model-events.json", events, private=True)
        source_memories = root / "frozen" / f"refinement-r{source_revision}" / "memories.json"
        manifest = freeze_skill_candidate(
            patch_artifact, source_memories, attempt / "responses.json", output,
            revision=target_revision, model=protocol["agent"]["model"],
            usage=_total_usage(events),
        )
        safe = {
            "status": "CANDIDATE_FROZEN", "attempt_id": attempt_id,
            "artifact_hash": manifest["artifact_hash"],
            "skill_count": manifest["skill_count"], "effect_proven": False,
            "promotion_allowed": False,
        }
        api("/v3/meta/task/update", {
            "task_id": task["task_id"], "status": "completed",
            "metadata_json": json.dumps(safe),
        }, key)
        print(json.dumps(safe))
        return manifest
    except Exception as error:
        failure = {
            "status": "CANDIDATE_REJECTED" if isinstance(error, ValueError) else "INFRA_ERROR",
            "reason": type(error).__name__, "message": str(error)[:500],
            "completed_model_calls": len(events), "attempt_id": attempt_id,
            "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        write_new(attempt / "failure.json", failure, private=True)
        api("/v3/meta/task/update", {
            "task_id": task["task_id"], "status": "completed",
            "metadata_json": json.dumps(failure),
        }, key)
        raise


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=DEFAULT_ROOT)
    parser.add_argument("--patch-artifact", type=Path, required=True)
    parser.add_argument("--source-revision", type=int, required=True)
    parser.add_argument("--target-revision", type=int, required=True)
    parser.add_argument("--attempt-id", required=True)
    args = parser.parse_args()
    if args.target_revision <= args.source_revision:
        parser.error("target-revision must be newer than source-revision")
    if not args.attempt_id.replace("-", "").isalnum():
        parser.error("attempt-id must contain only letters, numbers, and hyphens")
    synthesize(
        args.root, args.patch_artifact, args.source_revision,
        args.target_revision, args.attempt_id,
    )


if __name__ == "__main__":
    main()
