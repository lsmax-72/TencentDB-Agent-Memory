import json
import tempfile
import unittest
from pathlib import Path
from subprocess import CompletedProcess
from unittest.mock import patch

from scripts.evoagentbench.ir_preflight import python_modules, split_counts


class InformationRetrievalPreflightTest(unittest.TestCase):
    def test_split_counts_all_clusters(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "split.json"
            path.write_text(json.dumps({"clusters": {
                "a": {"train": [1, 2], "test": [3]},
                "b": {"train": [4], "test": [5, 6]},
            }}))
            self.assertEqual(split_counts(path), (3, 3))

    def test_missing_split_is_zero(self):
        self.assertEqual(split_counts(Path("/definitely/missing/split.json")), (0, 0))

    def test_module_check_uses_requested_interpreter(self):
        requested = Path("/tmp/example-venv/bin/python")
        payload = {name: True for name in (
            "datasets", "faiss", "fastmcp", "huggingface_hub",
            "pyserini", "tevatron", "torch", "transformers",
        )}
        with patch("scripts.evoagentbench.ir_preflight.subprocess.run") as run:
            run.return_value = CompletedProcess([], 0, json.dumps(payload), "")
            self.assertEqual(python_modules(requested), payload)
        self.assertEqual(run.call_args.args[0][0], str(requested))


if __name__ == "__main__":
    unittest.main()
