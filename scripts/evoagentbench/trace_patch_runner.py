#!/usr/bin/env python3
"""Generate immutable train-only trace patches through the existing MemoryProxy."""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path
from typing import Any

from .driver import (
    DEFAULT_ROOT, PROTOCOL_FILE, _candidate_assets, api, local_user_key, write_new,
)
from .refine import _chat, _experience_runs, _response_json
from .trace_patches import (
    PATCH_SYSTEM, freeze_patch_artifact, patch_response_format, validate_patch,
)


def _usage_total(events: list[dict[str, Any]]) -> dict[str, int]:
    return {
        "input_tokens": sum(event["usage"]["prompt_tokens"] for event in events),
        "output_tokens": sum(event["usage"]["completion_tokens"] for event in events),
        "total_tokens": sum(event["usage"]["total_tokens"] for event in events),
        "model_calls": len(events),
    }


def _reused_attempt(
    root: Path,
    attempt_id: str | None,
    memories: dict[str, dict[str, Any]],
    source_ids: set[str],
) -> dict[str, tuple[dict[str, Any], dict[str, Any]]]:
    if attempt_id is None:
        return {}
    source = root / "trace-patch-attempts" / attempt_id
    if not (source / "failure.json").is_file():
        raise RuntimeError("TRACE_PATCH_REUSE_SOURCE_NOT_FAILED")
    responses = {}
    for path in sorted((source / "responses").glob("*.json")):
        response = json.loads(path.read_text())
        task_id = response.get("source_task_id")
        if task_id not in memories or set(response) != {"source_task_id", "patch"}:
            raise RuntimeError("TRACE_PATCH_REUSE_RESPONSE_INVALID")
        validate_patch(response["patch"], memories[task_id], source_ids)
        responses[task_id] = response
    events = {}
    for path in sorted((source / "events").glob("*.json")):
        event = json.loads(path.read_text())
        task_id = event.get("source_task_id")
        usage = event.get("usage")
        if task_id not in memories or not isinstance(usage, dict):
            raise RuntimeError("TRACE_PATCH_REUSE_EVENT_INVALID")
        if any(not isinstance(usage.get(key), int) or usage[key] < 0 for key in (
            "prompt_tokens", "completion_tokens", "total_tokens"
        )):
            raise RuntimeError("TRACE_PATCH_REUSE_USAGE_INVALID")
        events[task_id] = event
    if set(responses) != set(events):
        raise RuntimeError("TRACE_PATCH_REUSE_CHECKPOINT_MISMATCH")
    return {task_id: (responses[task_id], events[task_id]) for task_id in responses}


def generate(
    root: Path,
    source_revision: int,
    attempt_id: str,
    reuse_from_attempt: str | None = None,
) -> dict[str, Any]:
    protocol = json.loads(PROTOCOL_FILE.read_text())
    attempt = root / "trace-patch-attempts" / attempt_id
    output = root / "frozen" / f"trace-patches-{attempt_id}"
    if attempt.exists() or output.exists():
        raise FileExistsError("TRACE_PATCH_ATTEMPT_ALREADY_EXISTS")
    attempt.mkdir(parents=True, mode=0o700)
    memories, candidate_hash = _candidate_assets(
        root, source_revision, "memory", protocol["protocol_hash"]
    )
    sources = _experience_runs(root, protocol)
    by_source = {source["task_id"]: source for source in sources}
    by_memory = {memory["source_task_id"]: memory for memory in memories}
    if set(by_source) != set(by_memory):
        raise RuntimeError("TRACE_PATCH_SOURCE_SET_MISMATCH")
    for task_id, memory in by_memory.items():
        if memory["source_evidence_hash"] != by_source[task_id]["evidence_hash"]:
            raise RuntimeError("TRACE_PATCH_EVIDENCE_HASH_MISMATCH")
    source_ids = set(by_source)
    reused = _reused_attempt(root, reuse_from_attempt, by_memory, source_ids)

    scope = json.loads((root / "scope.json").read_text())
    key = local_user_key()
    task = api("/v3/meta/task/create", {
        "team_id": scope["team_id"], "creator_user_id": scope["owner_user_id"],
        "title": f"EvoAgentBench / train-only trace patches / {attempt_id}",
        "description": "Research-only per-trace Skill patch generation; no candidate or promotion",
        "source_type": "other", "auto_assign_floating_assets": False,
        "metadata_json": json.dumps({
            "protocol_hash": protocol["protocol_hash"], "train_only": True,
            "source_revision": source_revision, "candidate_hash": candidate_hash,
        }),
        "linked_agents": [{"agent_id": scope["agent_id"]}],
    }, key)
    headers = {
        "content-type": "application/json", "authorization": f"Bearer {key}",
        "x-tdai-user-key": key, "x-team-id": scope["team_id"],
        "x-agent-id": scope["agent_id"], "x-task-id": task["task_id"],
        "x-session-id": f"eab-trace-patches-{attempt_id}",
        "x-deepseek-harness-compact": "1",
    }
    events: list[dict[str, Any]] = []
    responses = []
    try:
        for position, task_id in enumerate(sorted(source_ids), start=1):
            source = by_source[task_id]
            memory = by_memory[task_id]
            if task_id in reused:
                response, event = reused[task_id]
                event = {**event, "reused_from_attempt": reuse_from_attempt}
                responses.append(response)
                events.append(event)
                write_new(attempt / "responses" / f"{position:02d}.json", response, private=True)
                write_new(attempt / "events" / f"{position:02d}.json", event, private=True)
                print(json.dumps({
                    "position": position, "total": len(source_ids),
                    "source_task_id": task_id, "reused_from_attempt": reuse_from_attempt,
                }), flush=True)
                continue
            payload = {
                "run_status": source["status"], "reward": source["reward"],
                "task_prompt": source["prompt"][:24_000],
                "final_output": source["final_output"][:12_000],
                "tool_events": source["tool_events"],
                "case_memory": {
                    key: memory[key]
                    for key in ("task_intent", "approach", "key_insight", "applicability")
                },
            }
            body = {
                "model": protocol["agent"]["model"], "temperature": 0,
                "max_tokens": 2400, "stream": False,
                "response_format": patch_response_format(),
                "chat_template_kwargs": {"enable_thinking": False},
                "messages": [
                    {"role": "system", "content": PATCH_SYSTEM},
                    {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
                ],
            }
            text, usage, response_hash = _chat(body, headers)
            parsed = _response_json(text)
            validate_patch(parsed, memory, source_ids)
            response = {"source_task_id": task_id, "patch": parsed}
            event = {
                "source_task_id": task_id, "usage": usage,
                "response_hash": response_hash,
            }
            responses.append(response)
            events.append(event)
            write_new(attempt / "responses" / f"{position:02d}.json", response, private=True)
            write_new(attempt / "events" / f"{position:02d}.json", event, private=True)
            print(json.dumps({
                "position": position, "total": len(source_ids),
                "source_task_id": task_id, "usage": usage,
            }), flush=True)
        write_new(attempt / "responses.json", responses, private=True)
        write_new(attempt / "model-events.json", events, private=True)
        source_file = root / "frozen" / f"refinement-r{source_revision}" / "memories.json"
        manifest = freeze_patch_artifact(
            source_file, attempt / "responses.json", output,
            model=protocol["agent"]["model"], usage={
                **_usage_total(events),
                "active_model_calls": len(events) - len(reused),
                "reused_model_calls": len(reused),
            },
        )
        safe = {
            "status": "PATCHES_FROZEN", "attempt_id": attempt_id,
            "artifact_hash": manifest["artifact_hash"],
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
            "status": "INFRA_ERROR" if not isinstance(error, ValueError) else "PATCH_REJECTED",
            "reason": type(error).__name__, "message": str(error)[:500],
            "completed_model_calls": len(events) - len(reused), "attempt_id": attempt_id,
            "reused_model_calls": len(reused),
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
    parser.add_argument("--source-revision", type=int, required=True)
    parser.add_argument("--attempt-id", required=True)
    parser.add_argument("--reuse-from-attempt")
    args = parser.parse_args()
    if not args.attempt_id.replace("-", "").isalnum():
        parser.error("attempt-id must contain only letters, numbers, and hyphens")
    if args.reuse_from_attempt and not args.reuse_from_attempt.replace("-", "").isalnum():
        parser.error("reuse-from-attempt must contain only letters, numbers, and hyphens")
    generate(args.root, args.source_revision, args.attempt_id, args.reuse_from_attempt)


if __name__ == "__main__":
    main()
