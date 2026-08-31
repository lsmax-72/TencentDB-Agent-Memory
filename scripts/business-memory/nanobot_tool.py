"""Explicit opt-in SDK registration; importing this module does not start an agent."""
import asyncio

from nanobot.agent.tools.base import Tool, ToolResult

from sandbox import PythonSandbox, tool_result


class SpreadsheetPythonTool(Tool):
    name = "spreadsheet_python"
    description = (
        "Execute Python to inspect or modify local XLSX workbooks. openpyxl is available. "
        "Input files are read-only under /inputs; save deliverables under /outputs. "
        "Output files persist between calls; Python variables do not. No network, macros, "
        "host files or additional packages. Print observations/results needed for the task."
    )
    parameters = {"type": "object", "properties": {"code": {"type": "string", "maxLength": 128000}},
                  "required": ["code"], "additionalProperties": False}
    exclusive = True

    def __init__(self, sandbox: PythonSandbox):
        self.sandbox = sandbox

    async def execute(self, code: str, **kwargs):
        result = await asyncio.to_thread(self.sandbox.run, code)
        return ToolResult(tool_result(result), is_error=not result["ok"])


def register_spreadsheet_only(bot, sandbox: PythonSandbox):
    # The installed SDK exposes registration through its loop registry, as in Phase 6.
    registry = bot._loop.tools
    for name in list(registry.tool_names):
        registry.unregister(name)
    registry.register(SpreadsheetPythonTool(sandbox))
    if registry.tool_names != ["spreadsheet_python"]:
        raise RuntimeError("unexpected tool registry after restriction")
