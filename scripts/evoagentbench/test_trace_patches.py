import json
import tempfile
import unittest
from pathlib import Path

from scripts.evoagentbench.trace_patches import (
    cluster_strategy_patches, cluster_strategy_patches_semantic_v2,
    freeze_patch_artifact, freeze_semantic_recluster, load_patch_artifact,
    patch_response_format, validate_patch,
)
from scripts.evoagentbench.trace_patch_runner import _reused_attempt
from scripts.evoagentbench.trace_cluster_review import (
    freeze_reviewed_clusters, propose_pairs, review_response_format,
)


class TracePatchTest(unittest.TestCase):
    def source(self, task_id="train-a", status="TASK_PASS"):
        return {
            "source_task_id": task_id,
            "source_status": status,
            "source_evidence_hash": task_id + "-evidence",
            "content_hash": task_id + "-memory",
            "approach": "Enumerate every possible pair and evaluate the condition in constant time.",
            "key_insight": "Small input bounds make complete pair enumeration safe and predictable.",
        }

    def patch(self, patch_type="strategy"):
        return {
            "patch_type": patch_type,
            "mechanism_key": "all_pairs_enumeration",
            "task_family": "pair optimization over bounded collections",
            "trigger": "The task asks for an aggregate over pairs and the bounds permit enumeration.",
            "action": "Enumerate each permitted pair and update the requested aggregate.",
            "verification": "Check endpoint pairs and whether self-pairs are allowed.",
            "stop_condition": "Stop after every permitted pair has been visited once.",
            "warning": "Do not use when the pair count exceeds the execution budget.",
            "evidence_quote": "Enumerate every possible pair and evaluate the condition in constant time.",
        }

    def test_failed_trace_can_only_contribute_warning(self):
        with self.assertRaisesRegex(ValueError, "FAILED_SOURCE"):
            validate_patch(self.patch(), self.source(status="TASK_FAIL"), {"train-a"})
        warning = validate_patch(self.patch("warning"), self.source(status="TASK_FAIL"), {"train-a"})
        self.assertEqual(warning["patch_type"], "warning")

    def test_response_schema_is_strict_and_complete(self):
        schema = patch_response_format()["json_schema"]["schema"]
        self.assertFalse(schema["additionalProperties"])
        self.assertEqual(set(schema["required"]), set(schema["properties"]))
        self.assertEqual(
            schema["properties"]["patch_type"]["enum"], ["strategy", "warning"]
        )

    def test_rejects_ungrounded_or_case_specific_patch(self):
        value = self.patch()
        value["evidence_quote"] = "This fabricated quotation is long enough but does not exist in the source memory."
        with self.assertRaisesRegex(ValueError, "NOT_GROUNDED"):
            validate_patch(value, self.source(), {"train-a"})
        value = self.patch()
        value["action"] = "Use the special answer from train-a whenever this benchmark appears."
        with self.assertRaisesRegex(ValueError, "CASE_SPECIFIC"):
            validate_patch(value, self.source(), {"train-a"})

    def test_cluster_requires_two_sources_and_shared_family(self):
        first = validate_patch(self.patch(), self.source("train-a"), {"train-a", "train-b"})
        self.assertEqual(cluster_strategy_patches([first]), [])
        second = validate_patch(self.patch(), self.source("train-b"), {"train-a", "train-b"})
        clusters = cluster_strategy_patches([first, second])
        self.assertEqual(clusters[0]["support_task_ids"], ["train-a", "train-b"])
        unrelated = dict(second)
        unrelated["task_family"] = "palindrome prefix construction"
        unrelated["patch_hash"] = "changed"
        self.assertEqual(cluster_strategy_patches([first, unrelated]), [])

    def test_semantic_cluster_pairs_only_mutual_nearest_supported_strategies(self):
        first_value = self.patch()
        first_value.update({
            "mechanism_key": "incremental_frequency_map_maintenance",
            "task_family": "dynamic distinct count",
            "trigger": "Track the number of distinct values after many point updates.",
            "action": "Maintain a frequency map and remove keys when counts reach zero.",
        })
        second_value = self.patch()
        second_value.update({
            "mechanism_key": "incremental_distinct_counter",
            "task_family": "dynamic multiset queries",
            "trigger": "Track distinct values during many insertions and deletions.",
            "action": "Maintain a frequency map and change the distinct counter at zero crossings.",
        })
        unrelated_value = self.patch()
        unrelated_value.update({
            "mechanism_key": "binary_tree_path_sum",
            "task_family": "tree path aggregation",
            "trigger": "Aggregate weights along root to leaf paths.",
            "action": "Traverse the tree and accumulate each path sum.",
        })
        source_ids = {"train-a", "train-b", "train-c"}
        patches = [
            validate_patch(first_value, self.source("train-a"), source_ids),
            validate_patch(second_value, self.source("train-b"), source_ids),
            validate_patch(unrelated_value, self.source("train-c"), source_ids),
        ]
        clusters = cluster_strategy_patches_semantic_v2(patches, minimum_similarity=0.20)
        self.assertEqual(len(clusters), 1)
        self.assertEqual(clusters[0]["support_task_ids"], ["train-a", "train-b"])
        self.assertEqual(clusters[0]["cluster_algorithm"], "mutual-best-tfidf-v1")

    def test_semantic_recluster_is_versioned_and_uses_no_new_model_calls(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            memories = [self.source("train-a"), self.source("train-b")]
            responses = [
                {"source_task_id": source["source_task_id"], "patch": self.patch()}
                for source in memories
            ]
            memory_file = root / "memories.json"
            response_file = root / "responses.json"
            source_dir = root / "source"
            target_dir = root / "target"
            memory_file.write_text(json.dumps(memories))
            response_file.write_text(json.dumps(responses))
            source_manifest = freeze_patch_artifact(
                memory_file, response_file, source_dir,
                protocol_hash="old-protocol", model="model",
                usage={"model_calls": 2},
            )
            manifest = freeze_semantic_recluster(
                source_dir, memory_file, target_dir,
                protocol_hash="new-protocol", minimum_similarity=0,
            )
            self.assertEqual(manifest["usage"]["model_calls"], 0)
            self.assertEqual(manifest["source_patch_artifact_hash"], source_manifest["artifact_hash"])
            self.assertEqual(load_patch_artifact(target_dir)[0]["artifact_hash"], manifest["artifact_hash"])

    def test_freeze_is_immutable_and_records_no_candidate_claim(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            memories = [self.source("train-a"), self.source("train-b")]
            responses = [
                {"source_task_id": source["source_task_id"], "patch": self.patch()}
                for source in memories
            ]
            source_file = root / "memories.json"
            response_file = root / "responses.json"
            output = root / "frozen"
            source_file.write_text(json.dumps(memories))
            response_file.write_text(json.dumps(responses))
            manifest = freeze_patch_artifact(
                source_file, response_file, output,
                protocol_hash="protocol-hash", model="qwen3.8-27b",
                usage={"total_tokens": 12, "model_calls": 2},
            )
            self.assertEqual(manifest["eligible_cluster_count"], 1)
            self.assertFalse(manifest["candidate_generated"])
            loaded, _, clusters = load_patch_artifact(output)
            self.assertEqual(loaded["artifact_hash"], manifest["artifact_hash"])
            self.assertEqual(clusters[0]["mechanism_key"], "all_pairs_enumeration")
            with self.assertRaisesRegex(FileExistsError, "ALREADY_EXISTS"):
                freeze_patch_artifact(
                    source_file, response_file, output,
                    protocol_hash="protocol-hash", model="qwen3.8-27b", usage={},
                )

    def test_retry_reuses_only_valid_failed_attempt_checkpoints(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            attempt = root / "trace-patch-attempts/first"
            (attempt / "responses").mkdir(parents=True)
            (attempt / "events").mkdir()
            source = self.source("train-a")
            response = {"source_task_id": "train-a", "patch": self.patch()}
            event = {
                "source_task_id": "train-a", "response_hash": "hash",
                "usage": {"prompt_tokens": 3, "completion_tokens": 2, "total_tokens": 5},
            }
            (attempt / "failure.json").write_text("{}")
            (attempt / "responses/01.json").write_text(json.dumps(response))
            (attempt / "events/01.json").write_text(json.dumps(event))
            reused = _reused_attempt(root, "first", {"train-a": source}, {"train-a"})
            self.assertEqual(set(reused), {"train-a"})
            (attempt / "failure.json").unlink()
            with self.assertRaisesRegex(RuntimeError, "NOT_FAILED"):
                _reused_attempt(root, "first", {"train-a": source}, {"train-a"})

    def test_capability_pair_review_is_frozen_and_grounded(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            memories = [self.source("train-a"), self.source("train-b")]
            first = self.patch()
            first["mechanism_key"] = "bounded_pair_scan"
            second = self.patch()
            second["mechanism_key"] = "complete_pair_enumeration"
            responses = [
                {"source_task_id": "train-a", "patch": first},
                {"source_task_id": "train-b", "patch": second},
            ]
            memory_file = root / "memories.json"
            patch_responses = root / "patch-responses.json"
            source_dir = root / "source"
            memory_file.write_text(json.dumps(memories))
            patch_responses.write_text(json.dumps(responses))
            freeze_patch_artifact(
                memory_file, patch_responses, source_dir,
                protocol_hash="source-protocol", model="model", usage={"model_calls": 2},
            )
            _, patches, _ = load_patch_artifact(source_dir)
            proposals = propose_pairs(
                patches, {"train-a": "counting", "train-b": "counting"}
            )
            self.assertEqual(len(proposals), 1)
            proposal = proposals[0]
            schema = review_response_format(proposal)["json_schema"]["schema"]
            self.assertFalse(schema["additionalProperties"])
            review = [{
                "proposal_id": proposal["proposal_id"],
                "decision": "supported",
                "support_task_ids": ["train-a", "train-b"],
                "shared_mechanism_key": "bounded_pair_enumeration",
                "rationale": "Both patches enumerate the complete bounded pair space once.",
                "evidence": [
                    {"task_id": "train-a", "quote": first["trigger"]},
                    {"task_id": "train-b", "quote": second["trigger"]},
                ],
            }]
            review_file = root / "reviews.json"
            review_file.write_text(json.dumps(review))
            target = root / "target"
            manifest = freeze_reviewed_clusters(
                source_dir, memory_file, review_file, target,
                protocol_hash="review-protocol",
                capability_assignments={"train-a": "counting", "train-b": "counting"},
                model="model", usage={"model_calls": 1},
            )
            self.assertEqual(manifest["eligible_cluster_count"], 1)
            loaded, _, clusters = load_patch_artifact(target)
            self.assertEqual(loaded["artifact_hash"], manifest["artifact_hash"])
            self.assertEqual(clusters[0]["mechanism_key"], "bounded_pair_enumeration")


if __name__ == "__main__":
    unittest.main()
