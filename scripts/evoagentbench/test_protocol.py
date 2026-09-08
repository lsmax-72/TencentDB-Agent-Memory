import json
import tempfile
import unittest
from pathlib import Path

from scripts.evoagentbench.adapter import adapt_trial, candidate_contamination
from scripts.evoagentbench.metrics import compare
from scripts.evoagentbench.protocol import build_protocol, sha256_json
from scripts.evoagentbench.report import build as build_report


class ProtocolTests(unittest.TestCase):
    def split(self):
        return {"train": [f"tr-{i}" for i in range(182)], "test": [f"te-{i}" for i in range(86)]}

    def test_selection_is_deterministic_and_disjoint(self):
        first = build_protocol(self.split())
        second = build_protocol(self.split())
        self.assertEqual(first, second)
        selected = first["selection"]
        self.assertEqual(selected["smoke"], selected["experience"][:2])
        self.assertFalse(set(selected["experience"]) & set(selected["development"]))
        self.assertFalse(set(selected["final_train"]) & set(selected["final_test"]))

    def test_frozen_hash_excludes_itself(self):
        protocol = build_protocol(self.split())
        expected = dict(protocol)
        digest = expected.pop("protocol_hash")
        self.assertEqual(digest, sha256_json(expected))

    def test_wrong_split_size_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "PINNED_SPLIT_SIZE_MISMATCH"):
            build_protocol({"train": [], "test": []})


class AdapterTests(unittest.TestCase):
    def trial(self, result, session_lines):
        root = tempfile.TemporaryDirectory()
        path = Path(root.name)
        (path / "result.json").write_text(json.dumps(result))
        if session_lines is not None:
            (path / "session.jsonl").write_text("\n".join(json.dumps(line) for line in session_lines) + "\n")
        return root, path

    def test_maps_official_result_and_tool_evidence(self):
        result = {"task_name": "tr-1", "trial": 1, "attempt": 1, "session_id": "s", "agent_result": {"completion_status": "completed", "elapsed_sec": 1.5, "response": "ok"}, "verifier_result": {"reward": 1.0, "passed": 4, "total": 4}, "token_usage": {"input": 10, "output": 5, "total": 15}}
        session = [
            {"role": "assistant", "model": "qwen3.8-27b", "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}, "tool_calls": [{"id": "c1", "function": {"name": "exec", "arguments": "{\"command\":\"python x.py\"}"}}]},
            {"role": "tool", "tool_call_id": "c1", "content": "done"},
        ]
        root, path = self.trial(result, session)
        try:
            events = path / "proxy.jsonl"
            events.write_text("\n".join(json.dumps(event) for event in [
                {"kind": "request", "call_id": 1},
                {"kind": "response", "call_id": 1, "model": "qwen3.8-27b", "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}},
            ]) + "\n")
            row = adapt_trial(path, arm="vanilla", phase="smoke", protocol_hash="h", expected_model="qwen3.8-27b", proxy_events_path=events)
        finally:
            root.cleanup()
        self.assertEqual(row["status"], "TASK_PASS")
        self.assertEqual(row["usage"]["model_call_count"], 1)
        self.assertEqual(row["usage"]["tool_call_count"], 1)
        self.assertTrue(row["tool_events"][0]["success"])
        self.assertEqual(row["host_completion"], "host_task_complete")

    def test_missing_usage_is_infrastructure_error(self):
        result = {"task_name": "tr-1", "agent_result": {"completion_status": "completed", "response": "no usage"}, "verifier_result": {"reward": 0.0}}
        root, path = self.trial(result, [])
        try:
            row = adapt_trial(path, arm="vanilla", phase="smoke", protocol_hash="h", expected_model="qwen3.8-27b")
        finally:
            root.cleanup()
        self.assertEqual(row["status"], "INFRA_ERROR")
        self.assertEqual(row["failure_reason"], "USAGE_EVIDENCE_MISSING")

    def test_assets_and_contamination_are_bounded(self):
        self.assertEqual(candidate_contamination("Use abc320_a", ["abc320_a"]), ["TEST_ID:abc320_a"])
        result = {"task_name": "tr-1", "agent_result": {"completion_status": "completed"}, "verifier_result": {"reward": 0.0}, "token_usage": {"input": 1, "output": 1, "total": 2}}
        root, path = self.trial(result, [{"role": "assistant", "model": "qwen3.8-27b"}])
        try:
            with self.assertRaisesRegex(ValueError, "RETRIEVAL_TOP_K_EXCEEDED"):
                adapt_trial(path, arm="skill", phase="development", protocol_hash="h", expected_model="qwen3.8-27b", injected_assets=[{"id": str(i), "hash": "x"} for i in range(3)])
        finally:
            root.cleanup()


class MetricsTests(unittest.TestCase):
    def row(self, task, arm, reward, status="TASK_PASS"):
        return {"task_id": task, "trial": 1, "arm": arm, "reward": reward, "status": status, "protocol_hash": "p", "elapsed_ms": 10, "usage": {"total_tokens": 100, "model_call_count": 1, "tool_call_count": 0}}

    def test_three_arm_pairing_and_transfer(self):
        arms = {
            "vanilla": [self.row("a", "vanilla", 0, "TASK_FAIL"), self.row("b", "vanilla", 1)],
            "memory": [self.row("a", "memory", 0, "TASK_FAIL"), self.row("b", "memory", 1)],
            "skill": [self.row("a", "skill", 1), self.row("b", "skill", 0, "TASK_FAIL")],
        }
        result = compare(arms, "seed")
        self.assertEqual(result["comparisons"]["skill"]["counts"]["newly_fixed"], 1)
        self.assertEqual(result["comparisons"]["skill"]["counts"]["newly_broken"], 1)
        self.assertEqual(result["comparisons"]["skill"]["transfer_gain"], 0)

    def test_unpaired_runs_are_rejected(self):
        arms = {"vanilla": [self.row("a", "vanilla", 0)], "memory": [], "skill": []}
        with self.assertRaisesRegex(ValueError, "PAIRED_TASK_SET_MISMATCH"):
            compare(arms, "seed")

    def test_pilot_report_does_not_turn_no_gain_into_pass(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for arm in ("vanilla", "memory", "skill"):
                path = root / "runs" / f"development-a-{arm}-trial-1"
                path.mkdir(parents=True)
                row = self.row("a", arm, 1)
                row.update({"phase": "development", "evidence_hash": sha256_json({"arm": arm}), "retrieval_count": 0})
                (path / "evidence.json").write_text(json.dumps(row))
            report = build_report(root, "development", "pilot-r1", None)
            self.assertEqual(report["status"], "FAIL")
            self.assertIn("SKILL_TRANSFER_GAIN_NOT_POSITIVE", report["reasons"])


if __name__ == "__main__":
    unittest.main()
