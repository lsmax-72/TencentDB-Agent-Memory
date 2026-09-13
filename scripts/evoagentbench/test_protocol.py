import json
import os
import tempfile
import unittest
from pathlib import Path

import scripts.evoagentbench.report as report_module
from scripts.evoagentbench.adapter import adapt_trial, candidate_contamination
from scripts.evoagentbench.applicability_artifact import annotate_skill, freeze_projection
from scripts.evoagentbench.carry_candidate import carry
from scripts.evoagentbench.batch import experience_state
from scripts.evoagentbench.metrics import compare
from scripts.evoagentbench.nanobot_cli_compat import prepare_invocation
from scripts.evoagentbench.official_runner import raw_final_assistant_response
from scripts.evoagentbench.protocol import build_protocol, sha256_json
from scripts.evoagentbench.protocol_v2 import build_protocol as build_protocol_v2
from scripts.evoagentbench.protocol_v3 import build_protocol as build_protocol_v3
from scripts.evoagentbench.protocol_v4 import build_protocol as build_protocol_v4
from scripts.evoagentbench.protocol_v5 import build_protocol as build_protocol_v5
from scripts.evoagentbench.retrieval import (
    APPLICABILITY_ALGORITHM, injection_text, select_applicable_skills,
    select_assets,
)
from scripts.evoagentbench.report import _replace_runs, build as build_report
from scripts.evoagentbench.refine import _response_json, _skill_response_format, _validate_memory, _validate_skills
from scripts.evoagentbench.hub_export import build_bundle
from scripts.evoagentbench.repair_candidate import repair
from scripts.evoagentbench.driver import benchmark_run_payload


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

    def test_v2_selection_is_stratified_disjoint_and_candidate_blind(self):
        split = self.split()
        v1 = build_protocol(split)
        difficulties = ("easy", "medium", "hard")
        metadata = [
            {"question_id": task_id, "difficulty": difficulties[index % 3], "platform": "test", "question_title": task_id}
            for index, task_id in enumerate(split["train"])
        ]
        protocol, snapshot = build_protocol_v2(split, metadata, v1, "a" * 64)
        selected = protocol["selection"]["development"]
        excluded = set(v1["selection"]["experience"] + v1["selection"]["development"])
        self.assertEqual(len(selected), 24)
        self.assertFalse(set(selected) & excluded)
        self.assertEqual(protocol["selection"]["difficulty_quotas"], {"hard": 12, "medium": 8, "easy": 4})
        self.assertFalse(protocol["candidate"]["refinement_allowed"])
        self.assertEqual(protocol["benchmark"]["metadata_snapshot_hash"], snapshot["artifact_hash"])

    def test_v3_trace2skill_split_is_fresh_stratified_and_candidate_blind(self):
        v1 = json.loads(Path("scripts/evoagentbench/protocol-code-v1.json").read_text())
        v2 = json.loads(Path("scripts/evoagentbench/protocol-code-v2.json").read_text())
        metadata = json.loads(Path("scripts/evoagentbench/protocol-code-v2-metadata.json").read_text())
        split = {
            "train": v1["selection"]["final_train"],
            "test": v1["selection"]["final_test"],
        }
        protocol = build_protocol_v3(split, metadata, v1, v2)
        prior = set(
            v1["selection"]["experience"]
            + v1["selection"]["development"]
            + v2["selection"]["development"]
        )
        experience = set(protocol["selection"]["experience"])
        development = set(protocol["selection"]["development"])
        self.assertEqual(len(experience), 48)
        self.assertEqual(len(development), 24)
        self.assertFalse(prior & experience)
        self.assertFalse(prior & development)
        self.assertFalse(experience & development)
        self.assertEqual(
            protocol["retrieval"]["skill_algorithm"],
            "lexical-idf-applicability-v6",
        )
        self.assertFalse(protocol["candidate_generation"]["development_or_test_visible"])
        self.assertTrue(protocol["governance"]["official_test_locked_until_pilot_pass"])

    def test_v4_changes_only_train_generation_and_keeps_v3_suite_unopened(self):
        v3 = json.loads(Path("scripts/evoagentbench/protocol-code-v3.json").read_text())
        source = json.loads(Path("scripts/evoagentbench/protocol-code-v4-source.json").read_text())
        protocol = build_protocol_v4(v3, source)
        self.assertEqual(protocol["selection"], v3["selection"])
        self.assertEqual(protocol["agent"], v3["agent"])
        self.assertEqual(protocol["pilot_gate"], v3["pilot_gate"])
        self.assertEqual(protocol["arms"], v3["arms"])
        self.assertEqual(protocol["candidate_generation"]["source_exact_cluster_count"], 0)
        self.assertFalse(protocol["candidate_generation"]["development_or_test_visible"])

    def test_v5_freezes_candidate_blind_capability_split_and_four_arms(self):
        v1 = json.loads(Path("scripts/evoagentbench/protocol-code-v1.json").read_text())
        v4 = json.loads(Path("scripts/evoagentbench/protocol-code-v4.json").read_text())
        metadata = json.loads(Path("scripts/evoagentbench/protocol-code-v2-metadata.json").read_text())
        split = {"train": v1["selection"]["final_train"], "test": v1["selection"]["final_test"]}
        protocol = build_protocol_v5(split, metadata, v4)
        experience, development = set(protocol["selection"]["experience"]), set(protocol["selection"]["development"])
        self.assertEqual(len(experience), 24)
        self.assertEqual(len(development), 12)
        self.assertFalse(experience & development)
        self.assertEqual(protocol["arms"], ["vanilla", "memory", "skill", "memory_skill"])
        self.assertEqual(protocol["retrieval"]["combined_order"], ["skill", "memory"])
        counts = {}
        for task_id in experience:
            family = protocol["selection"]["capability_assignments"][task_id]
            counts[family] = counts.get(family, 0) + 1
        self.assertEqual(set(counts.values()), {8})

    def test_candidate_carry_preserves_frozen_bytes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "source/frozen/refinement-r3"
            target = root / "target"
            source.mkdir(parents=True)
            memories = []
            skills = []
            manifest = {"protocol_hash": "source-protocol", "revision": 3}
            manifest["artifact_hash"] = sha256_json({"manifest": manifest, "memories": memories, "skills": skills})
            for name, value in (("manifest.json", manifest), ("memories.json", memories), ("skills.json", skills), ("review.json", {"status": "APPROVED_FOR_DEVELOPMENT"})):
                (source / name).write_text(json.dumps(value))
            protocol = root / "protocol.json"
            protocol.write_text(json.dumps({"protocol_hash": "target-protocol", "candidate": {"revision": 3, "artifact_hash": manifest["artifact_hash"], "source_protocol_hash": "source-protocol"}}))
            receipt = carry(root / "source", target, 3, protocol)
            self.assertEqual(receipt["candidate_artifact_hash"], manifest["artifact_hash"])
            self.assertEqual((target / "frozen/refinement-r3/skills.json").read_bytes(), (source / "skills.json").read_bytes())

    def test_train_memory_carry_does_not_require_skill_review(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "source/frozen/refinement-r1"
            target = root / "target"
            source.mkdir(parents=True)
            memories, skills = [], []
            manifest = {"protocol_hash": "source-protocol", "revision": 1}
            manifest["artifact_hash"] = sha256_json({"manifest": manifest, "memories": memories, "skills": skills})
            for name, value in (("manifest.json", manifest), ("memories.json", memories), ("skills.json", skills)):
                (source / name).write_text(json.dumps(value))
            protocol = root / "protocol.json"
            protocol.write_text(json.dumps({
                "protocol_hash": "target-protocol",
                "candidate_generation": {
                    "memory_revision": 1,
                    "source_memory_artifact_hash": manifest["artifact_hash"],
                    "source_protocol_hash": "source-protocol",
                },
            }))
            receipt = carry(root / "source", target, 1, protocol)
            self.assertEqual(receipt["candidate_artifact_hash"], manifest["artifact_hash"])
            self.assertFalse((target / "frozen/refinement-r1/review.json").exists())

    def test_hub_export_keeps_one_memory_snapshot_and_both_skill_revisions(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            protocol = json.loads(Path("scripts/evoagentbench/protocol-code-v1.json").read_text())
            for revision, skill_count in ((1, 2), (2, 1)):
                directory = root / "frozen" / f"refinement-r{revision}"
                directory.mkdir(parents=True)
                memory_public = {"task_intent": "intent", "approach": "approach", "key_insight": "insight", "applicability": "scope"}
                memory = {**memory_public, "id": f"memory-r{revision}-01", "source_task_id": "train-a", "source_status": "TASK_PASS", "source_evidence_hash": "e" * 64, "content_hash": sha256_json(memory_public)}
                if revision == 2:
                    memory["derived_from_memory_id"] = "memory-r1-01"
                skills = []
                for index in range(skill_count):
                    public = {"name": f"Skill {revision}-{index}", "description": "description", "content": "procedure"}
                    skills.append({**public, "id": f"skill-r{revision}-{index + 1:02d}", "support_task_ids": ["train-a", "train-b"], "support_evidence": [{"task_id": "train-a", "quote": "grounded a"}, {"task_id": "train-b", "quote": "grounded b"}], "content_hash": sha256_json(public)})
                manifest = {"schema": "tdai-evoagentbench-refinement-v1", "revision": revision, "protocol_hash": protocol["protocol_hash"], "memory_count": 1, "skill_count": len(skills), "generation_usage": {"input_tokens": 1, "output_tokens": 1, "total_tokens": 2, "model_calls": 2}, "train_only": True}
                manifest["artifact_hash"] = sha256_json({"manifest": manifest, "memories": [memory], "skills": skills})
                (directory / "manifest.json").write_text(json.dumps(manifest))
                (directory / "memories.json").write_text(json.dumps([memory]))
                (directory / "skills.json").write_text(json.dumps(skills))
                (directory / "review.json").write_text(json.dumps({"status": "REJECTED_BEFORE_DEVELOPMENT", "artifact_hash": manifest["artifact_hash"], "reason": "bad merge", "findings": [], "action": "stop", "promotion_allowed": False}))
            bundle = build_bundle(root)
            self.assertEqual(bundle["candidate_count"], 4)
            self.assertEqual(sum(row["asset_kind"] == "memory" for row in bundle["candidates"]), 1)
            self.assertEqual(sum(row["asset_kind"] == "skill" for row in bundle["candidates"]), 3)
            self.assertTrue(all(row["promotion_allowed"] is False for row in bundle["candidates"]))

    def test_review_repair_prunes_only_flagged_skill_without_model_calls(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            protocol = json.loads(Path("scripts/evoagentbench/protocol-code-v1.json").read_text())
            directory = root / "frozen/refinement-r2"
            directory.mkdir(parents=True)
            quote_a = "Use bitmask dynamic programming to evaluate every subset transition."
            quote_b = "Apply bitmask dynamic programming over subset states and valid moves."
            memories = [
                {"id": "memory-r2-01", "source_task_id": "train-a", "source_status": "TASK_PASS", "source_evidence_hash": "a" * 64, "task_intent": "subset game", "approach": quote_a, "key_insight": "subset transitions are bounded", "applicability": "small subsets"},
                {"id": "memory-r2-02", "source_task_id": "train-b", "source_status": "TASK_PASS", "source_evidence_hash": "b" * 64, "task_intent": "subset search", "approach": quote_b, "key_insight": "subset states encode remaining items", "applicability": "small subsets"},
            ]
            for memory in memories:
                memory["content_hash"] = sha256_json({key: memory[key] for key in ("task_intent", "approach", "key_insight", "applicability")})
            public = {"name": "Bitmask Dynamic Programming", "description": "Use bitmask dynamic programming for subset transitions.", "content": "Trigger on subset states. Procedure: enumerate transitions. Verification: compare small states. Stop when all states are resolved."}
            valid = {**public, "id": "skill-r2-01", "support_task_ids": ["train-a", "train-b"], "support_evidence": [{"task_id": "train-a", "quote": quote_a}, {"task_id": "train-b", "quote": quote_b}], "content_hash": sha256_json(public)}
            invalid = {**valid, "id": "skill-r2-02", "name": "Merged mechanisms"}
            invalid["content_hash"] = sha256_json({key: invalid[key] for key in ("name", "description", "content")})
            skills = [valid, invalid]
            manifest = {"schema": "tdai-evoagentbench-refinement-v1", "revision": 2, "protocol_hash": protocol["protocol_hash"], "source_manifest_hash": "s" * 64, "memory_count": 2, "skill_count": 2, "generation_usage": {"input_tokens": 8, "output_tokens": 2, "total_tokens": 10, "model_calls": 3}, "generation_attempts": [1], "generation_sources": ["r2-a1"], "active_attempt_model_calls": 3, "reused_model_calls": 0, "reused_memories_from_revision": 1, "model": "qwen3.8-27b", "temperature": 0, "fallback": "disabled", "train_only": True, "created_at": "now"}
            manifest["artifact_hash"] = sha256_json({"manifest": manifest, "memories": memories, "skills": skills})
            (directory / "manifest.json").write_text(json.dumps(manifest))
            (directory / "memories.json").write_text(json.dumps(memories))
            (directory / "skills.json").write_text(json.dumps(skills))
            (directory / "review.json").write_text(json.dumps({"status": "REJECTED_BEFORE_DEVELOPMENT", "artifact_hash": manifest["artifact_hash"], "findings": [{"skill_id": "skill-r2-02", "finding": "mixed"}]}))
            policy = {"schema": "tdai-evoagentbench-refinement-policy-v1", "policy_id": "test-policy", "source_protocol_id": protocol["protocol_id"], "source_protocol_hash": protocol["protocol_hash"], "max_skill_revisions": 3, "evaluation_protocol_unchanged": True, "repair_strategy": "remove_review_rejected_skills_without_regeneration", "requirements": {"source_review_status": "REJECTED_BEFORE_DEVELOPMENT"}}
            policy["policy_hash"] = sha256_json(policy)
            policy_path = root / "policy.json"; policy_path.write_text(json.dumps(policy))
            result = repair(root, 2, 3, policy_path)
            self.assertEqual([row["derived_from_skill_id"] for row in result["skills"]], ["skill-r2-01"])
            self.assertEqual(result["manifest"]["repair_model_calls"], 0)
            self.assertEqual(result["review"]["status"], "APPROVED_FOR_DEVELOPMENT")
            with self.assertRaisesRegex(FileExistsError, "REFINEMENT_REVISION_ALREADY_EXISTS"):
                repair(root, 2, 3, policy_path)

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
            {"role": "user", "content": "Solve the hidden-test task."},
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
        self.assertEqual(row["task_input"], "Solve the hidden-test task.")
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

    def test_tool_result_error_prefix_is_not_reported_as_success(self):
        result = {"task_name": "tr-1", "agent_result": {"completion_status": "completed", "response": "done"}, "verifier_result": {"reward": 1.0}, "token_usage": {"input": 1, "output": 1, "total": 2}}
        root, path = self.trial(result, [
            {"role": "assistant", "model": "qwen3.8-27b", "tool_calls": [{"id": "c1", "function": {"name": "exec", "arguments": "{}"}}]},
            {"role": "tool", "tool_call_id": "c1", "content": "Error: Command blocked by safety guard"},
        ])
        try:
            events = path / "proxy.jsonl"
            events.write_text("\n".join(json.dumps(event) for event in [
                {"kind": "request", "call_id": 1},
                {"kind": "response", "call_id": 1, "model": "qwen3.8-27b", "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2}},
            ]) + "\n")
            row = adapt_trial(path, arm="vanilla", phase="smoke", protocol_hash="h", expected_model="qwen3.8-27b", proxy_events_path=events)
        finally:
            root.cleanup()
        self.assertFalse(row["tool_events"][0]["success"])

    def test_assets_and_contamination_are_bounded(self):
        self.assertEqual(candidate_contamination("Use abc320_a", ["abc320_a"]), ["TEST_ID:abc320_a"])
        result = {"task_name": "tr-1", "agent_result": {"completion_status": "completed"}, "verifier_result": {"reward": 0.0}, "token_usage": {"input": 1, "output": 1, "total": 2}}
        root, path = self.trial(result, [{"role": "assistant", "model": "qwen3.8-27b"}])
        try:
            with self.assertRaisesRegex(ValueError, "RETRIEVAL_TOP_K_EXCEEDED"):
                adapt_trial(path, arm="skill", phase="development", protocol_hash="h", expected_model="qwen3.8-27b", injected_assets=[{"id": str(i), "hash": "x"} for i in range(3)])
        finally:
            root.cleanup()

    def test_combined_adapter_preserves_fixed_skill_then_memory_receipt(self):
        result = {"task_name": "tr-1", "trial": 1, "agent_result": {"completion_status": "completed", "response": "ok"}, "verifier_result": {"reward": 1.0}, "token_usage": {"input": 2, "output": 1, "total": 3}}
        root, path = self.trial(result, [{"role": "assistant", "model": "qwen3.8-27b"}])
        assets = [{"id": "skill-a", "hash": "a"}, {"id": "memory-a", "hash": "b"}]
        receipt = {"kind": "memory_skill", "assets": assets, "injection_order": ["skill", "memory"],
                   "selections": {"skill": [assets[0]], "memory": [assets[1]]}, "candidate_artifact_hash": "candidate"}
        try:
            events = path / "proxy.jsonl"
            events.write_text("\n".join(json.dumps(event) for event in [
                {"kind": "request", "call_id": 1},
                {"kind": "response", "call_id": 1, "model": "qwen3.8-27b", "usage": {"prompt_tokens": 2, "completion_tokens": 1, "total_tokens": 3}},
            ]) + "\n")
            row = adapt_trial(path, arm="memory_skill", phase="development", protocol_hash="h", expected_model="qwen3.8-27b", injected_assets=assets, injection_receipt=receipt, proxy_events_path=events)
        finally:
            root.cleanup()
        self.assertEqual(row["retrieval_counts"], {"skill": 1, "memory": 1})
        self.assertEqual(row["injected_assets"], assets)

    def test_benchmark_run_payload_preserves_frozen_asset_hash(self):
        evidence = {
            "hub_scope": {"team_id": "team", "agent_id": "agent", "task_id": "task"},
            "run_id": "development-a-memory-r3-trial-1", "session_id": "session", "protocol_hash": "a" * 64,
            "phase": "development", "arm": "memory", "trial": 1, "status": "TASK_PASS", "reward": 1.0,
            "candidate_revision": 3, "candidate_artifact_hash": "b" * 64, "task_id": "a", "task_input": "solve",
            "final_output": "done", "tool_events": [], "usage": {"input_tokens": 10, "output_tokens": 2, "model_call_count": 1, "tool_call_count": 0},
            "actual_model": "qwen3.8-27b", "injected_assets": [{"id": "memory-r2-01", "hash": "c" * 64}],
        }
        payload = benchmark_run_payload(evidence)
        self.assertEqual(payload["injected_assets"], [{"id": "memory-r2-01", "hash": "c" * 64}])

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

    def test_official_runner_prefers_intact_final_session_response(self):
        with tempfile.TemporaryDirectory() as tmp:
            session = Path(tmp) / "session.jsonl"
            session.write_text("\n".join(json.dumps(row) for row in [
                {"role": "assistant", "content": "working"},
                {"role": "tool", "content": "done"},
                {"role": "assistant", "content": "```python\nvalue = [1, 2, 3]\n```"},
            ]) + "\n")
            self.assertEqual(raw_final_assistant_response(session), "```python\nvalue = [1, 2, 3]\n```")

    def test_report_replaces_only_explicit_implementation_retry(self):
        arms = {"vanilla": [], "memory": [], "skill": [{"arm": "skill", "task_id": "a", "trial": 1, "reward": 0}]}
        with tempfile.TemporaryDirectory() as tmp:
            replacement = Path(tmp) / "evidence.json"
            replacement.write_text(json.dumps({
                "arm": "skill", "task_id": "a", "trial": 1, "reward": 1,
                "implementation_fix_retry": {"retry_id": "capture-fix-r1"},
            }))
            retries = _replace_runs(arms, [replacement])
        self.assertEqual(arms["skill"][0]["reward"], 1)
        self.assertEqual(retries, [{"retry_id": "capture-fix-r1"}])

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

    def _applicable_pair_skill(self):
        return {
            "id": "skill-a", "content_hash": "hash-a",
            "name": "Pair enumeration", "description": "Check every pair in a small array",
            "content": "Enumerate pairs and retain the maximum valid value.",
            "applicability_profile": {
                "task_family": "pair optimization in arrays",
                "when_to_apply": "The input is small enough for quadratic enumeration.",
                "do_not_apply_when": "The largest input permits too many pairs.",
                "constraints": [{"parameter": "n", "max_value": 100}],
                "complexity": "O(n^2)", "evidence_refs": ["train-a", "train-b"],
                "task_signals": {
                    "entity_terms": ["pair"],
                    "objective_terms": ["maximum", "minimum", "count", "number", "total"],
                    "same_sentence": True,
                },
            },
        }

    def test_skill_applicability_rejects_incompatible_size_constraint(self):
        for query in (
            "Given N <= 5e5 values, return the maximum over all pairs.",
            r"Return the maximum over all pairs. Constraints: 2 \leq N \leq 5 \times 10^{5}",
        ):
            selected, decisions = select_applicable_skills(
                query, [self._applicable_pair_skill()], top_k=1,
            )
            self.assertEqual(selected, [])
            self.assertEqual(decisions[0]["reason"], "CONSTRAINT_MISMATCH:n")

    def test_skill_applicability_understands_common_length_constraints(self):
        for query in (
            "Return the total number of valid pairs. Constraints: 1 <= n, m <= 50.",
            "Return the maximum over all valid pairs. Constraints: 1 <= nums.length <= 50.",
        ):
            selected, decisions = select_applicable_skills(
                query, [self._applicable_pair_skill()], top_k=1,
            )
            self.assertEqual([row["id"] for row in selected], ["skill-a"])
            self.assertEqual(decisions[0]["reason"], "SELECTED")

    def test_skill_applicability_selects_verified_match_and_can_abstain(self):
        selected, decisions = select_applicable_skills(
            "For an array with n <= 50, find the maximum over all pairs.",
            [self._applicable_pair_skill()], top_k=1,
        )
        self.assertEqual([row["id"] for row in selected], ["skill-a"])
        self.assertEqual(decisions[0]["reason"], "SELECTED")
        selected, decisions = select_applicable_skills(
            "For a string with n <= 50, remove adjacent equal letters.",
            [self._applicable_pair_skill()], top_k=1,
        )
        self.assertEqual(selected, [])
        self.assertEqual(decisions[0]["reason"], "TASK_SIGNAL_MISMATCH")

    def test_skill_applicability_abstains_when_required_bound_is_missing(self):
        selected, decisions = select_applicable_skills(
            "Find the maximum value over every pair in the array.",
            [self._applicable_pair_skill()], top_k=1,
        )
        self.assertEqual(selected, [])
        self.assertEqual(decisions[0]["reason"], "CONSTRAINT_NOT_OBSERVED:n")

    def test_skill_applicability_requires_objective_and_entity_together(self):
        for query in (
            "An array has no pair of distinct elements summing to k. Return the minimum possible sum of the array. Constraints: n <= 50.",
            "Currency pairs describe a graph. Return the maximum amount after conversion. Constraints: n <= 10.",
        ):
            selected, decisions = select_applicable_skills(
                query, [self._applicable_pair_skill()], top_k=1,
            )
            self.assertEqual(selected, [])
            self.assertEqual(decisions[0]["reason"], "TASK_SIGNAL_MISMATCH")
        for query in (
            "Return the total number of good pairs. Constraints: n, m <= 50.",
            "Return the maximum XOR value among all strong pairs. Constraints: nums.length <= 50.",
        ):
            selected, decisions = select_applicable_skills(
                query, [self._applicable_pair_skill()], top_k=1,
            )
            self.assertEqual([row["id"] for row in selected], ["skill-a"])
            self.assertEqual(decisions[0]["reason"], "SELECTED")

    def test_skill_applicability_normalizes_objective_synonyms(self):
        selected, decisions = select_applicable_skills(
            "Return the total number of good pairs. Constraints: n, m <= 50.",
            [self._applicable_pair_skill()], top_k=1,
        )
        self.assertEqual([row["id"] for row in selected], ["skill-a"])
        self.assertEqual(decisions[0]["reason"], "SELECTED")

    def test_skill_applicability_supports_specific_non_numeric_objective(self):
        skill = self._applicable_pair_skill()
        skill.update({
            "id": "skill-palindrome", "name": "Palindrome prefix completion",
            "description": "Append the minimum suffix needed to complete a palindrome.",
            "content": "Trigger: Construct the shortest palindrome with a required prefix. Procedure: compare suffixes.",
        })
        skill["applicability_profile"] = {
            "task_family": "palindrome prefix completion",
            "when_to_apply": "Construct the shortest palindrome with a required prefix.",
            "do_not_apply_when": "Do not apply to substring-only queries.",
            "constraints": [], "complexity": "O(n^2)",
            "evidence_refs": ["train-a", "train-b"],
            "task_signals": {
                "entity_terms": ["palindrome"], "objective_terms": ["construct"],
                "same_sentence": True,
            },
        }
        selected, decisions = select_applicable_skills(
            "Construct the shortest palindrome by appending characters to this prefix.",
            [skill], top_k=1,
        )
        self.assertEqual([row["id"] for row in selected], ["skill-palindrome"])
        self.assertEqual(decisions[0]["reason"], "SELECTED")

    def test_nanobot_compat_records_applicability_decisions(self):
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp).resolve()
            config = workspace / "config.json"
            pool = workspace / "pool.json"
            receipt = workspace / "receipt.json"
            config.write_text(json.dumps({"agents": {"defaults": {"workspace": str(workspace)}}}))
            pool.write_text(json.dumps([self._applicable_pair_skill()]))
            previous = dict(os.environ)
            os.environ.update({
                "TDAI_EVO_ASSET_POOL": str(pool), "TDAI_EVO_ASSET_KIND": "skill",
                "TDAI_EVO_ASSET_TOP_K": "2", "TDAI_EVO_INJECTION_RECEIPT": str(receipt),
                "TDAI_EVO_RUN_PRIVATE": str(workspace),
                "TDAI_EVO_CANDIDATE_HASH": "candidate-hash",
                "TDAI_EVO_RETRIEVAL_ALGORITHM": APPLICABILITY_ALGORITHM,
            })
            try:
                command, _ = prepare_invocation([
                    "agent", "--session", "s", "--message",
                    "Given n <= 500000, maximize a value over all pairs.",
                    "--workspace", str(workspace), "--config", str(config),
                ])
            finally:
                os.environ.clear(); os.environ.update(previous)
            self.assertNotIn("Retrieved strategies", command[command.index("--message") + 1])
            value = json.loads(receipt.read_text())
            self.assertEqual(value["algorithm"], APPLICABILITY_ALGORITHM)
            self.assertEqual(value["assets"], [])
            self.assertEqual(value["applicability_decisions"][0]["reason"], "CONSTRAINT_MISMATCH:n")

    def test_applicability_projection_preserves_content_and_freezes_hash(self):
        source_skill = {
            "id": "skill-r3-01", "content_hash": "old-hash",
            "name": "Pair enumeration", "description": "Use O(n^2) when n <= 100.",
            "content": "Trigger: Find an optimum over pairs in a small array. Procedure: Enumerate every pair.",
            "support_task_ids": ["train-b", "train-a"],
        }
        projected = annotate_skill(source_skill)
        self.assertEqual(projected["content"], source_skill["content"])
        self.assertEqual(projected["source_content_hash"], "old-hash")
        self.assertEqual(projected["applicability_profile"]["constraints"], [{"parameter": "n", "max_value": 100}])
        self.assertEqual(projected["applicability_profile"]["complexity"], "O(n^2)")
        self.assertEqual(projected["applicability_profile"]["task_signals"]["entity_terms"], ["pair"])
        self.assertNotEqual(projected["content_hash"], "old-hash")
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "source.json"
            output = Path(tmp) / "frozen"
            source.write_text(json.dumps([source_skill]))
            manifest = freeze_projection(source, output)
            self.assertEqual(manifest["model_calls"], 0)
            self.assertFalse(manifest["content_rewritten"])
            self.assertTrue((output / "skills.json").is_file())
            with self.assertRaisesRegex(FileExistsError, "APPLICABILITY_OUTPUT_ALREADY_EXISTS"):
                freeze_projection(source, output)

    def test_applicability_projection_does_not_mislabel_per_pair_cost(self):
        projected = annotate_skill({
            "id": "skill-r3-01", "content_hash": "old-hash",
            "name": "Pair enumeration", "description": "Check all pairs in a small array.",
            "content": "Trigger: Find an optimum where n <= 100 and each validity check is O(1). Procedure: Iterate through all possible pairs.",
            "support_task_ids": ["train-a", "train-b"],
        })
        self.assertEqual(
            projected["applicability_profile"]["complexity"],
            "O(number_of_pairs) total; O(1) per pair",
        )

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

    def test_nanobot_compat_combines_identical_per_kind_selections_in_fixed_order(self):
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp).resolve()
            config = workspace / "config.json"
            pool = workspace / "pool.json"
            receipt = workspace / "receipt.json"
            config.write_text(json.dumps({"agents": {"defaults": {"workspace": str(workspace)}}}))
            skill = self._applicable_pair_skill()
            memory = {"id": "memory-a", "content_hash": "hash-m", "task_intent": "maximum pair in array", "approach": "enumerate pairs", "key_insight": "compare pairs", "applicability": "small arrays"}
            pool.write_text(json.dumps({"skill": [skill], "memory": [memory]}))
            previous = dict(os.environ)
            os.environ.update({
                "TDAI_EVO_ASSET_POOL": str(pool), "TDAI_EVO_ASSET_KIND": "memory_skill",
                "TDAI_EVO_ASSET_TOP_K": "2", "TDAI_EVO_INJECTION_RECEIPT": str(receipt),
                "TDAI_EVO_RUN_PRIVATE": str(workspace), "TDAI_EVO_CANDIDATE_HASH": "candidate-hash",
                "TDAI_EVO_RETRIEVAL_ALGORITHM": json.dumps({"memory": "lexical-idf-v1", "skill": APPLICABILITY_ALGORITHM}),
            })
            try:
                command, _ = prepare_invocation([
                    "agent", "--session", "s", "--message",
                    "For an array with n <= 50, find the maximum over all pairs.",
                    "--workspace", str(workspace), "--config", str(config),
                ])
            finally:
                os.environ.clear(); os.environ.update(previous)
            message = command[command.index("--message") + 1]
            self.assertLess(message.index("Retrieved strategies"), message.index("Retrieved experiences"))
            value = json.loads(receipt.read_text())
            self.assertEqual(value["injection_order"], ["skill", "memory"])
            self.assertEqual(value["assets"], [
                {"id": "skill-a", "hash": "hash-a"}, {"id": "memory-a", "hash": "hash-m"},
            ])

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

    def test_four_arm_factorial_reports_combined_increment_and_interaction(self):
        arms = {
            "vanilla": [self.row("a", "vanilla", 0, "TASK_FAIL"), self.row("b", "vanilla", 1)],
            "memory": [self.row("a", "memory", 1), self.row("b", "memory", 1)],
            "skill": [self.row("a", "skill", 0, "TASK_FAIL"), self.row("b", "skill", 1)],
            "memory_skill": [self.row("a", "memory_skill", 1), self.row("b", "memory_skill", 1)],
        }
        result = compare(arms, "seed")
        self.assertEqual(result["comparisons"]["memory_skill"]["counts"]["newly_fixed"], 1)
        self.assertEqual(result["factorial"]["combined_minus_memory"], 0)
        self.assertEqual(result["factorial"]["combined_minus_skill"], 0.5)
        self.assertEqual(result["factorial"]["interaction_effect"], 0)

    def test_four_arm_report_uses_versioned_schema(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            protocol_file = root / "protocol.json"
            protocol_file.write_text(json.dumps({
                "protocol_id": "factorial", "protocol_hash": "p",
                "arms": ["vanilla", "memory", "skill", "memory_skill"],
                "selection": {"final_test": []},
            }))
            for arm, reward in (("vanilla", 0), ("memory", 0), ("skill", 1), ("memory_skill", 1)):
                directory = root / "runs" / f"development-a-{arm}-trial-1"
                directory.mkdir(parents=True)
                row = self.row("a", arm, reward, "TASK_PASS" if reward else "TASK_FAIL")
                row.update({"phase": "development", "candidate_revision": None if arm == "vanilla" else 2,
                            "evidence_hash": arm, "retrieval_count": 0 if arm == "vanilla" else 1})
                (directory / "evidence.json").write_text(json.dumps(row))
            previous = report_module.PROTOCOL_FILE
            report_module.PROTOCOL_FILE = protocol_file
            try:
                attempt = build_report(root, "development", "factorial-r1", None, 2)
            finally:
                report_module.PROTOCOL_FILE = previous
        self.assertEqual(attempt["schema"], "tdai-evoagentbench-comparison-v2")
        self.assertIn("memory_skill", attempt["comparisons"])
        self.assertEqual(attempt["factorial"]["combined_minus_skill"], 0)

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
