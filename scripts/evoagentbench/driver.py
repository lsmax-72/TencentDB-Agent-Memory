#!/usr/bin/env python3
"""Run one immutable official EvoAgentBench trial through the local MemoryProxy."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import secrets
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from .adapter import adapt_trial
from .protocol import validate_frozen_protocol


REPO = Path(__file__).resolve().parents[2]
PROTOCOL_FILE = REPO / "scripts/evoagentbench/protocol-code-v1.json"
EVO_REPO = Path("/Users/lsmax/Coder/EvoAgentBench")
LCB_REPO = Path("/Users/lsmax/Coder/LiveCodeBench")
PYTHON = EVO_REPO / ".venv-tdai/bin/python"
NANOBOT = EVO_REPO / ".venv-tdai/bin/nanobot"
NANOBOT_COMPAT = REPO / "scripts/evoagentbench/nanobot_cli_compat.py"
DEFAULT_ROOT = Path("/Users/lsmax/Coder/evoagentbench-artifacts/code-v1")
CORE_URL = "http://127.0.0.1:8420"
PROXY_URL = "http://127.0.0.1:8096/proxy/default/v1/chat/completions"
UPSTREAM_MODELS = "http://10.195.214.152:8100/v1/models"
TEAM_NAME = "EvoAgentBench / Algorithmic Reasoning"
AGENT_NAME = "nanobot-evoagentbench-code"


def write_new(path: Path, value: Any, *, private: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    fd = os.open(path, flags, 0o600 if private else 0o644)
    with os.fdopen(fd, "w") as handle:
        if isinstance(value, str):
            handle.write(value)
        else:
            json.dump(value, handle, ensure_ascii=False, indent=2)
            handle.write("\n")


def canonical_hash(value: Any) -> str:
    data = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(data.encode()).hexdigest()


def post(url: str, body: dict[str, Any], user_key: str, timeout: int = 20) -> Any:
    headers = {
        "content-type": "application/json",
        "authorization": f"Bearer {user_key}",
        "x-tdai-user-key": user_key,
        "x-tdai-service-id": "default",
    }
    request = urllib.request.Request(url, json.dumps(body).encode(), headers, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            value = json.load(response)
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"CORE_HTTP_{error.code}") from error
    if value.get("code") != 0:
        raise RuntimeError(f"CORE_API_{value.get('code')}")
    return value.get("data")


def local_user_key() -> str:
    config = json.loads(Path("/Users/lsmax/.nanobot/config.json").read_text())
    key = config.get("providers", {}).get("tdaiProxy", {}).get("apiKey")
    if not isinstance(key, str) or not key.startswith("sk-mem-"):
        raise RuntimeError("MAIN_MEMORY_USER_KEY_UNAVAILABLE")
    return key


def api(path: str, body: dict[str, Any], user_key: str) -> Any:
    return post(f"{CORE_URL}{path}", body, user_key)


def _only_or_create(items: list[dict[str, Any]], create: callable) -> dict[str, Any]:
    if len(items) > 1:
        raise RuntimeError("DEDICATED_SCOPE_AMBIGUOUS")
    return items[0] if items else create()


def setup(root: Path) -> None:
    if root.exists():
        raise FileExistsError("BENCHMARK_ROOT_ALREADY_EXISTS")
    for path, revision in ((EVO_REPO, "948a17288782d5120778da16b4cf1cad9305d8b4"), (LCB_REPO, "28fef95ea8c9f7a547c8329f2cd3d32b92c1fa24")):
        actual = subprocess.check_output(["git", "-C", str(path), "rev-parse", "HEAD"], text=True).strip()
        if actual != revision:
            raise RuntimeError("PINNED_REPOSITORY_REVISION_MISMATCH")
    if not PYTHON.exists() or not NANOBOT.exists():
        raise RuntimeError("PINNED_BENCHMARK_ENVIRONMENT_MISSING")
    split_file = EVO_REPO / "benchmark/data/splits/code_implementation.json"
    protocol = json.loads(PROTOCOL_FILE.read_text())
    validate_frozen_protocol(protocol, json.loads(split_file.read_text()))
    user_key = local_user_key()
    user = api("/v3/meta/user/get", {"user_key": user_key}, user_key)
    teams = api("/v3/meta/team/list", {"user_key": user_key, "name": TEAM_NAME, "limit": 100}, user_key)["items"]
    team = _only_or_create(teams, lambda: api("/v3/meta/team/create", {
        "name": TEAM_NAME,
        "owner_user_id": user["user_id"],
        "description": "Official pinned Algorithmic Reasoning research; no promotion",
        "metadata_json": json.dumps({"production": False, "protocol_hash": protocol["protocol_hash"]}),
    }, user_key))
    agents = api("/v3/meta/agent/list", {"team_id": team["team_id"], "name": AGENT_NAME, "limit": 100}, user_key)["items"]
    agent = _only_or_create(agents, lambda: api("/v3/meta/agent/create", {
        "team_id": team["team_id"],
        "owner_user_id": user["user_id"],
        "name": AGENT_NAME,
        "description": "Pinned nanobot host for EvoAgentBench-compatible runs",
        "visibility": "private",
    }, user_key))
    root.mkdir(parents=True, mode=0o700)
    (root / "private").mkdir(mode=0o700)
    (root / "runs").mkdir(mode=0o700)
    scope = {"team_id": team["team_id"], "agent_id": agent["agent_id"], "owner_user_id": user["user_id"]}
    write_new(root / "scope.json", scope)
    write_new(root / "private/secrets.json", {"user_key": user_key}, private=True)
    asset_counts = {}
    for asset_type in ("skill", "chat_memory", "llm_wiki", "code_graph"):
        asset_counts[asset_type] = api("/v3/meta/asset/list", {"team_id": team["team_id"], "asset_type": asset_type, "limit": 100}, user_key)["total"]
    preflight = {
        "protocol_hash": protocol["protocol_hash"],
        "evoagentbench_revision": subprocess.check_output(["git", "-C", str(EVO_REPO), "rev-parse", "HEAD"], text=True).strip(),
        "livecodebench_revision": subprocess.check_output(["git", "-C", str(LCB_REPO), "rev-parse", "HEAD"], text=True).strip(),
        "python": subprocess.check_output([str(PYTHON), "--version"], text=True).strip(),
        "nanobot": subprocess.check_output([str(NANOBOT), "--version"], text=True).strip(),
        "provider": "vllm-via-memory-proxy",
        "model": "qwen3.8-27b",
        "temperature": 0,
        "fallback": "disabled",
        "formal_asset_counts_before": asset_counts,
        "formal_asset_snapshot_hash": canonical_hash(asset_counts),
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    write_new(root / "preflight.json", preflight)
    print(json.dumps({"status": "READY", "team_id": scope["team_id"], "agent_id": scope["agent_id"], "protocol_hash": protocol["protocol_hash"]}))


def readonly_connectivity() -> dict[str, Any]:
    checks = {}
    for name, url in (("memory_proxy", "http://127.0.0.1:8096/health"), ("vllm", UPSTREAM_MODELS)):
        try:
            with urllib.request.urlopen(url, timeout=5) as response:
                value = json.load(response)
                checks[name] = {"reachable": response.status == 200}
                if name == "vllm":
                    checks[name]["model_present"] = any(row.get("id") == "qwen3.8-27b" for row in value.get("data", []))
        except Exception as error:
            checks[name] = {"reachable": False, "error_type": type(error).__name__}
    return checks


def _phase_tasks(protocol: dict[str, Any], phase: str) -> set[str]:
    mapping = {
        "smoke": "smoke",
        "experience": "experience",
        "development": "development",
        "test_checkpoint": "test_checkpoint",
        "test": "final_test",
    }
    return set(protocol["selection"][mapping[phase]])


def _wait_file(path: Path, process: subprocess.Popen, seconds: int = 10) -> None:
    for _ in range(seconds * 10):
        if path.exists():
            return
        if process.poll() is not None:
            raise RuntimeError("PROXY_BRIDGE_DIED")
        time.sleep(0.1)
    raise TimeoutError("PROXY_BRIDGE_START_TIMEOUT")


def run_trial(root: Path, phase: str, arm: str, task_id: str, trial: int, infrastructure_retry: int | None = None) -> None:
    protocol = json.loads(PROTOCOL_FILE.read_text())
    if task_id not in _phase_tasks(protocol, phase):
        raise ValueError("TASK_NOT_IN_FROZEN_PHASE")
    if arm not in {"vanilla", "memory", "skill"}:
        raise ValueError("UNKNOWN_ARM")
    if phase in {"smoke", "experience"} and arm != "vanilla":
        raise ValueError("TRAIN_COLLECTION_IS_VANILLA_ONLY")
    retry_suffix = f"-infra-retry-{infrastructure_retry}" if infrastructure_retry is not None else ""
    run_id = f"{phase}-{task_id}-{arm}-trial-{trial}{retry_suffix}"
    run_dir = root / "runs" / run_id
    if run_dir.exists():
        raise FileExistsError("IMMUTABLE_RUN_ALREADY_EXISTS")
    run_dir.mkdir(parents=True, mode=0o700)
    private = run_dir / "private"
    private.mkdir(mode=0o700)
    scope = json.loads((root / "scope.json").read_text())
    user_key = json.loads((root / "private/secrets.json").read_text())["user_key"]
    task = api("/v3/meta/task/create", {
        "team_id": scope["team_id"], "creator_user_id": scope["owner_user_id"],
        "title": f"EvoAgentBench / {phase} / {task_id} / {arm} / trial {trial}",
        "description": "Pinned official verifier run; candidate promotion forbidden",
        "source_type": "other", "auto_assign_floating_assets": False,
        "metadata_json": json.dumps({"protocol_hash": protocol["protocol_hash"], "phase": phase, "arm": arm, "official_task_id": task_id}),
        "linked_agents": [{"agent_id": scope["agent_id"]}],
    }, user_key)
    session_id = f"eab-{secrets.token_hex(12)}"
    client_token = secrets.token_hex(32)
    bridge_config = {
        "client_token": client_token, "user_key": user_key,
        "team_id": scope["team_id"], "agent_id": scope["agent_id"], "task_id": task["task_id"],
        "session_id": session_id, "model": protocol["agent"]["model"], "memory_proxy_url": PROXY_URL,
        "timeout_seconds": protocol["agent"]["agent_timeout_seconds"] + 60,
    }
    bridge_file = private / "bridge.json"
    write_new(bridge_file, bridge_config, private=True)
    events_file, port_file = run_dir / "proxy-events.jsonl", private / "port"
    bridge = subprocess.Popen([
        str(PYTHON), "-m", "scripts.evoagentbench.proxy_bridge", "--config", str(bridge_file),
        "--events", str(events_file), "--port-file", str(port_file),
    ], cwd=REPO, stdout=subprocess.DEVNULL, stderr=(private / "bridge.log").open("x"))
    try:
        _wait_file(port_file, bridge)
        port = int(port_file.read_text())
        home = private / "home"
        (home / ".nanobot").mkdir(parents=True)
        global_config = {
            "agents": {"defaults": {"workspace": str(private / "workspace"), "model": protocol["agent"]["model"], "provider": "custom", "maxTokens": protocol["agent"]["max_output_tokens_per_call"], "temperature": 0, "maxToolIterations": protocol["agent"]["max_tool_iterations"]}},
            "providers": {"custom": {"apiKey": client_token, "apiBase": f"http://127.0.0.1:{port}/v1"}},
            "tools": {"restrictToWorkspace": True, "web": {"search": {"apiKey": ""}}},
        }
        write_new(home / ".nanobot/config.json", global_config, private=True)
        agent_yaml = f"""name: nanobot
command: {NANOBOT_COMPAT}
model: {protocol['agent']['model']}
provider: custom
providers:
  custom:
    apiKey: {client_token}
    apiBase: http://127.0.0.1:{port}/v1
maxTokens: {protocol['agent']['max_output_tokens_per_call']}
contextWindowTokens: {protocol['agent']['context_window_tokens']}
temperature: 0
max_tool_iterations: {protocol['agent']['max_tool_iterations']}
tools:
  restrictToWorkspace: true
"""
        write_new(private / "nanobot.yaml", agent_yaml, private=True)
        domain_yaml = f"""lcb_repo: {LCB_REPO}
release_version: release_v6
cache_dir: /Users/lsmax/Coder/evoagentbench-data/livecode
split_file: {EVO_REPO}/benchmark/data/splits/code_implementation.json
agent_timeout: {protocol['agent']['agent_timeout_seconds']}
test_timeout: {protocol['agent']['test_timeout_seconds']}
"""
        write_new(private / "code_implementation.yaml", domain_yaml, private=True)
        config_yaml = f"""agent_configs:
  nanobot: {private / 'nanobot.yaml'}
agent: nanobot
domain:
  name: code_implementation
  config: {private / 'code_implementation.yaml'}
job_dir: {run_dir / 'official'}
trials: 1
parallel: 1
max_retries: 0
live: false
"""
        write_new(private / "config.yaml", config_yaml, private=True)
        env = {**os.environ, "HOME": str(home), "PYTHONUNBUFFERED": "1", "NO_PROXY": "*", "no_proxy": "*", "HF_ENDPOINT": "https://hf-mirror.com"}
        log_file = private / "official.log"
        with log_file.open("x") as log:
            completed = subprocess.run([
                str(PYTHON), str(EVO_REPO / "benchmark/src/run.py"), "--config", str(private / "config.yaml"),
                "--domain", "code_implementation", "--task", task_id, "--job", "official", "--trials", "1", "--parallel", "1",
            ], cwd=EVO_REPO / "benchmark", env=env, stdout=log, stderr=subprocess.STDOUT)
        trial_dir = run_dir / "official/official" / f"{task_id}__trial_1"
        if not (trial_dir / "result.json").exists():
            log_text = log_file.read_text(errors="replace")
            reason = "HF_DATASET_UNAVAILABLE" if "Couldn't reach 'livecodebench/code_generation_lite'" in log_text else "OFFICIAL_RESULT_MISSING"
            failure = {"schema": "tdai-evoagentbench-runner-failure-v1", "run_id": run_id, "phase": phase, "arm": arm,
                "task_id": task_id, "trial": trial, "status": "INFRA_ERROR", "returncode": completed.returncode,
                "reason": reason, "protocol_hash": protocol["protocol_hash"], "infrastructure_retry": infrastructure_retry}
            failure["evidence_hash"] = canonical_hash(failure)
            write_new(run_dir / "runner-failure.json", failure)
            safe_failure = {key: failure[key] for key in ("schema", "run_id", "phase", "arm", "task_id", "trial", "status", "reason", "protocol_hash", "evidence_hash")}
            api("/v3/meta/participation-log/append", {**scope, "task_id": task["task_id"], "user_id": scope["owner_user_id"], "source": "evoagentbench-compatible", "metadata_json": json.dumps(safe_failure)}, user_key)
            api("/v3/meta/task/update", {"task_id": task["task_id"], "status": "completed", "metadata_json": json.dumps(safe_failure)}, user_key)
            raise RuntimeError("OFFICIAL_RESULT_MISSING")
        evidence = adapt_trial(trial_dir, arm=arm, phase=phase, protocol_hash=protocol["protocol_hash"], expected_model=protocol["agent"]["model"], proxy_events_path=events_file)
        evidence["run_id"] = run_id
        evidence["hub_scope"] = {**scope, "task_id": task["task_id"]}
        evidence["research_only"] = True
        evidence["promotion_allowed"] = False
        write_new(run_dir / "evidence.json", evidence)
        safe = {key: evidence[key] for key in ("schema", "phase", "arm", "task_id", "trial", "status", "failure_reason", "reward", "usage", "elapsed_ms", "actual_model", "protocol_hash", "evidence_hash")}
        api("/v3/meta/participation-log/append", {**scope, "task_id": task["task_id"], "user_id": scope["owner_user_id"], "source": "evoagentbench-compatible", "metadata_json": json.dumps(safe)}, user_key)
        api("/v3/meta/task/update", {"task_id": task["task_id"], "status": "completed", "metadata_json": json.dumps(safe)}, user_key)
        if phase in {"smoke", "experience"}:
            tool_events = [{"name": item["name"], "arguments": json.dumps(item["arguments"], ensure_ascii=False)[:20_000], "result": str(item["result"] or "")[:40_000], "success": item["success"] is True, "sequence": item["sequence"]} for item in evidence["tool_events"][:100]]
            api("/v3/evolution/task/complete", {
                "team_id": scope["team_id"], "agent_id": scope["agent_id"], "task_id": task["task_id"],
                "session_id": session_id, "run_id": run_id, "completion": "host_task_complete", "asset_ids": [],
                "task_input": f"Official EvoAgentBench Algorithmic Reasoning task {task_id}; statement retained in official artifact.",
                "final_output": evidence["final_output"][:100_000], "tool_events": tool_events,
                "usage": {"input_tokens": evidence["usage"]["input_tokens"], "output_tokens": evidence["usage"]["output_tokens"], "model_calls": evidence["usage"]["model_call_count"], "tool_calls": evidence["usage"]["tool_call_count"]},
                "actual_model": evidence["actual_model"] or "", "outcome": "PASS" if evidence["status"] == "TASK_PASS" else "FAIL" if evidence["status"] == "TASK_FAIL" else "INFRA_ERROR", "used_asset_versions": {},
            }, user_key)
        print(json.dumps({"run_id": run_id, "status": evidence["status"], "reward": evidence["reward"], "usage": evidence["usage"]}))
    finally:
        if bridge.poll() is None:
            bridge.send_signal(signal.SIGTERM)
            try:
                bridge.wait(timeout=5)
            except subprocess.TimeoutExpired:
                bridge.kill()
        try:
            bridge.stderr.close()  # type: ignore[union-attr]
        except Exception:
            pass


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["setup", "connectivity", "run"])
    parser.add_argument("--root", type=Path, default=DEFAULT_ROOT)
    parser.add_argument("--phase", choices=["smoke", "experience", "development", "test_checkpoint", "test"])
    parser.add_argument("--arm", choices=["vanilla", "memory", "skill"])
    parser.add_argument("--task")
    parser.add_argument("--trial", type=int, default=1)
    parser.add_argument("--infrastructure-retry", type=int)
    args = parser.parse_args()
    if args.command == "setup":
        setup(args.root)
    elif args.command == "connectivity":
        print(json.dumps(readonly_connectivity()))
    else:
        if not args.phase or not args.arm or not args.task:
            parser.error("run requires --phase, --arm and --task")
        if args.infrastructure_retry is not None and args.infrastructure_retry < 1:
            parser.error("--infrastructure-retry must be positive")
        run_trial(args.root, args.phase, args.arm, args.task, args.trial, args.infrastructure_retry)


if __name__ == "__main__":
    main()
