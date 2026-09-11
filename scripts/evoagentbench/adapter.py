#!/usr/bin/env python3
"""Narrow adapter from official EvoAgentBench artifacts to auditable evidence."""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any

from .protocol import canonical_json, sha256_json


PROVIDER_MARKERS = (
    "Error calling LLM:",
    "Cannot connect to host",
    "Connect call failed",
    "Server disconnected",
    "upstream connect error",
    "ServiceUnavailableError",
    "InternalServerError",
)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _parse_arguments(raw: Any) -> Any:
    if not isinstance(raw, str):
        return raw
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return raw


def parse_session(path: Path) -> dict[str, Any]:
    tool_events: list[dict[str, Any]] = []
    pending: dict[str, int] = {}
    turns = 0
    model_names: set[str] = set()
    usage = {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0}
    usage_seen = False
    if not path.exists():
        return {
            "tool_events": tool_events,
            "model_call_count": None,
            "usage": {key: None for key in usage},
            "actual_models": [],
            "session_hash": None,
        }

    for line in path.read_text(errors="replace").splitlines():
        if not line.strip():
            continue
        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            continue
        if entry.get("role") == "assistant":
            turns += 1
            model = entry.get("model") or entry.get("model_name")
            if isinstance(model, str) and model:
                model_names.add(model)
            raw_usage = entry.get("usage") or entry.get("token_usage")
            if isinstance(raw_usage, dict):
                prompt = raw_usage.get("prompt_tokens", raw_usage.get("input_tokens"))
                completion = raw_usage.get("completion_tokens", raw_usage.get("output_tokens"))
                total = raw_usage.get("total_tokens")
                if all(isinstance(value, int) and value >= 0 for value in (prompt, completion)):
                    usage["input_tokens"] += prompt
                    usage["output_tokens"] += completion
                    usage["total_tokens"] += total if isinstance(total, int) and total >= 0 else prompt + completion
                    usage_seen = True
            for call in entry.get("tool_calls") or []:
                function = call.get("function") or {}
                call_id = str(call.get("id") or f"sequence-{len(tool_events)}")
                pending[call_id] = len(tool_events)
                tool_events.append({
                    "call_id": call_id,
                    "name": str(function.get("name") or "unknown"),
                    "arguments": _parse_arguments(function.get("arguments")),
                    "result": None,
                    "success": None,
                    "sequence": len(tool_events),
                })
        elif entry.get("role") == "tool":
            call_id = str(entry.get("tool_call_id") or "")
            index = pending.get(call_id)
            if index is None and tool_events:
                index = next((i for i in range(len(tool_events) - 1, -1, -1) if tool_events[i]["result"] is None), None)
            if index is not None:
                result = entry.get("content")
                text = result if isinstance(result, str) else canonical_json(result)
                tool_events[index]["result"] = text
                tool_events[index]["success"] = not text.startswith("Error executing ")

    return {
        "tool_events": tool_events,
        "model_call_count": turns,
        "usage": usage if usage_seen else {key: None for key in usage},
        "actual_models": sorted(model_names),
        "session_hash": sha256_file(path),
    }


def parse_proxy_events(path: Path | None) -> dict[str, Any]:
    if path is None or not path.exists():
        return {
            "usage": {"input_tokens": None, "output_tokens": None, "total_tokens": None},
            "model_call_count": None,
            "actual_models": [],
            "events_hash": None,
        }
    requests: dict[int, dict[str, Any]] = {}
    responses: dict[int, dict[str, Any]] = {}
    for line in path.read_text(errors="replace").splitlines():
        if not line.strip():
            continue
        event = json.loads(line)
        if event.get("kind") == "request":
            requests[int(event["call_id"])] = event
        elif event.get("kind") == "response":
            responses[int(event["call_id"])] = event
    if not requests or set(requests) != set(responses):
        return {
            "usage": {"input_tokens": None, "output_tokens": None, "total_tokens": None},
            "model_call_count": None,
            "actual_models": [],
            "events_hash": sha256_file(path),
        }
    usage = {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0}
    models: set[str] = set()
    for response in responses.values():
        raw = response.get("usage") or {}
        values = (
            raw.get("prompt_tokens", raw.get("input_tokens")),
            raw.get("completion_tokens", raw.get("output_tokens")),
            raw.get("total_tokens"),
        )
        if not all(isinstance(value, int) and value >= 0 for value in values):
            return {
                "usage": {"input_tokens": None, "output_tokens": None, "total_tokens": None},
                "model_call_count": len(requests),
                "actual_models": sorted(models),
                "events_hash": sha256_file(path),
            }
        usage["input_tokens"] += values[0]
        usage["output_tokens"] += values[1]
        usage["total_tokens"] += values[2]
        if isinstance(response.get("model"), str) and response["model"]:
            models.add(response["model"])
    return {
        "usage": usage,
        "model_call_count": len(requests),
        "actual_models": sorted(models),
        "events_hash": sha256_file(path),
    }


def _infra_reason(result: dict[str, Any]) -> str | None:
    if result.get("exception_info"):
        return "BENCHMARK_OR_VERIFIER_EXCEPTION"
    agent = result.get("agent_result") or {}
    status = agent.get("completion_status")
    combined = f"{agent.get('response') or ''}\n{agent.get('stderr') or ''}"
    if any(marker in combined for marker in PROVIDER_MARKERS):
        return "MODEL_UPSTREAM_UNAVAILABLE"
    if status == "error":
        return "AGENT_RUNNER_ERROR"
    return None


def adapt_trial(
    trial_dir: Path,
    *,
    arm: str,
    phase: str,
    protocol_hash: str,
    expected_model: str,
    injected_assets: list[dict[str, str]] | None = None,
    injection_receipt: dict[str, Any] | None = None,
    proxy_events_path: Path | None = None,
) -> dict[str, Any]:
    if arm not in {"vanilla", "memory", "skill"}:
        raise ValueError("UNKNOWN_ARM")
    if phase not in {"smoke", "experience", "development", "test_checkpoint", "test"}:
        raise ValueError("UNKNOWN_PHASE")
    result_path = trial_dir / "result.json"
    if not result_path.exists():
        raise FileNotFoundError("OFFICIAL_RESULT_MISSING")
    result = json.loads(result_path.read_text())
    session_path = trial_dir / "session.jsonl"
    session = parse_session(session_path)
    proxy = parse_proxy_events(proxy_events_path)
    verifier = result.get("verifier_result") or {}
    reward = verifier.get("reward")
    if not isinstance(reward, (int, float)) or reward not in (0, 1, 0.0, 1.0):
        raise ValueError("OFFICIAL_REWARD_INVALID")

    infra_reason = _infra_reason(result)
    completion = (result.get("agent_result") or {}).get("completion_status")
    if infra_reason:
        status, failure = "INFRA_ERROR", infra_reason
    elif completion == "timeout":
        status, failure = "TASK_FAIL", "BUDGET_EXHAUSTED"
    else:
        status, failure = ("TASK_PASS", None) if reward == 1 else ("TASK_FAIL", "VERIFIER_REJECTED")

    usage = {
        "input_tokens": proxy["usage"]["input_tokens"],
        "output_tokens": proxy["usage"]["output_tokens"],
        "total_tokens": proxy["usage"]["total_tokens"],
        "model_call_count": proxy["model_call_count"],
        "tool_call_count": len(session["tool_events"]),
    }
    if status != "INFRA_ERROR" and any(usage[key] is None for key in ("input_tokens", "output_tokens", "total_tokens", "model_call_count")):
        status, failure = "INFRA_ERROR", "USAGE_EVIDENCE_MISSING"

    actual_models = proxy["actual_models"] or session["actual_models"]
    if actual_models and any(model != expected_model for model in actual_models):
        status, failure = "INFRA_ERROR", "ACTUAL_MODEL_MISMATCH"

    assets = injected_assets or []
    if arm == "vanilla" and assets:
        raise ValueError("VANILLA_ASSET_INJECTION_FORBIDDEN")
    if arm != "vanilla" and len(assets) > 2:
        raise ValueError("RETRIEVAL_TOP_K_EXCEEDED")
    if injection_receipt is not None:
        expected_kind = {"memory": "memory", "skill": "skill"}.get(arm)
        if expected_kind is None or injection_receipt.get("kind") != expected_kind:
            raise ValueError("INJECTION_RECEIPT_ARM_MISMATCH")
        if injection_receipt.get("assets") != assets:
            raise ValueError("INJECTION_RECEIPT_ASSET_MISMATCH")
    normalized = {
        "schema": "tdai-evoagentbench-trial-v1",
        "benchmark": "EvoAgentBench-compatible",
        "domain": "code_implementation",
        "phase": phase,
        "arm": arm,
        "task_id": str(result.get("task_name")),
        "trial": int(result.get("trial", 1)),
        "attempt": int(result.get("attempt", 1)),
        "status": status,
        "failure_reason": failure,
        "reward": float(reward),
        "host_completion": "host_task_complete" if status != "INFRA_ERROR" else None,
        "session_id": result.get("session_id"),
        "started_at": result.get("started_at"),
        "ended_at": result.get("ended_at"),
        "elapsed_ms": round(float((result.get("agent_result") or {}).get("elapsed_sec") or 0) * 1000),
        "final_output": (result.get("agent_result") or {}).get("response") or "",
        "verifier": {
            "reward": float(reward),
            "passed": verifier.get("passed"),
            "total": verifier.get("total"),
            "error": verifier.get("error"),
        },
        "usage": usage,
        "tool_events": session["tool_events"],
        "actual_model": actual_models[0] if len(actual_models) == 1 else None,
        "expected_model": expected_model,
        "injected_assets": assets,
        "retrieval_count": len(assets),
        "candidate_artifact_hash": injection_receipt.get("candidate_artifact_hash") if injection_receipt else None,
        "retrieval_algorithm": injection_receipt.get("algorithm") if injection_receipt else None,
        "protocol_hash": protocol_hash,
        "source_artifacts": {
            "result_sha256": sha256_file(result_path),
            "session_sha256": session["session_hash"],
            "proxy_events_sha256": proxy["events_hash"],
            "verifier_details_sha256": sha256_file(trial_dir / "verifier" / "details.json") if (trial_dir / "verifier" / "details.json").exists() else None,
        },
    }
    normalized["evidence_hash"] = sha256_json(normalized)
    return normalized


def candidate_contamination(candidate: str, test_ids: list[str]) -> list[str]:
    findings: list[str] = []
    for task_id in test_ids:
        if re.search(rf"(?<![\w-]){re.escape(task_id)}(?![\w-])", candidate):
            findings.append(f"TEST_ID:{task_id}")
    for marker in ("/verifier/", "test_checkpoint", "official_test", "release_v6/test"):
        if marker.lower() in candidate.lower():
            findings.append(f"TEST_PATH_MARKER:{marker}")
    return findings
