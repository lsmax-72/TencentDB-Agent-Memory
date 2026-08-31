"""One real, ephemeral nanobot run for the isolated spreadsheet smoke."""
from __future__ import annotations

import asyncio
import json
import os
import shutil
import sys
import time
import uuid
from pathlib import Path

import et_xmlfile
from nanobot import Nanobot
from nanobot.agent.hook import AgentHook

from nanobot_tool import register_spreadsheet_only
from runner_contract import build_config, usage_summary, validate_protocol
from sandbox import PythonSandbox


class Evidence(AgentHook):
    def __init__(self, protocol):
        super().__init__(reraise=True)
        self.protocol = protocol
        self.model_calls = 0
        self.events = []
        self.pending = {}
        self.usage = {}

    async def before_iteration(self, context):
        if self.model_calls >= self.protocol["max_model_calls"]:
            raise RuntimeError("BUDGET_EXHAUSTED: model calls")
        self.model_calls += 1

    async def after_iteration(self, context):
        if context.usage:
            self.usage = dict(context.usage)

    async def after_run(self, context):
        if context.usage:
            self.usage = dict(context.usage)

    async def before_execute_tool(self, context, tool_call, tool, params):
        if len(self.events) >= self.protocol["max_tool_calls"]:
            raise RuntimeError("BUDGET_EXHAUSTED: tool calls")
        event = {"sequence": len(self.events) + 1, "id": tool_call.id,
                 "name": tool_call.name, "arguments": params, "outcome": "UNKNOWN"}
        self.events.append(event)
        self.pending[tool_call.id] = event

    async def after_execute_tool(self, context, tool_call, tool, params, result):
        event = self.pending[tool_call.id]
        event.update(result=str(result), outcome="FAILED" if getattr(result, "is_error", False) else "SUCCEEDED")

    async def on_execute_tool_error(self, context, tool_call, tool, params, error):
        event = self.pending.get(tool_call.id)
        if event:
            event.update(result=str(error), outcome="FAILED")


async def run(root: Path, run_key=None):
    settings = json.loads((root / "private/settings.json").read_text())
    if run_key:
        from study_contract import verify_freeze
        verify_freeze(root)
        spec = json.loads((root / "runspecs.json").read_text())[run_key]
        settings = {**settings, **spec}
    protocol_name = "protocol-transfer-v1.json" if run_key else "protocol-smoke-v1.json"
    protocol = json.loads((root / "runtime/business" / protocol_name).read_text())
    validate_protocol(protocol)
    prepared = Path(settings["prepared"])
    manifest = json.loads((prepared / "manifest.json").read_text())
    run_dir = root / "runs" / run_key if run_key else root / "run"
    run_dir.mkdir(mode=0o700)
    inputs, outputs = run_dir / "inputs", run_dir / "outputs"
    if run_key:
        (root / 'workspaces').mkdir(mode=0o700, exist_ok=True)
        workspace = root / 'workspaces' / uuid.uuid4().hex
    else:
        workspace = run_dir / 'workspace'
    inputs.mkdir(mode=0o755)
    outputs.mkdir(mode=0o777)
    outputs.chmod(0o777)
    workspace.mkdir(mode=0o700)
    entry = next(item for item in manifest["files"] if item["role"] == "input")
    shutil.copyfile(prepared / entry["path"], inputs / "input.xlsx")
    (inputs / "input.xlsx").chmod(0o444)
    identity = settings["identity"]
    config = build_config(protocol, proxy_url=settings["proxy_url"],
                          user_key=settings["user_key"], identity=identity)
    config_path = root / "private" / (f"nanobot-{run_key}.json" if run_key else "nanobot-business.json")
    with config_path.open("x") as stream:
        json.dump(config, stream)
    config_path.chmod(0o600)
    packages = root / "runtime/packages" if run_key else Path(et_xmlfile.__file__).parent.parent
    sandbox = PythonSandbox(inputs, outputs, packages,
                            protocol["sandbox_image"])
    provider = None
    if run_key:
        from bounded_provider import create_bounded_bot
        # Let the already-frozen whole-run deadline govern; no hidden 120s retry.
        os.environ['NANOBOT_OPENAI_COMPAT_TIMEOUT_S'] = str(protocol['timeout_seconds'])
        bot, provider = create_bounded_bot(config_path, workspace, protocol)
    else:
        bot = Nanobot.from_config(config_path=config_path, workspace=workspace)
    register_spreadsheet_only(bot, sandbox)
    evidence = Evidence(protocol)
    task = manifest["task"]["instruction"] + (
        "\n\nHost delivery contract: use spreadsheet_python with openpyxl to process /inputs/input.xlsx. "
        "Save the completed workbook as /outputs/result.xlsx. Do not merely describe or print macro code. "
        + (protocol["delivery_suffix"] if run_key else
           "Preserve workbook structure and all unmatched records. Stop after verifying the output exists.")
    )
    started = time.monotonic()
    result, error = None, None
    try:
        async with bot:
            result = await asyncio.wait_for(bot.run(task, session_key=identity["session_id"],
                                                    ephemeral=True, hooks=[evidence]),
                                            timeout=protocol["timeout_seconds"])
    except Exception as exc:
        error = f"{type(exc).__name__}: {exc}"
    finally:
        sandbox.cancel()  # Stops any tool thread if the outer Agent timeout fired.
        sandbox.wait_idle(10)
    actual_model = bot.runtime.model
    raw = {"actual_model": actual_model, "model_calls": evidence.model_calls,
           "usage": (result.usage if result else evidence.usage)}
    if provider:
        raw.update(model_calls=provider.calls, usage=provider.observed_usage)
    telemetry_error = None
    try:
        usage = usage_summary(raw, evidence.events, protocol["model"])
    except Exception as exc:
        usage, telemetry_error = {}, str(exc)
    record = {"status": "COMPLETED" if result and not result.error and not error else "FAILED",
              "actual_model": actual_model, "final_output": result.content if result else "",
              "agent_error": result.error if result else error, "stop_reason": result.stop_reason if result else None,
              "usage": usage, "telemetry_error": telemetry_error, "tool_events": evidence.events,
              "elapsed_ms": round((time.monotonic() - started) * 1000),
              "session_id": identity["session_id"], "input_hash_before": entry["sha256"],
              "sdk_usage": result.usage if result else evidence.usage,
              "provider_responses": provider.responses if provider else None,
              "provider_requests": provider.requests if provider else None,
              "workspace_ref": str(workspace),
              "input_hash_after": __import__("hashlib").sha256((inputs / "input.xlsx").read_bytes()).hexdigest()}
    with (run_dir / "agent-run.json").open("x") as stream:
        json.dump(record, stream, ensure_ascii=False, indent=2)
    print(json.dumps({k: record[k] for k in ("status", "actual_model", "usage", "elapsed_ms")}))


if __name__ == "__main__":
    asyncio.run(run(Path(sys.argv[1]).resolve(), sys.argv[2] if len(sys.argv) > 2 else None))
