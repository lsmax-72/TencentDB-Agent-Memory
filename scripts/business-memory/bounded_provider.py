"""SDK extension: count actual provider calls, including host finalization passes.

OpenAI max_retries=0 does not disable nanobot's outer chat_with_retry loop.
This opt-in provider leaves the official SDK untouched and makes one attempt.
"""
from nanobot.providers.openai_compat_provider import OpenAICompatProvider


class BoundedProvider(OpenAICompatProvider):
    def __init__(self, *args, call_budget, **kwargs):
        super().__init__(*args, **kwargs)
        self.call_budget = call_budget
        self.calls = 0
        self.observed_usage = {}
        self.responses = []

    async def chat_with_retry(self, **kwargs):
        kwargs.pop('retry_mode', None)
        kwargs.pop('on_retry_wait', None)
        if self.calls >= self.call_budget:
            raise RuntimeError('BUDGET_EXHAUSTED: actual model calls')
        self.calls += 1
        response = await self.chat(**kwargs)
        self.responses.append({'finish_reason': response.finish_reason,
                               'usage': dict(response.usage or {})})
        for key, value in (response.usage or {}).items():
            if type(value) is int:
                self.observed_usage[key] = self.observed_usage.get(key, 0) + value
        return response

    async def chat_stream_with_retry(self, **kwargs):
        raise RuntimeError('RUNSPEC_MISMATCH: streaming is not admitted')


def create_bounded_bot(config_path, workspace, protocol):
    from nanobot import Nanobot
    from nanobot.agent.loop import AgentLoop
    from nanobot.agent.tools.registry import ToolRegistry
    from nanobot.config.loader import load_config
    from nanobot.providers.base import GenerationSettings
    from nanobot.providers.registry import find_by_name
    from nanobot.agent.hooks import create_file_edit_activity_hook

    config = load_config(config_path)
    config.agents.defaults.workspace = str(workspace)
    cfg = config.providers.vllm
    provider = BoundedProvider(api_key=cfg.api_key, api_base=cfg.api_base,
                               default_model=protocol['model'], extra_headers=cfg.extra_headers,
                               spec=find_by_name('vllm'), call_budget=protocol['max_model_calls'])
    provider.generation = GenerationSettings(temperature=0, max_tokens=protocol['max_output_tokens_per_call'])
    loop = AgentLoop.from_config(config, provider=provider, tool_registry=ToolRegistry(),
                                 hook_factories=[create_file_edit_activity_hook])
    return Nanobot(loop, config=config), provider
