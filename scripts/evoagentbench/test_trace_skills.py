import json
import tempfile
import unittest
from pathlib import Path

from scripts.evoagentbench.trace_patches import freeze_patch_artifact
from scripts.evoagentbench.trace_skills import (
    freeze_skill_candidate, skill_response_format, validate_cluster_skill,
)


class TraceSkillTest(unittest.TestCase):
    def memory(self, task_id):
        return {
            "source_task_id": task_id, "source_status": "TASK_PASS",
            "source_evidence_hash": task_id + "-evidence", "content_hash": task_id + "-memory",
            "task_intent": "Aggregate a result over bounded pairs.",
            "approach": "Use bounded all-pairs enumeration to visit every pair and evaluate the condition in constant time.",
            "key_insight": "Small input bounds make complete pair enumeration safe and predictable.",
            "applicability": "Small bounded pair collections.",
        }

    def patch(self):
        return {
            "patch_type": "strategy", "mechanism_key": "all_pairs_enumeration",
            "task_family": "pair optimization over bounded collections",
            "trigger": "The task asks for an aggregate over bounded pairs.",
            "action": "Visit every pair and update the aggregate.",
            "verification": "Check self-pair and endpoint rules.",
            "stop_condition": "Stop after every permitted pair is visited.",
            "warning": "Avoid when the pair count exceeds the budget.",
            "evidence_quote": "Use bounded all-pairs enumeration to visit every pair and evaluate the condition in constant time.",
        }

    def skill(self):
        return {
            "mechanism_key": "all_pairs_enumeration",
            "name": "Bounded all-pairs enumeration",
            "description": "Visit all pairs when explicit bounds make quadratic work safe.",
            "content": "Trigger: An aggregate over pairs has small explicit bounds. Procedure: Visit each permitted pair once and update the aggregate. Verification: Check self-pair and endpoint rules. Stop: Finish after every permitted pair is visited.",
            "support_task_ids": ["train-a", "train-b"],
            "support_evidence": [
                {"task_id": task_id, "quote": "Use bounded all-pairs enumeration to visit every pair and evaluate the condition in constant time."}
                for task_id in ("train-a", "train-b")
            ],
            "applicability_profile": {
                "task_family": "bounded pair aggregation",
                "when_to_apply": "Aggregate over pairs under an explicit small bound.",
                "do_not_apply_when": "Do not apply when quadratic work exceeds the budget.",
                "constraints": [{"parameter": "n", "max_value": 100}],
                "complexity": "O(n^2)", "evidence_refs": ["train-a", "train-b"],
                "task_signals": {
                    "entity_terms": ["pair"], "objective_terms": ["count", "maximum", "minimum"],
                    "same_sentence": True,
                },
            },
        }

    def test_schema_fixes_cluster_mechanism(self):
        schema = skill_response_format(["a", "b"], "all_pairs_enumeration")["json_schema"]["schema"]
        self.assertEqual(schema["properties"]["mechanism_key"]["const"], "all_pairs_enumeration")
        self.assertFalse(schema["additionalProperties"])

    def test_validation_rejects_support_or_section_drift(self):
        memories = {task_id: self.memory(task_id) for task_id in ("train-a", "train-b")}
        cluster = {"mechanism_key": "all_pairs_enumeration", "support_task_ids": list(memories)}
        self.assertEqual(validate_cluster_skill(self.skill(), cluster, memories)["mechanism_key"], "all_pairs_enumeration")
        drift = self.skill(); drift["support_task_ids"] = ["train-a"]
        with self.assertRaisesRegex(ValueError, "SUPPORT_SET"):
            validate_cluster_skill(drift, cluster, memories)
        duplicate = self.skill(); duplicate["support_task_ids"].append("train-a")
        with self.assertRaisesRegex(ValueError, "SUPPORT_SET"):
            validate_cluster_skill(duplicate, cluster, memories)
        missing = self.skill(); missing["content"] = "Trigger: pair task. Procedure: enumerate."
        with self.assertRaisesRegex(ValueError, "SECTIONS_MISSING"):
            validate_cluster_skill(missing, cluster, memories)

    def test_freezes_driver_compatible_candidate_without_promotion(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            memories = [self.memory("train-a"), self.memory("train-b")]
            memory_file = root / "memories.json"
            patch_responses = root / "patch-responses.json"
            memory_file.write_text(json.dumps(memories))
            patch_responses.write_text(json.dumps([
                {"source_task_id": row["source_task_id"], "patch": self.patch()}
                for row in memories
            ]))
            patch_dir = root / "patches"
            freeze_patch_artifact(
                memory_file, patch_responses, patch_dir,
                protocol_hash="protocol", model="model", usage={"model_calls": 2},
            )
            responses = root / "skills.json"
            responses.write_text(json.dumps([{
                "mechanism_key": "all_pairs_enumeration", "skill": self.skill(),
            }]))
            output = root / "candidate"
            manifest = freeze_skill_candidate(
                patch_dir, memory_file, responses, output,
                revision=4, model="model", usage={"model_calls": 1},
            )
            self.assertEqual(manifest["skill_count"], 1)
            self.assertFalse(manifest["promotion_allowed"])
            review = json.loads((output / "review.json").read_text())
            self.assertFalse(review["effect_proven"])


if __name__ == "__main__":
    unittest.main()
