import json
import asyncio
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch, AsyncMock

from runner_contract import validate_protocol
from study_contract import classification, compare_usage, needs_probe, frozen_files, verify_freeze
from sandbox import PythonSandbox


class StudyTests(unittest.TestCase):
    def test_producer_revision_does_not_change_task_arm_generation(self):
        from runner_contract import build_config
        base=Path(__file__).parent
        producer=json.loads((base/'memory-producer-v2.json').read_text())
        protocol=json.loads((base/'protocol-transfer-v1.json').read_text())
        self.assertEqual(producer['source_tasks'],protocol['formation_tasks'])
        self.assertEqual(producer['response_format']['json_schema']['schema']['type'],'array')
        config=build_config(protocol,proxy_url='http://127.0.0.1:22696/proxy/business-test/v1',
            user_key='test-key',identity={'team_id':'t','agent_id':'a','task_id':'j','session_id':'s'})
        self.assertNotIn('enable_thinking',json.dumps(config))
        self.assertEqual(config['agents']['defaults']['maxTokens'],4096)

    def test_bounded_provider_does_not_retry_transient_errors(self):
        from bounded_provider import BoundedProvider
        from nanobot.providers.base import LLMResponse
        provider=BoundedProvider(call_budget=1)
        response=LLMResponse(content='timeout',finish_reason='error',usage={},error_kind='timeout')
        with patch.object(provider,'chat',AsyncMock(return_value=response)) as chat:
            asyncio.run(provider.chat_with_retry(messages=[],retry_mode='standard',on_retry_wait=None))
            self.assertEqual(chat.await_count,1)
            with self.assertRaisesRegex(RuntimeError,'BUDGET_EXHAUSTED'):
                asyncio.run(provider.chat_with_retry(messages=[]))

    def test_real_sdk_composition_uses_bounded_provider(self):
        from bounded_provider import BoundedProvider, create_bounded_bot
        from runner_contract import build_config
        from nanobot.providers.base import LLMResponse
        p=json.loads(Path(__file__).with_name('protocol-transfer-v1.json').read_text())
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);cfg=root/'config.json'
            cfg.write_text(json.dumps(build_config(p,proxy_url='http://127.0.0.1:20696/proxy/business-test/v1',
                user_key='test-key',identity={'team_id':'t','agent_id':'a','task_id':'j','session_id':'s'})))
            async def exercise():
                bot,provider=create_bounded_bot(cfg,root/'workspace',p)
                response=LLMResponse(content='done',finish_reason='stop',usage={'prompt_tokens':2,'completion_tokens':1,'total_tokens':3})
                with patch.object(BoundedProvider,'chat',AsyncMock(return_value=response)) as chat:
                    async with bot:
                        result=await bot.run('Return done',session_key='test',ephemeral=True)
                    self.assertEqual(result.content,'done');self.assertEqual(chat.await_count,1)
                self.assertEqual(provider.calls,1);self.assertEqual(provider.observed_usage['total_tokens'],3)
            asyncio.run(exercise())

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
