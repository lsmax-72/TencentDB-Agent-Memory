#!/usr/bin/env python3
"""Translate EvoAgentBench's newer nanobot CLI flags for nanobot 0.1.4."""

from __future__ import annotations

import json
import os
import shutil
import sys
from pathlib import Path

try:
    from .retrieval import (
        ALGORITHM, APPLICABILITY_ALGORITHM, injection_text, select_assets,
        select_skill_assets_for_algorithm,
    )
except ImportError:  # Executed by EvoAgentBench as a standalone CLI path.
    from retrieval import (
        ALGORITHM, APPLICABILITY_ALGORITHM, injection_text, select_assets,
        select_skill_assets_for_algorithm,
    )


REAL_NANOBOT = Path("/Users/lsmax/Coder/EvoAgentBench/.venv-tdai/bin/nanobot")


def _write_new(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2)
        handle.write("\n")


def _inject_assets(args: list[str], workspace: Path, env: dict[str, str]) -> list[str]:
    pool_value = env.get("TDAI_EVO_ASSET_POOL")
    if not pool_value:
        return args
    try:
        message_index = args.index("--message") + 1
        pool_path = Path(pool_value).resolve()
        receipt_path = Path(env["TDAI_EVO_INJECTION_RECEIPT"]).resolve()
        run_private = Path(env["TDAI_EVO_RUN_PRIVATE"]).resolve()
        kind = env["TDAI_EVO_ASSET_KIND"]
        top_k = int(env["TDAI_EVO_ASSET_TOP_K"])
        algorithm = env.get("TDAI_EVO_RETRIEVAL_ALGORITHM", ALGORITHM)
    except (KeyError, ValueError, IndexError) as error:
        raise ValueError("COMPAT_INJECTION_CONFIG_INVALID") from error
    if pool_path.parent != run_private or receipt_path.parent != run_private:
        raise ValueError("COMPAT_INJECTION_PATH_OUTSIDE_RUN")
    assets = json.loads(pool_path.read_text())
    if not isinstance(assets, list):
        raise ValueError("COMPAT_ASSET_POOL_INVALID")
    decisions = None
    if algorithm == ALGORITHM:
        selected = select_assets(args[message_index], kind, assets, top_k=top_k)
    elif algorithm == APPLICABILITY_ALGORITHM and kind == "skill":
        selected, decisions = select_skill_assets_for_algorithm(
            args[message_index], assets, algorithm, top_k=top_k
        )
    else:
        raise ValueError("COMPAT_RETRIEVAL_ALGORITHM_INVALID")
    args[message_index] += injection_text(kind, selected)
    receipt = {
        "schema": "tdai-evoagentbench-injection-v1",
        "kind": kind,
        "algorithm": algorithm,
        "candidate_artifact_hash": env.get("TDAI_EVO_CANDIDATE_HASH"),
        "assets": [{"id": row["id"], "hash": row["content_hash"]} for row in selected],
    }
    if decisions is not None:
        receipt["applicability_decisions"] = decisions
    _write_new(receipt_path, receipt)
    return args


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

    env = dict(os.environ)
    args = _inject_assets(args, workspace, env)
    translated = [
        item
        for index, item in enumerate(args)
        if index not in {workspace_index, workspace_index + 1, config_index, config_index + 1}
    ]
    env["HOME"] = str(compat_home)
    return [str(REAL_NANOBOT), *translated], env


def main() -> None:
    command, env = prepare_invocation(sys.argv[1:])
    if not REAL_NANOBOT.is_file():
        raise FileNotFoundError("PINNED_NANOBOT_CLI_MISSING")
    os.execve(str(REAL_NANOBOT), command, env)


if __name__ == "__main__":
    main()
