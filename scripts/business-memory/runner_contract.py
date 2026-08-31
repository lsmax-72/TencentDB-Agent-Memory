"""Pure mapping and evidence checks for the forthcoming SDK/Proxy smoke runner."""
from __future__ import annotations

from urllib.parse import urlsplit


def validate_protocol(protocol):
    if protocol.get("status") != "APPROVED_BY_USER" or not protocol.get("approval_ref"):
        raise ValueError("REVIEW_REQUIRED: no recorded user protocol decision")
    expected = {"provider": "vllm", "model": "qwen3.8-27b", "temperature": 0,
                "fallback": "DISABLED", "memory": "DISABLED", "tools": ["spreadsheet_python"],
                "max_model_calls": 6, "max_tool_calls": 6,
                "max_output_tokens_per_call": 4096, "timeout_seconds": 240,
                "tool_timeout_seconds": 20}
    if protocol.get("revision") == "business-memory-transfer-v1":
        expected.update(max_model_calls=8, max_tool_calls=8, timeout_seconds=300)
    for key, value in expected.items():
        if protocol.get(key) != value:
            raise ValueError(f"RUNSPEC_MISMATCH: {key}")


def build_config(protocol, *, proxy_url, user_key, identity):
    validate_protocol(protocol)
    url = urlsplit(proxy_url)
    if url.scheme != "http" or url.hostname != "127.0.0.1" or url.username or url.password:
        raise ValueError("new loopback test proxy required")
    if url.port in (None, 8096, 18096, 19096) or not url.path.startswith("/proxy/business-"):
        raise ValueError("do not reuse production or historical proxy")
    if not user_key or set(identity) != {"team_id", "agent_id", "task_id", "session_id"}:
        raise ValueError("complete isolated identity required")
    if any(not isinstance(v, str) or not v for v in identity.values()):
        raise ValueError("empty identity")
    return {
        "agents": {"defaults": {"provider": protocol["provider"], "model": protocol["model"],
                    "temperature": 0, "maxTokens": protocol["max_output_tokens_per_call"],
                    "maxToolIterations": protocol["max_model_calls"], "fallbackModels": [],
                    "idleCompactAfterMinutes": 0, "dream": {"enabled": False}}},
        "providers": {"vllm": {"apiBase": proxy_url, "apiKey": user_key,
                      "extraHeaders": {"x-tdai-user-key": user_key,
                                       **{"x-" + k.replace("_", "-"): v for k, v in identity.items()}}}},
        "tools": {"restrictToWorkspace": True, "mcpServers": {}},
    }


def usage_summary(raw, tool_events, expected_model):
    if raw.get("actual_model") != expected_model:
        raise ValueError("RUNSPEC_MISMATCH: actual model")
    usage = raw.get("usage", {})
    for key in ("prompt_tokens", "completion_tokens", "total_tokens"):
        if type(usage.get(key)) is not int or usage[key] < 0:
            raise ValueError(f"TELEMETRY_INCOMPLETE: {key}")
    if usage["prompt_tokens"] + usage["completion_tokens"] != usage["total_tokens"]:
        raise ValueError("TELEMETRY_INCOMPLETE: inconsistent total")
    if any(e.get("name") != "spreadsheet_python" or e.get("outcome") not in ("SUCCEEDED", "FAILED")
           or "result" not in e for e in tool_events):
        raise ValueError("TELEMETRY_INCOMPLETE: tool execution result")
    if type(raw.get("model_calls")) is not int or raw["model_calls"] < 1:
        raise ValueError("TELEMETRY_INCOMPLETE: model calls")
    return {**usage, "model_calls": raw["model_calls"], "tool_calls": len(tool_events),
            "tool_names": [e["name"] for e in tool_events]}
