import unittest
import json
import tempfile
from pathlib import Path
from unittest.mock import patch

from scripts.evoagentbench.stability_probe import collect, run_id, summarize


class StabilityProbeTest(unittest.TestCase):
    def test_run_id_keeps_vanilla_unbound_and_candidate_arms_versioned(self):
        self.assertEqual(run_id("3000", "vanilla", 2, 2), "development-3000-vanilla-trial-2")
        self.assertEqual(run_id("3000", "memory_skill", 3, 2), "development-3000-memory_skill-r2-trial-3")

    def test_summary_preserves_trials_and_reports_rates_without_selecting_a_best_run(self):
        rows = [
            {"task_id": "3000", "arm": "memory", "trial": 1, "status": "TASK_FAIL", "reward": 0,
             "usage": {"total_tokens": 20}, "injected_assets": [{"id": "m", "hash": "a"}]},
            {"task_id": "3000", "arm": "memory", "trial": 2, "status": "TASK_PASS", "reward": 1,
             "usage": {"total_tokens": 10}, "injected_assets": [{"id": "m", "hash": "a"}]},
        ]
        result = summarize(rows)["3000"]["memory"]
        self.assertEqual(result["statuses"], ["TASK_FAIL", "TASK_PASS"])
        self.assertEqual(result["passes"], 1)
        self.assertEqual(result["failures"], 1)
        self.assertEqual(result["mean_reward"], 0.5)
        self.assertEqual(result["mean_total_tokens"], 15)
        self.assertEqual(len(result["injected_asset_sets"]), 1)

    def test_collect_recovers_legacy_outer_trial_labels_without_rewriting_evidence(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "runs").mkdir()
            for trial in (1, 2):
                identifier = run_id("3000", "memory", trial, 2)
                target = root / "runs" / identifier
                target.mkdir()
                row = {
                    "task_id": "3000", "arm": "memory", "trial": 1,
                    "status": "TASK_PASS", "reward": 1, "run_id": identifier,
                    "usage": {"total_tokens": 10}, "injected_assets": [],
                    "candidate_artifact_hash": "c" * 64, "evidence_hash": str(trial) * 64,
                }
                (target / "evidence.json").write_text(json.dumps(row))
            protocol = {
                "protocol_id": "test", "protocol_hash": "p" * 64,
                "selection": {"development": ["3000"]}, "arms": ["memory"],
            }
            with tempfile.NamedTemporaryFile(mode="w", suffix=".json") as handle:
                json.dump(protocol, handle); handle.flush()
                with patch("scripts.evoagentbench.stability_probe.PROTOCOL_FILE", Path(handle.name)):
                    output = collect(root, "probe", ["3000"], ["memory"], [1, 2], 2)
            report = json.loads(output.read_text())
            self.assertEqual(report["results"]["3000"]["memory"]["trials"], [1, 2])
            self.assertEqual(report["trial_label_corrections"], [{
                "run_id": "development-3000-memory-r2-trial-2",
                "source_reported_trial": 1,
                "recovered_trial": 2,
            }])


if __name__ == "__main__":
    unittest.main()
