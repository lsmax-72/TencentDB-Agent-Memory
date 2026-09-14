import unittest

from scripts.evoagentbench.proxy_bridge import upstream_headers, validate_config


class ProxyBridgeIsolationTest(unittest.TestCase):
    def test_benchmark_calls_use_existing_auxiliary_isolation_route(self):
        headers = upstream_headers({
            "user_key": "secret", "team_id": "team", "agent_id": "agent",
            "task_id": "task", "session_id": "session",
        })
        self.assertEqual(headers["x-deepseek-harness-compact"], "1")
        self.assertEqual(headers["x-team-id"], "team")
        self.assertEqual(headers["x-agent-id"], "agent")

    def test_bridge_rejects_non_dsh_proxy_route(self):
        base = {
            "client_token": "client", "user_key": "secret", "team_id": "team",
            "agent_id": "agent", "task_id": "task", "session_id": "session",
            "model": "model",
        }
        validate_config({**base, "memory_proxy_url": "http://127.0.0.1:8096/dsh/default/v1/chat/completions"})
        with self.assertRaisesRegex(ValueError, "PRIVATE_BRIDGE_CONFIG_INVALID"):
            validate_config({**base, "memory_proxy_url": "http://127.0.0.1:8096/proxy/default/v1/chat/completions"})


if __name__ == "__main__":
    unittest.main()
