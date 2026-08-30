"""Thin JSON stdin/stdout bridge for the local nanobot Python SDK."""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

from nanobot import Nanobot, RuntimeContextBlock
from nanobot.agent.hook import AgentHook, AgentHookContext, AgentRunHookContext
from nanobot.agent.tools.base import Tool, ToolResult


class EvidenceHook(AgentHook):
    """Capture model iterations and full local tool execution evidence."""

    def __init__(self, evaluation_skill_content: str) -> None:
        super().__init__(reraise=True)
        self.evaluation_skill_content = evaluation_skill_content
        self.model_call_count = 0
        self.tool_events: list[dict[str, Any]] = []
        self._pending: dict[str, dict[str, Any]] = {}
        self.initial_messages: list[dict[str, Any]] | None = None
        self.usage: dict[str, int] = {}
        self.partial_output = ""

    async def before_iteration(self, context: AgentHookContext) -> None:
        self.model_call_count += 1
        if self.initial_messages is None:
            self.initial_messages = _sanitize_evaluation_skill(
                context.messages,
                self.evaluation_skill_content,
            )

    async def before_execute_tool(
        self,
        context: AgentHookContext,
        tool_call: Any,
        tool: Any,
        params: Any,
    ) -> None:
        event = {
            "sequence": len(self.tool_events) + 1,
            "name": tool_call.name,
            "arguments": params,
            "outcome": "UNKNOWN",
        }
        self.tool_events.append(event)
        self._pending[tool_call.id] = event

    async def after_iteration(self, context: AgentHookContext) -> None:
        for key, value in context.usage.items():
            if isinstance(value, int):
                self.usage[key] = self.usage.get(key, 0) + value
        if context.final_content:
            self.partial_output = context.final_content

    async def after_run(self, context: AgentRunHookContext) -> None:
        if context.usage:
            self.usage = dict(context.usage)
        if context.final_content:
            self.partial_output = context.final_content

    async def on_error(self, context: AgentRunHookContext) -> None:
        if context.usage:
            self.usage = dict(context.usage)
        if context.final_content:
            self.partial_output = context.final_content

    async def after_execute_tool(
        self,
        context: AgentHookContext,
        tool_call: Any,
        tool: Any,
        params: Any,
        result: Any,
    ) -> None:
        event = self._pending.get(tool_call.id)
        if event is None:
            return
        event["result"] = _json_value(result)
        event["outcome"] = "FAILED" if isinstance(result, ToolResult) and result.is_error else "SUCCEEDED"

    async def on_execute_tool_error(
        self,
        context: AgentHookContext,
        tool_call: Any,
        tool: Any,
        params: Any,
        error: Any,
    ) -> None:
        event = self._pending.get(tool_call.id)
        if event is not None:
            event["result"] = str(error)
            event["outcome"] = "FAILED"


class StateReadTool(Tool):
    def __init__(self, workspace: Path) -> None:
        self.workspace = workspace

    @property
    def name(self) -> str:
        return "state_read"

    @property
    def description(self) -> str:
        return "Read the current deterministic service state and revision before applying a change."

    @property
    def parameters(self) -> dict[str, Any]:
        return {"type": "object", "properties": {}, "additionalProperties": False}

    @property
    def read_only(self) -> bool:
        return True

    async def execute(self, **kwargs: Any) -> Any:
        return json.dumps(
            json.loads(self._path().read_text(encoding="utf-8")),
            ensure_ascii=False,
        )

    def _path(self) -> Path:
        return self.workspace / ".task" / "state.json"


class StateApplyTool(StateReadTool):
    @property
    def name(self) -> str:
        return "state_apply"

    @property
    def description(self) -> str:
        return "Set service mode using the revision returned by state_read; increments revision exactly once."

    @property
    def parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "mode": {"type": "string", "enum": ["safe"]},
                "observed_revision": {"type": "integer"},
            },
            "required": ["mode", "observed_revision"],
            "additionalProperties": False,
        }

    @property
    def read_only(self) -> bool:
        return False

    async def execute(self, mode: str, observed_revision: int, **kwargs: Any) -> Any:
        path = self._path()
        state = json.loads(path.read_text(encoding="utf-8"))
        if state.get("revision") != observed_revision:
            return ToolResult.error(
                f"revision mismatch: expected {observed_revision}, actual {state.get('revision')}"
            )
        state["mode"] = mode
        state["revision"] = observed_revision + 1
        path.write_text(json.dumps(state, ensure_ascii=False), encoding="utf-8")
        return json.dumps(state, ensure_ascii=False)


class StateVerifyTool(StateReadTool):
    @property
    def name(self) -> str:
        return "state_verify"

    @property
    def description(self) -> str:
        return "Verify the final service mode and revision after state_apply."

    @property
    def parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "expected_mode": {"type": "string", "enum": ["safe"]},
                "expected_revision": {"type": "integer"},
            },
            "required": ["expected_mode", "expected_revision"],
            "additionalProperties": False,
        }

    async def execute(
        self,
        expected_mode: str,
        expected_revision: int,
        **kwargs: Any,
    ) -> Any:
        state = json.loads(self._path().read_text(encoding="utf-8"))
        if state.get("mode") != expected_mode or state.get("revision") != expected_revision:
            return ToolResult.error(f"verification failed: {json.dumps(state)}")
        return json.dumps({"verified": True, "state": state}, ensure_ascii=False)


async def _run(request: dict[str, Any]) -> dict[str, Any]:
    workspace = Path(request["workspace"]).resolve()
    if not workspace.is_dir():
        return _failure("INFRA", "ENVIRONMENT_SETUP_FAILED", "workspace does not exist")

    config = json.loads(Path(request["config_path"]).expanduser().read_text(encoding="utf-8"))
    _apply_evaluation_config(config, request)
    started = time.monotonic()
    evidence = EvidenceHook(request["evaluation_skill_content"])

    with tempfile.TemporaryDirectory(prefix="nanobot-eval-config-") as temp_dir:
        config_path = Path(temp_dir) / "config.json"
        config_path.write_text(json.dumps(config, ensure_ascii=False), encoding="utf-8")
        os.chmod(config_path, 0o600)
        try:
            bot = Nanobot.from_config(
                config_path=config_path,
                workspace=workspace,
                model_preset=request["model"].get("model_preset"),
            )
            _restrict_tools(bot, request["tool_policy"], workspace)

            async def evaluation_context(context: Any) -> RuntimeContextBlock | None:
                if context.attributes.get("evaluation_session_id") != request["session_id"]:
                    return None
                return RuntimeContextBlock(
                    source="evaluation_skill_override",
                    content=request["evaluation_skill_content"],
                )

            remove_context = bot.runtime.add_context_provider(evaluation_context)
            try:
                async with bot:
                    try:
                        result = await asyncio.wait_for(
                            bot.run(
                                request["task_input"],
                                session_key=request["session_id"],
                                ephemeral=True,
                                attributes={"evaluation_session_id": request["session_id"]},
                                hooks=[evidence],
                            ),
                            timeout=max(1.0, request["budget"]["timeout_ms"] / 1000 - 5.0),
                        )
                    except TimeoutError:
                        result = None
            finally:
                remove_context()
        except Exception as error:
            return _failure(*_classify_exception(error))

    if result is None:
        usage = _map_usage(evidence.usage, evidence.model_call_count)
        if usage is None:
            return _failure(
                "INFRA",
                "MODEL_UPSTREAM_UNAVAILABLE",
                "nanobot timed out before producing usage telemetry",
            )
        return _completed_payload(
            request=request,
            bot=bot,
            evidence=evidence,
            usage=usage,
            started=started,
            final_output=evidence.partial_output,
            stop_reason="timeout",
            task_failure_code="AGENT_TIMEOUT",
        )
    if result.error:
        if _looks_upstream(result.error):
            return _failure("INFRA", "MODEL_UPSTREAM_UNAVAILABLE", result.error)
        usage = _map_usage(result.usage or evidence.usage, evidence.model_call_count)
        if usage is None:
            return _failure(
                "INFRA",
                "TELEMETRY_INCOMPLETE",
                "nanobot stopped without complete usage telemetry",
            )
        task_failure_code = (
            "BUDGET_EXHAUSTED"
            if result.stop_reason in {"max_iterations", "budget_exhausted"}
            else "AGENT_ABORTED"
        )
        return _completed_payload(
            request=request,
            bot=bot,
            evidence=evidence,
            usage=usage,
            started=started,
            final_output=result.content or evidence.partial_output,
            stop_reason=result.stop_reason,
            task_failure_code=task_failure_code,
        )
    if evidence.model_call_count > request["budget"]["max_model_calls"]:
        return _failure("TASK", "BUDGET_EXHAUSTED", "model call budget exceeded")
    if len(evidence.tool_events) > request["budget"]["max_tool_calls"]:
        return _failure("TASK", "BUDGET_EXHAUSTED", "tool call budget exceeded")

    usage = _map_usage(result.usage, evidence.model_call_count)
    if usage is None:
        return _failure("INFRA", "RUNNER_INTERNAL_ERROR", "nanobot usage is incomplete")
    return _completed_payload(
        request=request,
        bot=bot,
        evidence=evidence,
        usage=usage,
        started=started,
        final_output=result.content,
        stop_reason=result.stop_reason,
    )


def _completed_payload(
    *,
    request: dict[str, Any],
    bot: Nanobot,
    evidence: EvidenceHook,
    usage: dict[str, int],
    started: float,
    final_output: str,
    stop_reason: str | None,
    task_failure_code: str | None = None,
) -> dict[str, Any]:
    observed_conditions_hash = _observed_conditions_hash(
        evidence.initial_messages,
        bot.runtime.model,
        bot._loop.tools.get_definitions(),
    )
    return {
        "ok": True,
        "final_output": final_output,
        "actual_model": bot.runtime.model,
        "usage": usage,
        "tool_events": evidence.tool_events,
        "elapsed_ms": round((time.monotonic() - started) * 1000),
        "run_ref": request["session_id"],
        "stop_reason": stop_reason,
        "observed_conditions_hash": observed_conditions_hash,
        **({"task_failure_code": task_failure_code} if task_failure_code else {}),
    }


def _apply_evaluation_config(config: dict[str, Any], request: dict[str, Any]) -> None:
    defaults = config.setdefault("agents", {}).setdefault("defaults", {})
    defaults["temperature"] = request["model"]["temperature"]
    defaults["fallbackModels"] = []
    defaults["maxToolIterations"] = request["budget"]["max_model_calls"]
    defaults["idleCompactAfterMinutes"] = 0
    defaults.setdefault("dream", {})["enabled"] = False
    preset_name = request["model"].get("model_preset")
    if preset_name:
        preset = config.get("modelPresets", {}).get(preset_name)
        if preset is None:
            raise ValueError(f"model preset not found: {preset_name}")
        if preset.get("model") != request["model"]["model_id"]:
            raise ValueError("configured preset model differs from RunSpec")
        if preset.get("provider") != request["model"]["provider"]:
            raise ValueError("configured preset provider differs from RunSpec")
        preset["temperature"] = request["model"]["temperature"]
    tools = config.setdefault("tools", {})
    tools["restrictToWorkspace"] = True


def _restrict_tools(bot: Nanobot, policy: dict[str, Any], workspace: Path) -> None:
    # nanobot 0.3.0 SDK does not expose per-run tool registration. Keep the
    # verified internal registry access confined to this host bridge.
    registry = bot._loop.tools
    allowed = set(policy["allowed_tools"])
    for name in list(registry.tool_names):
        if name not in allowed:
            registry.unregister(name)
    if policy.get("enable_state_tools"):
        registry.register(StateReadTool(workspace))
        registry.register(StateApplyTool(workspace))
        registry.register(StateVerifyTool(workspace))


def _map_usage(usage: dict[str, int], model_call_count: int) -> dict[str, int] | None:
    prompt = usage.get("prompt_tokens")
    completion = usage.get("completion_tokens")
    total = usage.get("total_tokens")
    if prompt is None or completion is None:
        return None
    if total is None:
        total = prompt + completion
    mapped = {
        "input_tokens": prompt,
        "output_tokens": completion,
        "total_tokens": total,
        "model_call_count": model_call_count,
    }
    if "cache_read_tokens" in usage:
        mapped["cache_read_tokens"] = usage["cache_read_tokens"]
    if "cache_write_tokens" in usage:
        mapped["cache_write_tokens"] = usage["cache_write_tokens"]
    return mapped


def _classify_exception(error: Exception) -> tuple[str, str, str]:
    message = str(error)
    if isinstance(error, (FileNotFoundError, PermissionError, ValueError)):
        return "INFRA", "ENVIRONMENT_SETUP_FAILED", message
    if _looks_upstream(message):
        return "INFRA", "MODEL_UPSTREAM_UNAVAILABLE", message
    return "INFRA", "RUNNER_INTERNAL_ERROR", message


def _looks_upstream(message: str) -> bool:
    lowered = message.lower()
    markers = ("connection", "timeout", "rate limit", "429", "5xx", "502", "503", "504", "upstream")
    return any(marker in lowered for marker in markers)


def _json_value(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool, list, dict)):
        return value
    return str(value)


def _sanitize_evaluation_skill(value: Any, skill_content: str) -> Any:
    if isinstance(value, str):
        return value.replace(skill_content, "<evaluation_skill>CONTENT</evaluation_skill>")
    if isinstance(value, list):
        return [_sanitize_evaluation_skill(item, skill_content) for item in value]
    if isinstance(value, dict):
        return {
            key: _sanitize_evaluation_skill(item, skill_content)
            for key, item in value.items()
        }
    return value


def _observed_conditions_hash(
    messages: list[dict[str, Any]] | None,
    model: str,
    tool_definitions: list[dict[str, Any]],
) -> str:
    payload = {
        "messages": messages or [],
        "model": model,
        "tools": tool_definitions,
    }
    canonical = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return "sha256:" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _failure(kind: str, code: str, message: str) -> dict[str, Any]:
    return {"ok": False, "error": {"kind": kind, "code": code, "message": message[:2_000]}}


def main() -> None:
    try:
        request = json.load(sys.stdin)
        response = asyncio.run(_run(request))
    except Exception as error:
        response = _failure("INFRA", "RUNNER_INTERNAL_ERROR", str(error))
    json.dump(response, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
