import unittest

from scripts.evoagentbench.stability_probe import run_id, summarize


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


if __name__ == "__main__":
    unittest.main()
