"""Real SDK smoke; no evaluation suite imports and no writes outside this attempt."""
import asyncio
import json
import sys
import time
from pathlib import Path
from nanobot import Nanobot
from nanobot.agent.hook import AgentHook


class Evidence(AgentHook):
    def __init__(self, path):
        super().__init__(reraise=True)
        self.calls = 0
        self.events = []
        self.path = path
        self.usage = {}

    def record(self, event):
        with self.path.open('a') as f:
            f.write(json.dumps(event,ensure_ascii=False,default=str)+'\n')

    async def before_iteration(self, context):
        self.calls += 1
        self.record({'kind':'iteration','iteration':self.calls})

    async def after_iteration(self, context):
        for key,value in context.usage.items():
            self.usage[key] = self.usage.get(key,0)+value
        self.record({'kind':'usage','usage':context.usage})

    async def before_execute_tool(self, context, tool_call, tool, params):
        self.events.append({'id':tool_call.id,'name':tool_call.name,'arguments':params})
        self.record({'kind':'tool_start',**self.events[-1]})

    async def after_execute_tool(self, context, tool_call, tool, params, result):
        event = next(e for e in self.events if e['id'] == tool_call.id)
        event['result'] = str(result)
        event['is_error'] = bool(getattr(result, 'is_error', False))
        self.record({'kind':'tool_end',**event})


async def main():
    root, mode = Path(sys.argv[1]), sys.argv[2]
    settings = json.loads((root/'private/settings.json').read_text())
    run = next(r for r in settings['runs'] if r['mode'] == mode)
    workspace = root/mode/'workspace'
    workspace.mkdir(parents=True)
    (workspace/'input.txt').write_text(run['fixture'])
    config = {
        'agents':{'defaults':{'provider':'vllm','model':'qwen3.8-27b','temperature':0,
            'maxTokens':4096,'maxToolIterations':6,'fallbackModels':[],
            'idleCompactAfterMinutes':0,'dream':{'enabled':False}}},
        'providers':{'vllm':{'apiBase':'http://127.0.0.1:18096/proxy/'+settings['instance']+'/v1',
            'apiKey':settings['user_key'],'extraHeaders':{
                'x-tdai-user-key':settings['user_key'],'x-session-id':run['session_id'],
                'x-team-id':run['team_id'],'x-agent-id':run['agent_id'],'x-task-id':run['task_id']}}},
        'tools':{'restrictToWorkspace':True},
    }
    config_path = root/'private'/f'nanobot-{mode}.json'
    with config_path.open('x') as f:
        json.dump(config,f)
    config_path.chmod(0o600)
    bot = Nanobot.from_config(config_path=config_path,workspace=workspace)
    # SDK's verified registry boundary, confined to this integration-only runner.
    for name in list(bot._loop.tools.tool_names):
        if name not in {'read_file','write_file','edit_file','list_dir'}:
            bot._loop.tools.unregister(name)
    evidence = Evidence(root/mode/'trace.jsonl')
    started = time.monotonic()
    result = None
    error = None
    try:
        async with bot:
            result = await asyncio.wait_for(bot.run(
                'Create output.txt in the workspace. Its exact content must be the ASCII text '
                +json.dumps(run['fixture'].strip())+' followed by one newline. '
                'Use write_file once. Do not read files or modify input.txt. Then reply Done.',
                session_key=run['session_id'],ephemeral=True,hooks=[evidence]),timeout=240)
    except Exception as exc:
        error = type(exc).__name__+': '+str(exc)
    output_path = workspace/'output.txt'
    evidence_result = {
        'mode':mode,'session_id':run['session_id'],'model':bot.runtime.model,
        'smoke_revision':'integration-copy-v2',
        'output':result.content if result else '', 'error':result.error if result else error,
        'stop_reason':result.stop_reason if result else 'infrastructure_or_timeout',
        'usage':result.usage if result else evidence.usage,'model_calls':evidence.calls,'tool_events':evidence.events,
        'elapsed_ms':round((time.monotonic()-started)*1000),
        'oracle_pass':result is not None and not result.error and output_path.exists()
            and output_path.read_text()==run['fixture']
            and (workspace/'input.txt').read_text()==run['fixture'],
    }
    with (root/mode/'run.json').open('x') as f:
        json.dump(evidence_result,f,ensure_ascii=False,indent=2)
    print(json.dumps({k:evidence_result[k] for k in ('mode','oracle_pass','usage','model_calls','elapsed_ms')}))


asyncio.run(main())
