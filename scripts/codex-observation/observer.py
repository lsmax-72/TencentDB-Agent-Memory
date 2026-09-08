#!/usr/bin/env python3
"""Capture Codex lifecycle events without blocking the Codex run."""

from __future__ import annotations

import fcntl
import hashlib
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DEFAULT_CONFIG = Path.home() / ".codex" / "tencentdb-observer.json"
SENSITIVE_KEY = re.compile(r"(?:api[_-]?key|password|secret|token|authorization|credential)", re.I)
SENSITIVE_TEXT = [
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----"),
    re.compile(r"\b(?:Bearer|Basic)\s+[A-Za-z0-9+/_=.-]{8,}", re.I),
    re.compile(r"\b(?:sk-mem-|sk-proj-|sk-)[A-Za-z0-9_-]{12,}"),
    re.compile(r"(?i)((?:api[_-]?key|password|secret[_-]?key|access[_-]?token|authorization)\s*[:=]\s*)([^\s,;}]+)"),
]


def _atomic_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temp = path.with_suffix(path.suffix + f".{os.getpid()}.tmp")
    temp.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    os.chmod(temp, 0o600)
    os.replace(temp, path)


def _load_json(path: Path, fallback: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, OSError, json.JSONDecodeError):
        return fallback


def _clean_text(value: str) -> str:
    result = value
    for pattern in SENSITIVE_TEXT:
        if pattern.groups:
            result = pattern.sub(lambda match: f"{match.group(1)}[REDACTED_CREDENTIAL]", result)
        else:
            result = pattern.sub("[REDACTED_CREDENTIAL]", result)
    return result


def _sanitize(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): "[REDACTED_CREDENTIAL]" if SENSITIVE_KEY.search(str(key)) else _sanitize(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_sanitize(item) for item in value]
    if isinstance(value, str):
        return _clean_text(value)
    return value


def _text(value: Any, limit: int) -> str:
    if isinstance(value, str):
        result = _clean_text(value)
    else:
        result = json.dumps(_sanitize(value), ensure_ascii=False, separators=(",", ":"), default=str)
    if len(result) <= limit:
        return result
    return result[: limit - 22] + "\n[TRUNCATED_BY_HOOK]"


def _tool_success(response: Any) -> bool:
    if not isinstance(response, dict):
        return True
    if response.get("isError") is True or response.get("success") is False:
        return False
    exit_code = response.get("exit_code", response.get("exitCode"))
    if isinstance(exit_code, int) and exit_code != 0:
        return False
    return str(response.get("status", "")).lower() not in {"error", "failed", "failure"}


def _event_id(session_id: str, turn_id: str, terminal: str) -> str:
    return hashlib.sha256(f"codex-observation-v1\0{session_id}\0{turn_id}\0{terminal}".encode()).hexdigest()


def _load_config(path: Path) -> dict[str, Any] | None:
    config = _load_json(path, None)
    if not isinstance(config, dict) or config.get("enabled") is not True:
        return None
    required = ("endpoint", "service_id", "team_id", "agent_id", "user_key_file", "state_dir")
    if any(not isinstance(config.get(key), str) or not config[key] for key in required):
        return None
    endpoint = urllib.parse.urlparse(config["endpoint"])
    if endpoint.scheme != "http" or endpoint.hostname not in {"127.0.0.1", "localhost", "::1"}:
        return None
    return config


def _safe_name(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def _record_event(event: dict[str, Any], state_dir: Path) -> dict[str, Any] | None:
    session_id = str(event.get("session_id") or "")
    event_name = str(event.get("hook_event_name") or "")
    turn_id = str(event.get("turn_id") or "")
    if not session_id or event_name not in {"SessionStart", "UserPromptSubmit", "PostToolUse", "Stop", "Interrupt", "SessionEnd"}:
        return None

    state_file = state_dir / "sessions" / f"{_safe_name(session_id)}.json"
    lock_file = state_dir / "locks" / f"{_safe_name(session_id)}.lock"
    lock_file.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with lock_file.open("a+", encoding="utf-8") as lock:
        os.chmod(lock_file, 0o600)
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        state = _load_json(state_file, {"session_id": session_id, "turns": {}})
        turns = state.setdefault("turns", {})
        state["cwd"] = _text(event.get("cwd", ""), 4_000)
        state["model"] = _text(event.get("model", ""), 200)
        state["permission_mode"] = _text(event.get("permission_mode", ""), 80)
        if turn_id and event_name in {"UserPromptSubmit", "PostToolUse", "Stop", "Interrupt"}:
            turn = turns.setdefault(turn_id, {"prompt": "", "tools": []})
            if event_name == "UserPromptSubmit":
                turn["prompt"] = _text(event.get("prompt", ""), 100_000)
            elif event_name == "PostToolUse":
                tool_id = _text(event.get("tool_use_id", "unknown"), 200)
                if not any(item.get("tool_use_id") == tool_id for item in turn["tools"]):
                    turn["tools"].append({
                        "tool_use_id": tool_id,
                        "name": _text(event.get("tool_name", "unknown"), 120),
                        "arguments": _text(event.get("tool_input"), 20_000),
                        "result": _text(event.get("tool_response"), 40_000),
                        "success": _tool_success(event.get("tool_response")),
                        "sequence": len(turn["tools"]),
                    })
            if event_name in {"Stop", "Interrupt"}:
                terminal = event_name.upper()
                payload = {
                    "team_id": "", "agent_id": "", "source": "codex",
                    "event_id": _event_id(session_id, turn_id, terminal),
                    "session_id": session_id, "turn_id": turn_id, "terminal_event": terminal,
                    "task_input": _text(turn.get("prompt", ""), 100_000),
                    "final_output": _text(event.get("last_assistant_message", ""), 100_000),
                    "tool_events": turn.get("tools", [])[:100],
                    "usage": {"input_tokens": None, "output_tokens": None, "model_calls": None, "tool_calls": len(turn.get("tools", []))},
                    "actual_model": state.get("model", ""), "cwd": state.get("cwd", ""),
                    "permission_mode": state.get("permission_mode", ""),
                }
                # The durable outbox owns terminal evidence; keep session state bounded and ephemeral.
                turns.pop(turn_id, None)
                _atomic_json(state_file, state)
                return payload
        if event_name == "SessionEnd" and not turns:
            try:
                state_file.unlink()
            except FileNotFoundError:
                pass
            return None
        # Retain only recent turns; terminal payloads remain immutable in the outbox.
        if len(turns) > 50:
            state["turns"] = dict(list(turns.items())[-50:])
        _atomic_json(state_file, state)
    return None


def _post(config: dict[str, Any], payload: dict[str, Any]) -> bool:
    key_path = Path(os.path.expanduser(config["user_key_file"]))
    try:
        user_key = key_path.read_text(encoding="utf-8").strip()
    except OSError:
        return False
    if not user_key:
        return False
    body = {**payload, "team_id": config["team_id"], "agent_id": config["agent_id"]}
    request = urllib.request.Request(
        config["endpoint"], data=json.dumps(body, ensure_ascii=False).encode(), method="POST",
        headers={"content-type": "application/json", "x-tdai-service-id": config["service_id"], "x-tdai-user-key": user_key},
    )
    try:
        with urllib.request.urlopen(request, timeout=float(config.get("timeout_seconds", 0.8))) as response:
            envelope = json.loads(response.read(1_000_000))
            return response.status == 200 and envelope.get("code") == 0
    except (OSError, ValueError, urllib.error.URLError, urllib.error.HTTPError, json.JSONDecodeError):
        return False


def _flush(config: dict[str, Any], state_dir: Path) -> None:
    outbox = state_dir / "outbox"
    outbox.mkdir(parents=True, exist_ok=True, mode=0o700)
    for path in sorted(outbox.glob("*.json"))[:20]:
        payload = _load_json(path, None)
        if isinstance(payload, dict) and _post(config, payload):
            try:
                path.unlink()
            except OSError:
                pass
        else:
            # One unavailable local endpoint is enough; do not spend the hook timeout retrying every item.
            break


def handle_event(event: dict[str, Any], config_path: Path = DEFAULT_CONFIG) -> bool:
    config = _load_config(config_path)
    if config is None:
        return False
    state_dir = Path(os.path.expanduser(config["state_dir"]))
    state_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    payload = _record_event(event, state_dir)
    if payload is not None:
        pending = state_dir / "outbox" / f"{payload['event_id']}.json"
        if not pending.exists():
            _atomic_json(pending, payload)
        _flush(config, state_dir)
    return True


def main() -> int:
    try:
        event = json.load(sys.stdin)
        if isinstance(event, dict):
            config_path = Path(os.environ.get("TDAI_CODEX_OBSERVER_CONFIG", str(DEFAULT_CONFIG))).expanduser()
            handle_event(event, config_path)
    except Exception:
        # Observation must never break or alter the Codex task.
        pass
    sys.stdout.write("{}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
