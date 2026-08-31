import json
import tempfile
import unittest
from pathlib import Path

from prepare_scope_study import validate_design, validate, file_hashes


class ScopeDesignTests(unittest.TestCase):
    def protocol(self):
        return json.loads(Path(__file__).with_name('protocol-scope-policy-v1.json').read_text())

    def test_disjoint_roles_and_every_arm_exactly_once(self):
        p = self.protocol()
        validate_design(p)
        p['confirmation_tasks'].append(p['diagnostic_tasks'][0])
        with self.assertRaisesRegex(ValueError, 'TASK_ROLE_OVERLAP'):
            validate_design(p)

    def test_incomplete_order_and_budget_drift_fail(self):
        p = self.protocol()
        p['diagnostic_order'].pop()
        with self.assertRaisesRegex(ValueError, 'INCOMPLETE_ARM_ORDER'):
            validate_design(p)
        p = self.protocol()
        p['max_model_calls'] = 9
        with self.assertRaisesRegex(ValueError, 'UNEXPECTED_BUDGET_CHANGE'):
            validate_design(p)

    def test_old_diagnosis_tasks_cannot_be_relabelled_unseen(self):
        p = self.protocol()
        p['diagnostic_tasks'][0] = '91-34'
        with self.assertRaisesRegex(ValueError, 'TASK_ROLE_OVERLAP'):
            validate_design(p)

    def test_offline_freeze_detects_changed_or_added_assets(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / 'policy.json').write_text('{}')
            (root / 'offline-freeze.json').write_text(json.dumps({'files': file_hashes(root)}))
            validate(root)
            (root / 'unexpected.json').write_text('{}')
            with self.assertRaisesRegex(ValueError, 'OFFLINE_FREEZE_MISMATCH'):
                validate(root)
