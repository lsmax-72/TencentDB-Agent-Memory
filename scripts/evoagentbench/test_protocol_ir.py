import json
import tempfile
import unittest
from pathlib import Path

from scripts.evoagentbench.protocol_ir_v1 import CLUSTERS, build_protocol, select_tasks, validate


class InformationRetrievalProtocolTest(unittest.TestCase):
    def split(self):
        return {"clusters": {
            name: {"train": [f"{name}-tr-{index}" for index in range(4)], "test": [f"{name}-te"]}
            for name in CLUSTERS
        }}

    def test_selection_is_deterministic_disjoint_and_test_blind(self):
        first = select_tasks(self.split())
        second = select_tasks(self.split())
        self.assertEqual(first, second)
        self.assertEqual(len(first["experience"]), 8)
        self.assertEqual(len(first["development"]), 4)
        self.assertFalse(set(first["experience"]) & set(first["development"]))
        self.assertEqual(first["official_test"], [])

    def test_frozen_protocol_rejects_source_drift(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            domain = root / "src/domains/information_retrieval"
            domain.mkdir(parents=True)
            for name in ("browsecomp_plus.py", "prompt.md", "information_retrieval.yaml"):
                (domain / name).write_text(name)
            split = root / "split.json"
            split.write_text(json.dumps(self.split()))
            protocol = build_protocol(split, root)
            validate(protocol, split, root)
            (domain / "prompt.md").write_text("changed")
            with self.assertRaisesRegex(ValueError, "FROZEN_IR_PROTOCOL_MISMATCH"):
                validate(protocol, split, root)


if __name__ == "__main__":
    unittest.main()
