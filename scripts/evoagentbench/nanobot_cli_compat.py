#!/usr/bin/env python3
"""Translate EvoAgentBench's newer nanobot CLI flags for nanobot 0.1.4."""

from __future__ import annotations

import json
import os
import shutil
import sys
from pathlib import Path


REAL_NANOBOT = Path("/Users/lsmax/Coder/EvoAgentBench/.venv-tdai/bin/nanobot")


def prepare_invocation(argv: list[str]) -> tuple[list[str], dict[str, str]]:
    if not argv or argv[0] != "agent":
        raise ValueError("COMPAT_ONLY_SUPPORTS_AGENT")
    args = list(argv)
    try:
        workspace_index = args.index("--workspace")
        config_index = args.index("--config")
        workspace = Path(args[workspace_index + 1]).resolve()
        config_path = Path(args[config_index + 1]).resolve()
    except (ValueError, IndexError) as error:
        raise ValueError("COMPAT_WORKSPACE_CONFIG_REQUIRED") from error
    if config_path.parent != workspace or not config_path.is_file():
        raise ValueError("COMPAT_CONFIG_OUTSIDE_WORKSPACE")
    config = json.loads(config_path.read_text())
    configured_workspace = Path(
        config.get("agents", {}).get("defaults", {}).get("workspace", "")
    ).resolve()
    if configured_workspace != workspace:
        raise ValueError("COMPAT_WORKSPACE_MISMATCH")

    compat_home = workspace / ".tdai-nanobot-home"
    destination = compat_home / ".nanobot" / "config.json"
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(config_path, destination)
    destination.chmod(0o600)

    translated = [
        item
        for index, item in enumerate(args)
        if index not in {workspace_index, workspace_index + 1, config_index, config_index + 1}
    ]
    env = dict(os.environ)
    env["HOME"] = str(compat_home)
    return [str(REAL_NANOBOT), *translated], env


def main() -> None:
    command, env = prepare_invocation(sys.argv[1:])
    if not REAL_NANOBOT.is_file():
        raise FileNotFoundError("PINNED_NANOBOT_CLI_MISSING")
    os.execve(str(REAL_NANOBOT), command, env)


if __name__ == "__main__":
    main()
