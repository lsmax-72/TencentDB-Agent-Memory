#!/usr/bin/env python3
"""Review deterministic train-only patch pairs through the existing MemoryProxy."""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path
from typing import Any

from .driver import DEFAULT_ROOT, PROTOCOL_FILE, api, local_user_key, write_new
from .refine import _chat, _response_json
from .trace_cluster_review import (
    CLUSTER_ALGORITHM, REVIEW_SYSTEM, freeze_reviewed_clusters, propose_pairs,
    review_response_format, validate_review,
)
from .trace_patches import load_patch_artifact


def _usage_total(events: list[dict[str, Any]]) -> dict[str, int]:
    return {
        "input_tokens": sum(event["usage"]["prompt_tokens"] for event in events),
        "output_tokens": sum(event["usage"]["completion_tokens"] for event in events),
        "total_tokens": sum(event["usage"]["total_tokens"] for event in events),
        "model_calls": len(events),
    }


def generate(
    root: Path,
    source_artifact: Path,
    source_memories: Path,
    attempt_id: str,
) -> dict[str, Any]:
    protocol = json.loads(PROTOCOL_FILE.read_text())
    generation = protocol.get("candidate_generation", {})
    if generation.get("cluster_algorithm") != CLUSTER_ALGORITHM:
        raise ValueError("TRACE_CLUSTER_ALGORITHM_NOT_FROZEN")
    source_manifest, patches, _ = load_patch_artifact(source_artifact)
    if source_manifest["artifact_hash"] != generation.get("source_patch_artifact_hash"):
        raise ValueError("TRACE_CLUSTER_SOURCE_NOT_FROZEN")
    assignments = protocol["selection"]["capability_assignments"]
    proposals = propose_pairs(patches, assignments)
    if not proposals:
        raise ValueError("TRACE_CLUSTER_NO_PAIR_PROPOSALS")

    attempt = root / "trace-cluster-attempts" / attempt_id
    output = root / "frozen" / f"trace-patches-{attempt_id}"
    if attempt.exists() or output.exists():
        raise FileExistsError("TRACE_CLUSTER_ATTEMPT_ALREADY_EXISTS")
    attempt.mkdir(parents=True, mode=0o700)

    scope = json.loads((root / "scope.json").read_text())
    key = local_user_key()
    task = api("/v3/meta/task/create", {
        "team_id": scope["team_id"], "creator_user_id": scope["owner_user_id"],
        "title": f"EvoAgentBench / train-only cluster review / {attempt_id}",
        "description": "Research-only semantic pair adjudication; no candidate or promotion",
        "source_type": "other", "auto_assign_floating_assets": False,
        "metadata_json": json.dumps({
            "protocol_hash": protocol["protocol_hash"], "train_only": True,
            "source_patch_hash": source_manifest["artifact_hash"],
            "proposal_count": len(proposals),
        }),
        "linked_agents": [{"agent_id": scope["agent_id"]}],
    }, key)
    headers = {
        "content-type": "application/json", "authorization": f"Bearer {key}",
        "x-tdai-user-key": key, "x-team-id": scope["team_id"],
        "x-agent-id": scope["agent_id"], "x-task-id": task["task_id"],
        "x-session-id": f"eab-trace-clusters-{attempt_id}",
        "x-deepseek-harness-compact": "1",
    }
    by_patch = {patch["source_task_id"]: patch for patch in patches}
    responses = []
    events: list[dict[str, Any]] = []
    try:
        for position, proposal in enumerate(proposals, start=1):
            payload = {
                "proposal": proposal,
                "patches": [by_patch[task_id] for task_id in proposal["support_task_ids"]],
            }
            body = {
                "model": protocol["agent"]["model"], "temperature": 0,
                "max_tokens": 1800, "stream": False,
                "response_format": review_response_format(proposal),
                "chat_template_kwargs": {"enable_thinking": False},
                "messages": [
                    {"role": "system", "content": REVIEW_SYSTEM},
                    {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
                ],
            }
            text, usage, response_hash = _chat(body, headers)
            write_new(attempt / "raw" / f"{position:02d}.json", {
                "proposal_id": proposal["proposal_id"], "content": text,
                "response_hash": response_hash,
            }, private=True)
            event = {
                "proposal_id": proposal["proposal_id"], "usage": usage,
                "response_hash": response_hash,
            }
            events.append(event)
            write_new(attempt / "events" / f"{position:02d}.json", event, private=True)
            parsed = validate_review(_response_json(text), proposal, by_patch)
            responses.append(parsed)
            write_new(attempt / "responses" / f"{position:02d}.json", parsed, private=True)
            print(json.dumps({
                "position": position, "total": len(proposals),
                "proposal_id": proposal["proposal_id"],
                "decision": parsed["decision"], "usage": usage,
            }), flush=True)
        write_new(attempt / "responses.json", responses, private=True)
        write_new(attempt / "model-events.json", events, private=True)
        manifest = freeze_reviewed_clusters(
            source_artifact, source_memories, attempt / "responses.json", output,
            protocol_hash=protocol["protocol_hash"],
            capability_assignments=assignments,
            model=protocol["agent"]["model"], usage=_usage_total(events),
        )
        safe = {
            "status": "CLUSTERS_FROZEN", "attempt_id": attempt_id,
            "artifact_hash": manifest["artifact_hash"],
            "proposal_count": manifest["proposal_count"],
            "eligible_cluster_count": manifest["eligible_cluster_count"],
            "candidate_generated": False, "promotion_allowed": False,
        }
        api("/v3/meta/task/update", {
            "task_id": task["task_id"], "status": "completed",
            "metadata_json": json.dumps(safe),
        }, key)
        print(json.dumps(safe))
        return manifest
    except Exception as error:
        failure = {
            "status": "CLUSTER_REJECTED" if isinstance(error, ValueError) else "INFRA_ERROR",
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
    parser.add_argument("--source-artifact", type=Path, required=True)
    parser.add_argument("--source-memories", type=Path, required=True)
    parser.add_argument("--attempt-id", required=True)
    args = parser.parse_args()
    if not args.attempt_id.replace("-", "").isalnum():
        parser.error("attempt-id must contain only letters, numbers, and hyphens")
    generate(args.root, args.source_artifact, args.source_memories, args.attempt_id)


if __name__ == "__main__":
    main()
