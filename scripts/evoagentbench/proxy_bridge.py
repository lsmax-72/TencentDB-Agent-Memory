#!/usr/bin/env python3
"""Loopback-only identity bridge from official nanobot to MemoryProxy."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Lock


class BridgeState:
    def __init__(self, config: dict, events: Path):
        self.config = config
        self.events = events
        self.lock = Lock()
        self.sequence = 0

    def append(self, event: dict) -> None:
        with self.lock:
            with self.events.open("a") as handle:
                handle.write(json.dumps(event, ensure_ascii=False, separators=(",", ":")) + "\n")

    def call_id(self) -> int:
        with self.lock:
            self.sequence += 1
            return self.sequence


def upstream_headers(config: dict) -> dict[str, str]:
    """Keep benchmark calls observable while excluding all formal asset hooks."""
    return {
        "content-type": "application/json",
        "authorization": f"Bearer {config['user_key']}",
        "x-tdai-user-key": config["user_key"],
        "x-team-id": config["team_id"],
        "x-agent-id": config["agent_id"],
        "x-task-id": config["task_id"],
        "x-session-id": config["session_id"],
        # The bridge uses Proxy's dsh auxiliary route so formal Skill/Memory
        # hooks stay disabled. Candidate assets are injected by the adapter.
        "x-deepseek-harness-compact": "1",
    }


def validate_config(config: dict) -> None:
    required = {"client_token", "user_key", "team_id", "agent_id", "task_id", "session_id", "model", "memory_proxy_url"}
    proxy_url = config.get("memory_proxy_url", "")
    if set(config) < required or not proxy_url.startswith("http://127.0.0.1:") or "/dsh/" not in proxy_url:
        raise ValueError("PRIVATE_BRIDGE_CONFIG_INVALID")


class Handler(BaseHTTPRequestHandler):
    server_version = "tdai-evoagentbench-bridge/1"

    def log_message(self, _format: str, *_args: object) -> None:
        return

    def _json(self, status: int, body: dict) -> None:
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:
        if self.path == "/health":
            self._json(200, {"status": "ok"})
        else:
            self._json(404, {"error": "not_found"})

    def do_POST(self) -> None:
        state: BridgeState = self.server.state  # type: ignore[attr-defined]
        expected = f"Bearer {state.config['client_token']}"
        if self.path != "/v1/chat/completions" or self.headers.get("authorization") != expected:
            self._json(403, {"error": "bridge_scope_denied"})
            return
        length = int(self.headers.get("content-length", "0"))
        raw = self.rfile.read(length)
        try:
            body = json.loads(raw)
        except json.JSONDecodeError:
            self._json(400, {"error": "invalid_json"})
            return
        if body.get("model") != state.config["model"] or body.get("temperature") != 0:
            self._json(400, {"error": "model_contract_rejected"})
            return
        call_id = state.call_id()
        state.append({
            "kind": "request",
            "call_id": call_id,
            "model": body.get("model"),
            "temperature": body.get("temperature"),
            "isolation_mode": "evaluation_auxiliary",
            "body_sha256": hashlib.sha256(raw).hexdigest(),
        })
        headers = upstream_headers(state.config)
        request = urllib.request.Request(state.config["memory_proxy_url"], raw, headers, method="POST")
        try:
            with urllib.request.urlopen(request, timeout=state.config.get("timeout_seconds", 1860)) as response:
                payload = response.read()
                status = response.status
                response_headers = dict(response.headers.items())
        except urllib.error.HTTPError as error:
            payload, status, response_headers = error.read(), error.code, dict(error.headers.items())
        except Exception as error:
            state.append({"kind": "transport_error", "call_id": call_id, "error_type": type(error).__name__})
            self._json(502, {"error": "memory_proxy_unavailable"})
            return
        try:
            value = json.loads(payload)
        except json.JSONDecodeError:
            value = {}
        state.append({
            "kind": "response",
            "call_id": call_id,
            "status": status,
            "model": value.get("model"),
            "usage": value.get("usage"),
            "body_sha256": hashlib.sha256(payload).hexdigest(),
        })
        self.send_response(status)
        self.send_header("content-type", response_headers.get("content-type", "application/json"))
        self.send_header("content-length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--events", type=Path, required=True)
    parser.add_argument("--port-file", type=Path, required=True)
    args = parser.parse_args()
    config = json.loads(args.config.read_text())
    validate_config(config)
    args.events.parent.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    server.state = BridgeState(config, args.events)  # type: ignore[attr-defined]
    args.port_file.write_text(str(server.server_address[1]))
    os.chmod(args.port_file, 0o600)
    try:
        server.serve_forever()
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
