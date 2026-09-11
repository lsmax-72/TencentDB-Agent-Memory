import json
import os
import tempfile
import unittest
from pathlib import Path

from scripts.evoagentbench.adapter import adapt_trial, candidate_contamination
from scripts.evoagentbench.batch import experience_state
from scripts.evoagentbench.metrics import compare
from scripts.evoagentbench.nanobot_cli_compat import prepare_invocation
from scripts.evoagentbench.protocol import build_protocol, sha256_json
from scripts.evoagentbench.retrieval import injection_text, select_assets
from scripts.evoagentbench.report import build as build_report
from scripts.evoagentbench.refine import _response_json, _skill_response_format, _validate_memory, _validate_skills


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

    def test_experience_resume_reuses_valid_smoke_and_stops_on_incomplete_primary(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            smoke = root / "runs/smoke-tr-1-vanilla-trial-1-infra-retry-3"
            smoke.mkdir(parents=True)
            (smoke / "evidence.json").write_text(json.dumps({"status": "TASK_PASS"}))
            self.assertEqual(experience_state(root, "tr-1", {"tr-1"})[0], "complete")
            primary = root / "runs/experience-tr-2-vanilla-trial-1"
            primary.mkdir(parents=True)
            self.assertEqual(experience_state(root, "tr-2", set())[0], "incomplete")


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

    def test_nanobot_compat_translates_workspace_and_config(self):
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp).resolve()
            config = workspace / "config.json"
            config.write_text(json.dumps({"agents": {"defaults": {"workspace": str(workspace)}}}))
            command, env = prepare_invocation([
                "agent", "--session", "s", "--message", "hello", "--workspace", str(workspace),
                "--config", str(config), "--no-markdown",
            ])
            self.assertNotIn("--workspace", command)
            self.assertNotIn("--config", command)
            self.assertEqual(command[-1], "--no-markdown")
            self.assertEqual(Path(env["HOME"]), workspace / ".tdai-nanobot-home")
            self.assertTrue((Path(env["HOME"]) / ".nanobot/config.json").is_file())

    def test_retrieval_is_bounded_deterministic_and_hides_source_ids(self):
        assets = [
            {"id": "memory-train-a", "content_hash": "a", "task_intent": "shortest path in a graph", "approach": "Use Dijkstra with a heap", "key_insight": "nonnegative edges", "applicability": "weighted graph"},
            {"id": "memory-train-b", "content_hash": "b", "task_intent": "count characters", "approach": "Use a frequency map", "key_insight": "count each symbol", "applicability": "strings"},
            {"id": "memory-train-c", "content_hash": "c", "task_intent": "path reconstruction", "approach": "Store graph parents", "key_insight": "follow parent links", "applicability": "graphs"},
        ]
        selected = select_assets("Find the shortest path in a weighted graph", "memory", assets, top_k=2)
        self.assertEqual([row["id"] for row in selected], ["memory-train-a", "memory-train-c"])
        rendered = injection_text("memory", selected)
        self.assertNotIn("memory-train-a", rendered)
        self.assertIn("Dijkstra", rendered)

    def test_nanobot_compat_injects_assets_and_writes_receipt(self):
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp).resolve()
            config = workspace / "config.json"
            pool = workspace / "pool.json"
            receipt = workspace / "receipt.json"
            config.write_text(json.dumps({"agents": {"defaults": {"workspace": str(workspace)}}}))
            pool.write_text(json.dumps([{"id": "memory-a", "content_hash": "hash-a", "task_intent": "weighted graph", "approach": "Use Dijkstra", "key_insight": "nonnegative edges", "applicability": "shortest path"}]))
            previous = dict(os.environ)
            os.environ.update({
                "TDAI_EVO_ASSET_POOL": str(pool), "TDAI_EVO_ASSET_KIND": "memory",
                "TDAI_EVO_ASSET_TOP_K": "2", "TDAI_EVO_INJECTION_RECEIPT": str(receipt),
                "TDAI_EVO_RUN_PRIVATE": str(workspace),
                "TDAI_EVO_CANDIDATE_HASH": "candidate-hash",
            })
            try:
                command, _ = prepare_invocation(["agent", "--session", "s", "--message", "weighted graph shortest path", "--workspace", str(workspace), "--config", str(config)])
            finally:
                os.environ.clear(); os.environ.update(previous)
            self.assertIn("Retrieved experiences", command[command.index("--message") + 1])
            value = json.loads(receipt.read_text())
            self.assertEqual(value["assets"], [{"id": "memory-a", "hash": "hash-a"}])
            self.assertEqual(value["candidate_artifact_hash"], "candidate-hash")

    def test_refinement_rejects_single_source_or_case_specific_skill(self):
        quote_a = "Use bitmask dynamic programming to evaluate every subset transition."
        quote_b = "Apply bitmask dynamic programming over subset states and valid moves."
        memories = {
            "train-a": {"approach": quote_a, "key_insight": "subset transitions are bounded"},
            "train-b": {"approach": quote_b, "key_insight": "subset states encode remaining items"},
        }
        valid_skill = {
            "name": "Bitmask Dynamic Programming", "description": "Use bitmask dynamic programming for subset transitions.",
            "content": "Trigger on subset states. Procedure: enumerate transitions. Verification: compare small states. Stop when all states are resolved.",
            "support_task_ids": ["train-a", "train-b"],
            "support_evidence": [{"task_id": "train-a", "quote": quote_a}, {"task_id": "train-b", "quote": quote_b}],
        }
        single_skill = json.loads(json.dumps(valid_skill))
        single_skill["support_task_ids"] = ["train-a"]
        single_skill["support_evidence"] = [{"task_id": "train-a", "quote": quote_a}]
        single = {"skills": [single_skill, valid_skill]}
        with self.assertRaisesRegex(ValueError, "SKILL_SUPPORT_INVALID"):
            _validate_skills(single, memories)
        specific = {"skills": [json.loads(json.dumps(valid_skill)), {**json.loads(json.dumps(valid_skill)), "name": "Second Bitmask Skill"}]}
        specific["skills"][0]["content"] = "Use train-a's answer"
        with self.assertRaisesRegex(ValueError, "SKILL_CASE_SPECIFIC_CONTENT"):
            _validate_skills(specific, memories)
        too_long = json.loads(json.dumps(specific))
        too_long["skills"][0]["content"] = "x" * 2001
        with self.assertRaisesRegex(ValueError, "SKILL_TEXT_TOO_LONG"):
            _validate_skills(too_long, memories)

    def test_refinement_accepts_plain_or_fenced_json(self):
        self.assertEqual(_response_json('{"ok":true}'), {"ok": True})
        self.assertEqual(_response_json('```json\n{"ok":true}\n```'), {"ok": True})

    def test_refinement_memory_rejects_case_specific_content(self):
        value = {"task_intent": "solve train-a", "approach": "general", "key_insight": "general", "applicability": "general"}
        with self.assertRaisesRegex(ValueError, "MEMORY_CASE_SPECIFIC_CONTENT"):
            _validate_memory(value, {"train-a", "train-b"})

    def test_refinement_skill_schema_freezes_source_ids(self):
        schema = _skill_response_format({"train-b", "train-a"})
        item = schema["json_schema"]["schema"]["properties"]["skills"]["items"]
        self.assertFalse(item["additionalProperties"])
        self.assertEqual(item["properties"]["support_task_ids"]["items"]["enum"], ["train-a", "train-b"])


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

    def test_duplicate_arm_trial_is_rejected(self):
        row = self.row("a", "vanilla", 1)
        arms = {"vanilla": [row, dict(row)], "memory": [], "skill": []}
        with self.assertRaisesRegex(ValueError, "DUPLICATE_ARM_TRIAL"):
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
