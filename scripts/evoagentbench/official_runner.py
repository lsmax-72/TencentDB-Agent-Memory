#!/usr/bin/env python3
"""Run the pinned benchmark while preserving nanobot's raw final response."""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path
from typing import Any


EVO_REPO = Path("/Users/lsmax/Coder/EvoAgentBench")
BENCHMARK_SRC = EVO_REPO / "benchmark/src"


def raw_final_assistant_response(session_path: Path) -> str | None:
    if not session_path.is_file():
        return None
    for line in reversed(session_path.read_text().splitlines()):
        record = json.loads(line)
        content = record.get("content") if record.get("role") == "assistant" else None
        if isinstance(content, str) and content.strip():
            return content
    return None


def install_nanobot_response_capture() -> None:
    from agents.nanobot.nanobot import NanobotAdapter

    original = NanobotAdapter.call_agent

    def call_agent(self: Any, prompt: str, session_id: str, timeout: int = 3600, cwd: str | None = None) -> dict[str, Any]:
        result = original(self, prompt, session_id, timeout=timeout, cwd=cwd)
        raw_response = raw_final_assistant_response(self._session_file(session_id))
        if raw_response:
            cli_response = result.get("response") or ""
            result["response"] = raw_response
            result["response_capture"] = "raw_session_final_assistant"
            result["cli_response_sha256"] = hashlib.sha256(cli_response.encode()).hexdigest()
        return result

    NanobotAdapter.call_agent = call_agent


def main() -> None:
    sys.path.insert(0, str(BENCHMARK_SRC))
    install_nanobot_response_capture()
    from run import main as official_main

    official_main()


if __name__ == "__main__":
    main()
