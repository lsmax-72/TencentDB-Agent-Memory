import importlib.util
import json
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

MODULE = Path(__file__).with_name("observer.py")
SPEC = importlib.util.spec_from_file_location("codex_observer", MODULE)
observer = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
SPEC.loader.exec_module(observer)


class Handler(BaseHTTPRequestHandler):
    received = []

    def do_POST(self):
        body = self.rfile.read(int(self.headers["content-length"]))
        self.received.append((self.path, self.headers, json.loads(body)))
        response = json.dumps({"code": 0, "message": "ok", "data": {"id": "trace"}}).encode()
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(response)))
        self.end_headers()
        self.wfile.write(response)

    def log_message(self, *_args):
        pass


class ObserverTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.key = root / "key"
        self.key.write_text("test-user-key", encoding="utf-8")
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        Handler.received = []
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.config = root / "config.json"
        self.state = root / "state"
        self.config.write_text(json.dumps({
            "enabled": True,
            "endpoint": f"http://127.0.0.1:{self.server.server_port}/api/v1/evolution/observation/ingest",
            "service_id": "default", "team_id": "team", "agent_id": "agent",
            "user_key_file": str(self.key), "state_dir": str(self.state), "timeout_seconds": 1,
        }), encoding="utf-8")

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.temp.cleanup()

    def event(self, name, **extra):
        return {"session_id": "session-1", "turn_id": "turn-1", "hook_event_name": name,
                "cwd": "/tmp/repo", "model": "gpt-test", "permission_mode": "default", **extra}

    def test_collects_redacts_deduplicates_and_posts_a_turn(self):
        self.assertTrue(observer.handle_event(self.event("UserPromptSubmit", prompt="use api_key=very-secret-value"), self.config))
        tool = self.event("PostToolUse", tool_use_id="tool-1", tool_name="Bash",
                          tool_input={"command": "echo ok", "access_token": "secret"},
                          tool_response={"exit_code": 0, "output": "Bearer abcdefghijklmnop"})
        observer.handle_event(tool, self.config)
        observer.handle_event(tool, self.config)
        observer.handle_event(self.event("Stop", last_assistant_message="done"), self.config)
        self.assertEqual(len(Handler.received), 1)
        path, headers, body = Handler.received[0]
        self.assertEqual(path, "/api/v1/evolution/observation/ingest")
        self.assertEqual(headers["x-tdai-user-key"], "test-user-key")
        self.assertEqual(body["task_input"], "use api_key=[REDACTED_CREDENTIAL]")
        self.assertNotIn("secret", json.dumps(body))
        self.assertEqual(len(body["tool_events"]), 1)
        self.assertEqual(body["usage"], {"input_tokens": None, "output_tokens": None, "model_calls": None, "tool_calls": 1})
        self.assertFalse(any((self.state / "outbox").glob("*.json")))
        session_file = self.state / "sessions" / f"{observer._safe_name('session-1')}.json"
        self.assertEqual(json.loads(session_file.read_text())["turns"], {})

    def test_session_end_removes_empty_session_state(self):
        observer.handle_event(self.event("SessionStart"), self.config)
        session_file = self.state / "sessions" / f"{observer._safe_name('session-1')}.json"
        self.assertTrue(session_file.exists())
        observer.handle_event(self.event("SessionEnd"), self.config)
        self.assertFalse(session_file.exists())

    def test_unavailable_hub_keeps_a_private_outbox_and_does_not_raise(self):
        config = json.loads(self.config.read_text())
        config["endpoint"] = "http://127.0.0.1:1/api/v1/evolution/observation/ingest"
        self.config.write_text(json.dumps(config))
        observer.handle_event(self.event("UserPromptSubmit", prompt="safe"), self.config)
        self.assertTrue(observer.handle_event(self.event("Interrupt"), self.config))
        pending = list((self.state / "outbox").glob("*.json"))
        self.assertEqual(len(pending), 1)
        self.assertEqual(pending[0].stat().st_mode & 0o777, 0o600)

    def test_rejects_non_loopback_endpoint(self):
        config = json.loads(self.config.read_text())
        config["endpoint"] = "https://example.com/collect"
        self.config.write_text(json.dumps(config))
        self.assertFalse(observer.handle_event(self.event("Stop"), self.config))
        self.assertEqual(Handler.received, [])


if __name__ == "__main__":
    unittest.main()
