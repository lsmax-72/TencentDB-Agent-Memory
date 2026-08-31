import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from runner_contract import validate_protocol
from study_contract import classification, compare_usage, needs_probe, frozen_files, verify_freeze
from sandbox import PythonSandbox


class StudyTests(unittest.TestCase):
    def test_protocol_is_independent_and_disjoint(self):
        p=json.loads(Path(__file__).with_name('protocol-transfer-v1.json').read_text())
        validate_protocol(p)
        self.assertFalse(set(p['formation_tasks']) & set(p['transfer_tasks']))
        self.assertEqual(p['promotion'],'DISABLED')
        p['max_model_calls']=9
        with self.assertRaises(ValueError):validate_protocol(p)

    def test_usage_sum_not_only_response_count(self):
        run={'usage':{'model_calls':2,'prompt_tokens':4,'completion_tokens':2,'total_tokens':6}}
        responses=[{'usage':{'prompt_tokens':2,'completion_tokens':1,'total_tokens':3}}]*2
        compare_usage(run,responses)
        run['usage']['total_tokens']=5
        with self.assertRaisesRegex(ValueError,'total_tokens'):compare_usage(run,responses)

    def test_freeze_detects_changes(self):
        with tempfile.TemporaryDirectory() as d:
            r=Path(d);(r/'runtime').mkdir();(r/'prepared').mkdir()
            (r/'runspecs.json').write_text('{}')
            (r/'study-freeze.json').write_text(json.dumps({'files':frozen_files(r)}))
            verify_freeze(r)
            (r/'runtime/tool.py').write_text('changed')
            with self.assertRaises(ValueError):verify_freeze(r)

    def test_classification_and_probe_do_not_select_best(self):
        self.assertEqual(classification('TASK_FAIL','TASK_PASS'),'newly_fixed')
        self.assertEqual(classification('INFRA_ERROR','TASK_PASS'),'incomparable')
        a={'status':'TASK_PASS','usage':{'model_calls':7,'tool_calls':7}}
        self.assertFalse(needs_probe(a,a))
        b={**a,'usage':{'model_calls':8}}
        self.assertTrue(needs_probe(a,b))

    def test_sandbox_releases_lock_after_prelaunch_exception(self):
        with tempfile.TemporaryDirectory() as d:
            r=Path(d)
            for p in ('in','out','packages/openpyxl','packages/et_xmlfile'):(r/p).mkdir(parents=True)
            sandbox=PythonSandbox(r/'in',r/'out',r/'packages')
            with patch.object(sandbox,'_run_locked',side_effect=OSError('startup')):
                for _ in range(2):
                    with self.assertRaises(OSError):sandbox.run('print(1)')
                    self.assertTrue(sandbox.wait_idle(.1))
